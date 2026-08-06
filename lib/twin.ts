import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { openDb, dropDb, type Db } from "@/lib/signal-store";
import { mayObserve } from "@/lib/observers";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import { frontmostApp } from "@/lib/ghost";

/**
 * Twin — the agent that finds its own jobs.
 *
 * Every other automation tool waits to be told what to automate, which means it
 * only ever automates the work you already noticed you were doing. The
 * repetitive work that actually costs you an hour a week is invisible precisely
 * because it is repetitive: you have done it four hundred times and never once
 * thought "this is a task".
 *
 * So Twin watches, counts, and comes to you: "you have moved forty-seven files
 * from Downloads into project folders this month; want me to do that?" You say
 * yes, and it takes it over.
 *
 * WHAT IT WATCHES, precisely. Files appearing, disappearing and moving inside
 * folders you nominate, and which application is in front. That is all. There
 * is no keylogger here and there will not be: system-wide keyboard capture on
 * macOS requires an accessibility hook that can read every password you type,
 * and no pattern worth finding justifies building that. The pitch said "screen,
 * mouse and keyboard"; this is the honest version of it, and the file-move
 * example the pitch leads with is exactly what this does catch.
 *
 * WHAT AN AUTOMATION IS. Not a script. Twin proposes a RULE — a trigger and a
 * short list of verbs from a fixed set (move, copy, rename, sort into a dated
 * folder) that this file implements. It would have been less code to have the
 * model write a shell script and run it, and that would be a
 * remote-code-execution feature with a friendly name: a background process
 * executing model-authored shell against your home directory, where a
 * hallucinated `rm` costs you a folder. A rule can be read in full before it
 * runs, dry-run against real files, and undone afterwards. The model still
 * writes — it writes the sentence describing the rule, which is the part it is
 * actually good at.
 *
 * EVERY ACTION IS UNDOABLE. Each move is recorded with both paths. One button
 * puts them all back.
 */

export type TwinConfig = {
  /** Folders whose file activity Twin watches. Empty means it watches nothing. */
  watchRoots: string[];
  /** Also note which app is frontmost, for routine detection. */
  watchApps: boolean;
  /** Occurrences before a pattern is worth proposing. */
  threshold: number;
  /** Look back this far when mining. */
  windowDays: number;
  /** New automations start in dry-run: they report, they do not act. */
  dryRunByDefault: boolean;
};

export const DEFAULT_TWIN: TwinConfig = {
  watchRoots: [],
  watchApps: true,
  threshold: 4,
  windowDays: 30,
  dryRunByDefault: true,
};

const TWIN_DIR = path.join(os.homedir(), ".lore", "twin");
const CONFIG_FILE = path.join(TWIN_DIR, "config.json");

export async function readTwinConfig(): Promise<TwinConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_TWIN;
  try {
    const parsed = JSON.parse(raw) as Partial<TwinConfig>;
    return {
      watchRoots: Array.isArray(parsed.watchRoots)
        ? parsed.watchRoots.filter((r): r is string => typeof r === "string" && r.startsWith("/")).slice(0, 16)
        : [],
      watchApps: parsed.watchApps !== false,
      threshold: Math.min(50, Math.max(2, Number(parsed.threshold) || DEFAULT_TWIN.threshold)),
      windowDays: Math.min(365, Math.max(1, Number(parsed.windowDays) || DEFAULT_TWIN.windowDays)),
      dryRunByDefault: parsed.dryRunByDefault !== false,
    };
  } catch {
    return DEFAULT_TWIN;
  }
}

export async function writeTwinConfig(config: TwinConfig): Promise<TwinConfig> {
  await fs.mkdir(TWIN_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

// --------------------------------------------------------------------- store

const MIGRATIONS = [
  `
  CREATE TABLE events (
    id   INTEGER PRIMARY KEY,
    at   INTEGER NOT NULL,
    kind TEXT NOT NULL,
    a    TEXT,
    b    TEXT,
    meta TEXT
  );
  CREATE INDEX events_at ON events(at DESC);
  CREATE INDEX events_kind ON events(kind, at DESC);

  CREATE TABLE patterns (
    id        TEXT PRIMARY KEY,
    kind      TEXT NOT NULL,
    signature TEXT NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    firstAt   INTEGER,
    lastAt    INTEGER,
    sample    TEXT,
    summary   TEXT,
    /* 0 seen, 1 proposed to the user, 2 accepted, 3 dismissed. A dismissed
       pattern stays here so it is never proposed twice. */
    state     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX patterns_state ON patterns(state, count DESC);

  CREATE TABLE automations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    trigger     TEXT NOT NULL,
    actions     TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 0,
    dryRun      INTEGER NOT NULL DEFAULT 1,
    patternId   TEXT,
    createdAt   INTEGER NOT NULL,
    runs        INTEGER NOT NULL DEFAULT 0,
    acted       INTEGER NOT NULL DEFAULT 0,
    lastRunAt   INTEGER,
    lastError   TEXT
  );

  CREATE TABLE actions_log (
    id           INTEGER PRIMARY KEY,
    automationId TEXT NOT NULL,
    at           INTEGER NOT NULL,
    kind         TEXT NOT NULL,
    src          TEXT NOT NULL,
    dst          TEXT,
    ok           INTEGER NOT NULL DEFAULT 1,
    dryRun       INTEGER NOT NULL DEFAULT 0,
    error        TEXT,
    undone       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX actions_at ON actions_log(at DESC);
  `,
];

export function twinDb(): Db {
  return openDb("twin", MIGRATIONS);
}

// --------------------------------------------------------------- observation

type PendingUnlink = { at: number; full: string };

/** Basename → recently vanished path, for pairing a delete with a create. */
const vanished = new Map<string, PendingUnlink>();
let watcher: FSWatcher | null = null;
let watching: string[] = [];

/**
 * A file that disappeared here and reappeared there within a few seconds is a
 * move.
 *
 * The filesystem does not report moves across directories — it reports an
 * unlink and an add, and nothing connects them. Pairing on basename inside a
 * short window is what a move actually looks like from the outside, and the
 * window is short enough that two unrelated files with the same name are not
 * mistaken for one: five seconds, where a Finder drag is under one.
 */
const MOVE_WINDOW_MS = 5_000;

function note(kind: string, a: string | null, b: string | null, meta?: unknown): void {
  try {
    twinDb().run(
      "INSERT INTO events (at, kind, a, b, meta) VALUES (?,?,?,?,?)",
      Date.now(),
      kind,
      a,
      b,
      meta ? JSON.stringify(meta) : null,
    );
  } catch {
    /* Observation must never be the thing that throws. */
  }
}

export async function startTwinWatcher(): Promise<{ watching: string[] }> {
  const config = await readTwinConfig();
  const roots = config.watchRoots.filter(Boolean);

  /* Same set, same watcher. Rebuilding one on every tick would re-scan every
     folder and re-report every existing file as new. */
  if (watcher && roots.join("|") === watching.join("|")) return { watching };
  await stopTwinWatcher();
  if (!roots.length) return { watching: [] };

  watcher = chokidar.watch(roots, {
    /* Existing files are not events. Without this, switching Twin on reports
       every file already in Downloads as "added" and invents a pattern out of
       a directory listing. */
    ignoreInitial: true,
    /* One level of subfolder. A recursive watch on Documents is thousands of
       inotify handles for patterns that are almost always one level deep. */
    depth: 2,
    ignored: (target: string) => /(^|\/)\.|node_modules|\.git(\/|$)/.test(target),
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 120 },
  });

  watcher.on("add", (full: string) => {
    if (!mayObserve("twin")) return;
    const base = path.basename(full);
    const pending = vanished.get(base);
    if (pending && Date.now() - pending.at < MOVE_WINDOW_MS && pending.full !== full) {
      vanished.delete(base);
      note("move", pending.full, full, { base });
      return;
    }
    note("add", full, null, { dir: path.dirname(full), ext: path.extname(full) });
  });

  watcher.on("unlink", (full: string) => {
    if (!mayObserve("twin")) return;
    vanished.set(path.basename(full), { at: Date.now(), full });
    /*
     * A delete is recorded only once its move window has closed with no
     * matching add. Otherwise every move is logged twice — once as a delete and
     * once as a move — and "files you delete from Downloads" becomes a pattern
     * that describes nothing.
     */
    const base = path.basename(full);
    const timer = setTimeout(() => {
      const still = vanished.get(base);
      if (still && still.full === full) {
        vanished.delete(base);
        note("remove", full, null, { dir: path.dirname(full) });
      }
    }, MOVE_WINDOW_MS + 500);
    timer.unref?.();
  });

  /* A watch error is a folder that went away or a permission that changed. It
     is information, not a crash. */
  watcher.on("error", (error: unknown) => {
    note("watch-error", null, null, { message: error instanceof Error ? error.message : String(error) });
  });

  watching = roots;
  return { watching };
}

export async function stopTwinWatcher(): Promise<void> {
  const current = watcher;
  watcher = null;
  watching = [];
  vanished.clear();
  if (current) await current.close().catch(() => {});
}

export function twinWatching(): string[] {
  return watching;
}

/** Record the frontmost application, if it changed since last time. */
let lastApp: string | null = null;

export async function sampleFrontmostApp(): Promise<void> {
  const config = await readTwinConfig();
  if (!config.watchApps) return;
  const { app } = await frontmostApp();
  if (!app || app === lastApp) return;
  note("app", lastApp, app);
  lastApp = app;
}

// -------------------------------------------------------------------- mining

/**
 * What separates the fields inside a pattern signature.
 *
 * A space is the obvious choice and is wrong: these fields are filesystem
 * paths, and `~/Documents/Client Work` would split into three. NUL is the only
 * byte a POSIX path cannot contain, but a literal NUL in source is invisible in
 * every editor and in grep — an earlier version of this file had ten of them
 * and read as if it used spaces. The ASCII unit separator is equally impossible
 * in a path and, written as an escape, is visible in the source.
 */
export const SEP = "\u001F";

export type Pattern = {
  id: string;
  kind: string;
  signature: string;
  count: number;
  firstAt: number | null;
  lastAt: number | null;
  sample: string | null;
  summary: string | null;
  state: number;
};

/**
 * Turn raw events into things worth saying.
 *
 * Three miners, each answering a question a person would recognise:
 *
 *   MOVES  — "you keep moving files from here to there". The strongest signal
 *            and the one the pitch leads with.
 *   FILING — "things of this type keep ending up in this folder", which catches
 *            the case where files arrive by download rather than by move.
 *   ROUTINE— "you go from this app to that one, repeatedly", which is not
 *            automatable but is worth knowing, so it is reported and never
 *            proposed as an automation.
 *
 * Patterns are keyed by a signature so a run is idempotent: re-mining updates
 * counts rather than creating a second copy of the same observation.
 */
export function minePatterns(config: TwinConfig): { found: number; updated: number } {
  const db = twinDb();
  const since = Date.now() - config.windowDays * 86_400_000;
  let found = 0;
  let updated = 0;

  const record = (
    kind: string,
    signature: string,
    count: number,
    firstAt: number,
    lastAt: number,
    sample: string,
  ) => {
    const id = `${kind}:${signature}`;
    const existing = db.get<{ state: number }>("SELECT state FROM patterns WHERE id = ?", id);
    if (existing) {
      /* A dismissed pattern keeps its state. Re-proposing something the user
         said no to is the fastest way to make them turn the whole thing off. */
      db.run(
        "UPDATE patterns SET count = ?, firstAt = ?, lastAt = ?, sample = ? WHERE id = ?",
        count,
        firstAt,
        lastAt,
        sample,
        id,
      );
      updated++;
    } else {
      db.run(
        "INSERT INTO patterns (id, kind, signature, count, firstAt, lastAt, sample, state) VALUES (?,?,?,?,?,?,?,0)",
        id,
        kind,
        signature,
        count,
        firstAt,
        lastAt,
        sample,
      );
      found++;
    }
  };

  // ---- moves: from-directory → to-directory, by extension -----------------
  const moves = db.all<{ a: string; b: string; at: number }>(
    "SELECT a, b, at FROM events WHERE kind = 'move' AND at > ? AND a IS NOT NULL AND b IS NOT NULL",
    since,
  );
  const moveGroups = new Map<string, { count: number; first: number; last: number; sample: string }>();
  for (const move of moves) {
    const from = path.dirname(move.a);
    const to = path.dirname(move.b);
    if (from === to) continue;
    const ext = path.extname(move.a).toLowerCase() || "(no extension)";
    const key = `${from}${SEP}${to}${SEP}${ext}`;
    const group = moveGroups.get(key);
    if (group) {
      group.count++;
      group.first = Math.min(group.first, move.at);
      group.last = Math.max(group.last, move.at);
    } else {
      moveGroups.set(key, { count: 1, first: move.at, last: move.at, sample: `${move.a} → ${move.b}` });
    }
  }
  for (const [key, group] of moveGroups) {
    if (group.count < config.threshold) continue;
    record("move", key, group.count, group.first, group.last, group.sample);
  }

  // ---- filing: files of one type arriving in one folder -------------------
  const adds = db.all<{ a: string; at: number }>(
    "SELECT a, at FROM events WHERE kind = 'add' AND at > ? AND a IS NOT NULL",
    since,
  );
  const fileGroups = new Map<string, { count: number; first: number; last: number; sample: string }>();
  for (const add of adds) {
    const dir = path.dirname(add.a);
    const ext = path.extname(add.a).toLowerCase();
    if (!ext) continue;
    const key = `${dir}${SEP}${ext}`;
    const group = fileGroups.get(key);
    if (group) {
      group.count++;
      group.first = Math.min(group.first, add.at);
      group.last = Math.max(group.last, add.at);
    } else {
      fileGroups.set(key, { count: 1, first: add.at, last: add.at, sample: add.a });
    }
  }
  for (const [key, group] of fileGroups) {
    /* A higher bar than moves. Files appearing in a folder is what folders are
       for; it is only interesting when it is relentless. */
    if (group.count < config.threshold * 3) continue;
    record("filing", key, group.count, group.first, group.last, group.sample);
  }

  // ---- routine: app A followed by app B -----------------------------------
  const hops = db.all<{ a: string | null; b: string; at: number }>(
    "SELECT a, b, at FROM events WHERE kind = 'app' AND at > ? AND b IS NOT NULL",
    since,
  );
  const hopGroups = new Map<string, { count: number; first: number; last: number }>();
  for (const hop of hops) {
    if (!hop.a) continue;
    const key = `${hop.a}${SEP}${hop.b}`;
    const group = hopGroups.get(key);
    if (group) {
      group.count++;
      group.first = Math.min(group.first, hop.at);
      group.last = Math.max(group.last, hop.at);
    } else {
      hopGroups.set(key, { count: 1, first: hop.at, last: hop.at });
    }
  }
  for (const [key, group] of hopGroups) {
    if (group.count < config.threshold * 5) continue;
    const [from, to] = key.split(SEP);
    record("routine", key, group.count, group.first, group.last, `${from} → ${to}`);
  }

  return { found, updated };
}

// ----------------------------------------------------------------- proposals

export type TriggerSpec =
  /**
   * `ext` has three meanings and they must stay distinct.
   *
   *   ".pdf"  — files with that extension
   *   null    — any file, whatever its name
   *   ""      — files with NO extension
   *
   * The empty string is not pedantry. Mining groups moves by extension and
   * labels the extensionless group "(no extension)"; a first version turned
   * that into `ext: null`, so a rule derived from four extensionless downloads
   * became a rule that moved EVERY file in the folder. An automation that files
   * things is the one place in this product where over-matching costs the user
   * something they cannot get back by pressing undo twice.
   */
  | { kind: "file-added"; dir: string; ext: string | null; namePattern: string | null }
  | { kind: "manual" };

export type ActionSpec =
  | { kind: "move"; to: string }
  | { kind: "copy"; to: string }
  | { kind: "sort-by-date"; to: string; format: "YYYY" | "YYYY-MM" | "YYYY-MM-DD" };

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  trigger: TriggerSpec;
  actions: ActionSpec[];
  enabled: boolean;
  dryRun: boolean;
  patternId: string | null;
  createdAt: number;
  runs: number;
  acted: number;
  lastRunAt: number | null;
  lastError: string | null;
};

/** The rule a pattern implies, or null when the pattern is not actionable. */
export function proposalFor(pattern: Pattern): { trigger: TriggerSpec; actions: ActionSpec[] } | null {
  if (pattern.kind === "move") {
    const [from, to, ext] = pattern.signature.split(SEP);
    if (!from || !to) return null;
    return {
      trigger: {
        kind: "file-added",
        dir: from,
        /* "" means extensionless, not "anything" — see TriggerSpec. */
        ext: ext.startsWith(".") ? ext : "",
        namePattern: null,
      },
      actions: [{ kind: "move", to }],
    };
  }
  if (pattern.kind === "filing") {
    const [dir, ext] = pattern.signature.split(SEP);
    if (!dir) return null;
    return {
      trigger: { kind: "file-added", dir, ext: ext || null, namePattern: null },
      actions: [{ kind: "sort-by-date", to: path.join(dir, "Archive"), format: "YYYY-MM" }],
    };
  }
  /* A routine is a fact about your day, not a job. Reporting "you go from Mail
     to Slack forty times a week" is useful; offering to do it for you is not. */
  return null;
}

/**
 * The sentence Twin says when it comes to you.
 *
 * Written by the local model when there is one, because "you have moved 47 PDFs
 * from Downloads to Invoices this month" reads better than a template can
 * manage — and falls back to a template when there is not, because a proposal
 * nobody can read is a proposal nobody accepts.
 */
export async function describePattern(pattern: Pattern): Promise<string> {
  const template = templateFor(pattern);
  const detection = await detectOllama().catch(() => null);
  const model = detection?.running ? recommendModel(detection.models) : null;
  if (!model) return template;

  const written = await generate(
    model,
    `Facts:\n${template}\nExample: ${pattern.sample ?? "none"}\n\nSentence:`,
    {
      system: `Rewrite the facts as ONE sentence addressed to the user, in plain English.

Rules:
- Keep every number and every folder name exactly as given.
- No greeting, no offer to help, no question at the end.
- Under 25 words.`,
      timeoutMs: 20_000,
      maxTokens: 80,
    },
  ).catch(() => "");

  const cleaned = written.trim().split("\n")[0].replace(/^["']|["']$/g, "");
  /* The template wins unless the model's version is plausible: a one-word reply
     or an essay both mean it misunderstood, and the template is never wrong. */
  return cleaned.length > 15 && cleaned.length < 240 ? cleaned : template;
}

function templateFor(pattern: Pattern): string {
  const short = (dir: string) => dir.replace(os.homedir(), "~");
  if (pattern.kind === "move") {
    const [from, to, ext] = pattern.signature.split(SEP);
    const what = ext && ext !== "(no extension)" ? `${ext} files` : "files";
    return `You have moved ${pattern.count} ${what} from ${short(from)} into ${short(to)}.`;
  }
  if (pattern.kind === "filing") {
    const [dir, ext] = pattern.signature.split(SEP);
    return `${pattern.count} ${ext} files have arrived in ${short(dir)} and stayed there.`;
  }
  const [from, to] = pattern.signature.split(SEP);
  return `You have switched from ${from} to ${to} ${pattern.count} times.`;
}

/** Patterns that have crossed the threshold and not been answered yet. */
export function pendingProposals(limit = 8): (Pattern & { proposal: unknown })[] {
  const db = twinDb();
  const rows = db.all<Pattern>(
    "SELECT * FROM patterns WHERE state IN (0,1) ORDER BY count DESC LIMIT ?",
    limit,
  );
  /*
   * Never generates. Reads what has already been written.
   *
   * This used to call the local model for any pattern without a summary — up to
   * eight of them, serially, inside a GET the view gives up on after thirty
   * seconds. Two patterns were enough to time the screen out, and the user saw
   * "Twin could not be reached" while Twin was working perfectly.
   *
   * Writing the sentence is now the mining job's business (it runs every half
   * hour and nobody is waiting on it). Until it has, the template is used: it
   * carries every number the model's version would, and is never wrong.
   */
  return rows.map((pattern) => ({
    ...pattern,
    summary: pattern.summary ?? templateFor(pattern),
    proposal: proposalFor(pattern),
  }));
}

/**
 * Give the patterns that lack one a written summary.
 *
 * Called from the mining job, where a slow model costs nobody a screen.
 */
export async function summarisePatterns(limit = 6): Promise<number> {
  const db = twinDb();
  const rows = db.all<Pattern>(
    "SELECT * FROM patterns WHERE summary IS NULL AND state IN (0,1) ORDER BY count DESC LIMIT ?",
    limit,
  );
  let written = 0;
  for (const pattern of rows) {
    const summary = await describePattern(pattern);
    db.run("UPDATE patterns SET summary = ?, state = 1 WHERE id = ?", summary, pattern.id);
    written++;
  }
  return written;
}

export function dismissPattern(id: string): boolean {
  return twinDb().run("UPDATE patterns SET state = 3 WHERE id = ?", id).changes > 0;
}

// ---------------------------------------------------------------- automations

function hydrateAutomation(row: Record<string, unknown>): Automation {
  const parse = <T,>(value: unknown, fallback: T): T => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    trigger: parse<TriggerSpec>(row.trigger, { kind: "manual" }),
    actions: parse<ActionSpec[]>(row.actions, []),
    enabled: Number(row.enabled) === 1,
    dryRun: Number(row.dryRun) === 1,
    patternId: (row.patternId as string | null) ?? null,
    createdAt: Number(row.createdAt),
    runs: Number(row.runs),
    acted: Number(row.acted),
    lastRunAt: (row.lastRunAt as number | null) ?? null,
    lastError: (row.lastError as string | null) ?? null,
  };
}

export function listAutomations(): Automation[] {
  return twinDb().all("SELECT * FROM automations ORDER BY createdAt DESC").map(hydrateAutomation);
}

export function readAutomation(id: string): Automation | null {
  const row = twinDb().get("SELECT * FROM automations WHERE id = ?", id);
  return row ? hydrateAutomation(row) : null;
}

/** Accept a proposal: create the rule, in dry-run, disabled until switched on. */
export async function acceptPattern(patternId: string): Promise<Automation | null> {
  const db = twinDb();
  const pattern = db.get<Pattern>("SELECT * FROM patterns WHERE id = ?", patternId);
  if (!pattern) return null;
  const spec = proposalFor(pattern);
  if (!spec) return null;
  const config = await readTwinConfig();

  const id = `auto-${Date.now().toString(36)}`;
  const name = pattern.summary ?? templateFor(pattern);
  db.run(
    `INSERT INTO automations (id, name, description, trigger, actions, enabled, dryRun, patternId, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id,
    name.slice(0, 200),
    describeRule(spec.trigger, spec.actions),
    JSON.stringify(spec.trigger),
    JSON.stringify(spec.actions),
    /* Enabled, but in dry-run: it starts reporting what it WOULD do
       immediately, which is the only way to build the confidence that makes
       turning dry-run off a reasonable thing to do. */
    1,
    config.dryRunByDefault ? 1 : 0,
    patternId,
    Date.now(),
  );
  db.run("UPDATE patterns SET state = 2 WHERE id = ?", patternId);
  return readAutomation(id);
}

/** The rule in one sentence, generated from the rule itself and not the model. */
export function describeRule(trigger: TriggerSpec, actions: ActionSpec[]): string {
  const short = (dir: string) => dir.replace(os.homedir(), "~");
  const when =
    trigger.kind === "file-added"
      ? `When a${trigger.ext === "" ? "n extensionless" : trigger.ext ? ` ${trigger.ext}` : ""} file appears in ${short(trigger.dir)}`
      : "When you run it by hand";
  const then = actions
    .map((action) => {
      if (action.kind === "move") return `move it to ${short(action.to)}`;
      if (action.kind === "copy") return `copy it to ${short(action.to)}`;
      return `file it under ${short(action.to)}/${action.format}`;
    })
    .join(", then ");
  return `${when}, ${then}.`;
}

export function setAutomation(
  id: string,
  patch: { enabled?: boolean; dryRun?: boolean; name?: string },
): Automation | null {
  const db = twinDb();
  if (!db.get("SELECT id FROM automations WHERE id = ?", id)) return null;
  if (patch.enabled !== undefined) {
    db.run("UPDATE automations SET enabled = ? WHERE id = ?", patch.enabled ? 1 : 0, id);
  }
  if (patch.dryRun !== undefined) {
    db.run("UPDATE automations SET dryRun = ? WHERE id = ?", patch.dryRun ? 1 : 0, id);
  }
  if (patch.name) db.run("UPDATE automations SET name = ? WHERE id = ?", patch.name.slice(0, 200), id);
  return readAutomation(id);
}

export function deleteAutomation(id: string): boolean {
  return twinDb().run("DELETE FROM automations WHERE id = ?", id).changes > 0;
}

// -------------------------------------------------------------------- runner

export type ActionOutcome = {
  kind: string;
  src: string;
  dst: string | null;
  ok: boolean;
  dryRun: boolean;
  error: string | null;
};

/**
 * A destination that is definitely inside where it claims to be.
 *
 * Every path an automation touches goes through here. The rules were derived
 * from observed folders rather than typed by a user, which makes them
 * trustworthy right up until something else can write to the patterns table —
 * and a background process that moves files is not a place to rely on that
 * distinction.
 */
function safeJoin(base: string, name: string): string | null {
  const resolved = path.resolve(base, name);
  const root = path.resolve(base);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/** Never overwrite. `report.pdf` becomes `report (2).pdf`. */
async function freeName(dir: string, base: string): Promise<string> {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let n = 1; n < 500; n++) {
    const candidate = n === 1 ? base : `${stem} (${n})${ext}`;
    const target = safeJoin(dir, candidate);
    if (!target) throw new Error("Refused a destination outside its folder.");
    const exists = await fs
      .access(target)
      .then(() => true)
      .catch(() => false);
    if (!exists) return target;
  }
  throw new Error("Too many files with that name already.");
}

/**
 * Run one automation over the files its trigger currently matches.
 *
 * Bounded at fifty files a pass. A rule that has just been switched off dry-run
 * against a folder of two thousand downloads should move fifty and come back,
 * so that a mistake is fifty files to undo rather than two thousand.
 */
export async function runAutomation(
  id: string,
  opts?: { force?: boolean; limit?: number },
): Promise<{ automation: Automation; outcomes: ActionOutcome[] }> {
  const db = twinDb();
  const automation = readAutomation(id);
  if (!automation) throw new Error("No such automation.");
  if (!automation.enabled && !opts?.force) {
    return { automation, outcomes: [] };
  }
  const dryRun = automation.dryRun;
  const outcomes: ActionOutcome[] = [];
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));

  if (automation.trigger.kind !== "file-added") {
    return { automation, outcomes };
  }

  const dir = automation.trigger.dir;

  /*
   * Read-only mode covers the vault, and Twin moves files.
   *
   * proxy.ts refuses every HTTP route that can write the wiki while the lock is
   * on, but Twin runs on a timer inside the server — no request, no proxy, no
   * gate. A rule whose source or destination sits inside the linked vault could
   * therefore reorganise somebody's notes while the app was promising in
   * writing that it would not change them. The lock is checked here because
   * this is the only place that knows.
   */
  if (!dryRun) {
    const { readSafetySync } = await import("@/lib/safety");
    if (readSafetySync().readOnly) {
      const { getActiveVault } = await import("@/lib/config");
      const vault = await getActiveVault();
      const inside = (target: string) =>
        Boolean(vault) && (target === vault!.root || target.startsWith(vault!.root + path.sep));
      const touchesVault =
        inside(dir) ||
        automation.actions.some((action) => "to" in action && inside(action.to));
      if (touchesVault) {
        db.run(
          "UPDATE automations SET lastRunAt = ?, lastError = ? WHERE id = ?",
          Date.now(),
          "Lore is read-only, so this rule did not touch your wiki. Turn read-only off in Settings if you want it to.",
          id,
        );
        return { automation: readAutomation(id)!, outcomes: [] };
      }
    }
  }

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let acted = 0;

  for (const entry of entries) {
    if (outcomes.length >= limit) break;
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    /* `null` matches anything; "" matches only files without an extension;
       anything else must match exactly. */
    if (
      automation.trigger.ext !== null &&
      path.extname(entry.name).toLowerCase() !== automation.trigger.ext
    ) {
      continue;
    }
    if (automation.trigger.namePattern) {
      try {
        if (!new RegExp(automation.trigger.namePattern, "i").test(entry.name)) continue;
      } catch {
        /* A malformed pattern matches nothing rather than everything. */
        continue;
      }
    }

    const src = safeJoin(dir, entry.name);
    if (!src) continue;

    for (const action of automation.actions) {
      let dst: string | null = null;
      let ok = true;
      let error: string | null = null;
      try {
        const targetDir =
          action.kind === "sort-by-date"
            ? path.join(action.to, dateFolder(new Date(), action.format))
            : action.to;
        if (!dryRun) await fs.mkdir(targetDir, { recursive: true });
        dst = dryRun
          ? path.join(targetDir, entry.name)
          : await freeName(targetDir, entry.name);
        if (!dryRun) {
          if (action.kind === "copy") await fs.copyFile(src, dst);
          else await moveFile(src, dst);
          acted++;
        }
      } catch (caught) {
        ok = false;
        error = caught instanceof Error ? caught.message : "Failed.";
      }

      outcomes.push({ kind: action.kind, src, dst, ok, dryRun, error });
      /*
       * A dry run is not an action, and logging it as one buried the ones that
       * were.
       *
       * An enabled rule in dry-run re-evaluates every 120 seconds and writes a
       * row per matching file each time — so a folder of thirty downloads
       * produced nine hundred rows an hour, all of them dry. `recentActions(20)`
       * then returned nothing but dry rows, the "what Twin actually did" panel
       * disappeared entirely, and with it the undo button for the real moves
       * underneath. The preview is returned to the caller either way; only the
       * permanent log is for things that happened.
       */
      if (!dryRun) {
        db.run(
          "INSERT INTO actions_log (automationId, at, kind, src, dst, ok, dryRun, error) VALUES (?,?,?,?,?,?,0,?)",
          id,
          Date.now(),
          action.kind,
          src,
          dst,
          ok ? 1 : 0,
          error,
        );
      }
      /* A move consumed the source; a second action on the same file would
         fail against a path that no longer exists. */
      if (ok && !dryRun && action.kind !== "copy") break;
    }
  }

  const failed = outcomes.find((outcome) => !outcome.ok);
  db.run(
    "UPDATE automations SET runs = runs + 1, acted = acted + ?, lastRunAt = ?, lastError = ? WHERE id = ?",
    acted,
    Date.now(),
    failed?.error ?? null,
    id,
  );

  return { automation: readAutomation(id)!, outcomes };
}

/**
 * Move across filesystems.
 *
 * `rename` is atomic and fails with EXDEV the moment the destination is on a
 * different volume — an external drive, a network mount, a disk image — which
 * is exactly where people file things. Copy-then-delete is the fallback, in
 * that order, so a failure loses nothing.
 */
async function moveFile(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EXDEV") throw error;
    await fs.copyFile(src, dst);
    await fs.rm(src);
  }
}

function dateFolder(date: Date, format: "YYYY" | "YYYY-MM" | "YYYY-MM-DD"): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (format === "YYYY") return String(y);
  if (format === "YYYY-MM") return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

export type LoggedAction = {
  id: number;
  automationId: string;
  at: number;
  kind: string;
  src: string;
  dst: string | null;
  ok: number;
  dryRun: number;
  error: string | null;
  undone: number;
};

export function recentActions(limit = 50): LoggedAction[] {
  return twinDb().all<LoggedAction>(
    "SELECT * FROM actions_log ORDER BY at DESC LIMIT ?",
    Math.min(500, Math.max(1, limit)),
  );
}

/**
 * Everything that was really moved and has not been put back.
 *
 * "Undo all of it" built its list from the twenty rows the screen happened to
 * be showing, and a single run moves up to fifty files — so thirty real moves
 * had no path back through the UI at all. An undo button that reaches less than
 * the action it undoes is worse than no button, because it looks like it
 * worked.
 *
 * Bounded at a thousand: past that the honest answer is that this is not what
 * the button is for.
 */
export function undoableActions(): LoggedAction[] {
  return twinDb().all<LoggedAction>(
    "SELECT * FROM actions_log WHERE dryRun = 0 AND ok = 1 AND undone = 0 ORDER BY at DESC LIMIT 1000",
  );
}

/**
 * Put it back.
 *
 * The single most important function in this file. An automation that moved
 * something you wanted where it was is only tolerable if the mistake takes one
 * click to reverse — and that reversal has to refuse rather than guess when the
 * file is not where the log says, because moving a DIFFERENT file back to the
 * original path would turn one mistake into two.
 */
export async function undoActions(ids: number[]): Promise<{ undone: number; failed: string[] }> {
  const db = twinDb();
  const failed: string[] = [];
  let undone = 0;

  for (const id of ids) {
    const row = db.get<LoggedAction>("SELECT * FROM actions_log WHERE id = ?", id);
    if (!row || row.undone === 1 || row.dryRun === 1 || row.ok !== 1 || !row.dst) continue;
    try {
      if (row.kind === "copy") {
        await fs.rm(row.dst, { force: true });
      } else {
        const there = await fs
          .access(row.dst)
          .then(() => true)
          .catch(() => false);
        if (!there) throw new Error("The file is no longer where Twin left it.");
        const back = await fs
          .access(row.src)
          .then(() => true)
          .catch(() => false);
        if (back) throw new Error("Something else is already at the original path.");
        await fs.mkdir(path.dirname(row.src), { recursive: true });
        await moveFile(row.dst, row.src);
      }
      db.run("UPDATE actions_log SET undone = 1 WHERE id = ?", id);
      undone++;
    } catch (error) {
      failed.push(`${path.basename(row.src)}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  return { undone, failed };
}

// -------------------------------------------------------------------- status

export type TwinStatus = {
  events: number;
  eventsByKind: { kind: string; n: number }[];
  patterns: number;
  proposals: number;
  automations: number;
  live: number;
  watching: string[];
  acted: number;
  since: number | null;
};

export function twinStatus(): TwinStatus {
  const db = twinDb();
  const totals = db.get<{ n: number; since: number | null }>(
    "SELECT COUNT(*) AS n, MIN(at) AS since FROM events",
  );
  return {
    events: totals?.n ?? 0,
    eventsByKind: db.all("SELECT kind, COUNT(*) AS n FROM events GROUP BY kind ORDER BY n DESC"),
    patterns: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM patterns")?.n ?? 0,
    proposals: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM patterns WHERE state IN (0,1)")?.n ?? 0,
    automations: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM automations")?.n ?? 0,
    live:
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM automations WHERE enabled = 1 AND dryRun = 0")
        ?.n ?? 0,
    watching: twinWatching(),
    acted: db.get<{ n: number }>("SELECT COALESCE(SUM(acted),0) AS n FROM automations")?.n ?? 0,
    since: totals?.since ?? null,
  };
}

export async function forgetTwin(): Promise<void> {
  await stopTwinWatcher();
  await dropDb("twin");
}
