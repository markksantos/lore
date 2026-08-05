import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, dropDb, dbSize, ftsLadder, openForeignCopy, hasTable, type Db } from "@/lib/signal-store";
import { scrub, turnsFromClaudeCode, turnsFromCodex } from "@/lib/listen";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";

/**
 * Ledger — every AI conversation you have had, in one search box.
 *
 * The problem is not that the transcripts are missing. They are all here, on
 * this disk, right now: Claude Code keeps JSONL per project, Codex keeps
 * rollouts, Cursor keeps a SQLite key-value store, the Claude desktop app keeps
 * session records. The problem is that there are five of them, none has a
 * search box worth the name, and the regex you worked out three weeks ago is
 * therefore gone — not deleted, just unfindable, which for a human being is the
 * same thing.
 *
 * So this reads all of them into one index and gives them one search.
 *
 * The design is boring on purpose, because the failure mode of an "AI memory"
 * product is a semantic index that returns vibes. Ledger is full-text first:
 * you searched for `createReadStream` because you remember typing
 * `createReadStream`, and an exact match is not a lesser answer than a
 * plausible one. The local model is available on top, to answer a question
 * across what was found, and it is never between you and the text.
 *
 * INCREMENTAL, always. A transcript file is fingerprinted by size and mtime; an
 * unchanged file is not re-read. Growing files are read from the byte where
 * indexing stopped, so an active Claude Code session costs kilobytes per pass
 * rather than the whole day again.
 *
 * NOTHING LEAVES. Same rule as everywhere else in Lore: the index is a file in
 * ~/.lore, the model is the Ollama on this machine, and there is no network
 * call in this module.
 */

export type LedgerSource =
  | "claude-code"
  | "codex"
  | "cursor"
  | "windsurf"
  | "claude-desktop"
  | "import";

export const LEDGER_SOURCES: LedgerSource[] = [
  "claude-code",
  "codex",
  "cursor",
  "windsurf",
  "claude-desktop",
  "import",
];

export const SOURCE_LABEL: Record<LedgerSource, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  windsurf: "Windsurf",
  "claude-desktop": "Claude desktop",
  import: "Imported exports",
};

/** Where each source keeps its transcripts, said plainly at the switch. */
export const SOURCE_WHERE: Record<LedgerSource, string> = {
  "claude-code": "~/.claude/projects",
  codex: "~/.codex/sessions",
  cursor: "Cursor's own SQLite store",
  windsurf: "Windsurf's own SQLite store",
  "claude-desktop": "~/Library/Application Support/Claude",
  import: "~/.lore/ledger/imports — drop a conversations.json here",
};

export type LedgerConfig = {
  sources: Record<LedgerSource, boolean>;
  /** Run stored text through the secret scrubber. */
  redact: boolean;
  /** Skip transcripts older than this. 0 indexes everything ever. */
  maxAgeDays: number;
};

export const DEFAULT_LEDGER: LedgerConfig = {
  sources: {
    "claude-code": true,
    codex: true,
    cursor: true,
    windsurf: true,
    "claude-desktop": true,
    import: true,
  },
  redact: true,
  /* Zero, not ninety. "What was that regex three weeks ago" is the pitch, and a
     default that quietly drops last year's answers would break the promise for
     exactly the searches people care most about. */
  maxAgeDays: 0,
};

const HOME = os.homedir();
const LEDGER_DIR = path.join(HOME, ".lore", "ledger");
export const IMPORTS_DIR = path.join(LEDGER_DIR, "imports");
const CONFIG_FILE = path.join(LEDGER_DIR, "config.json");

export async function readLedgerConfig(): Promise<LedgerConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_LEDGER;
  try {
    const parsed = JSON.parse(raw) as Partial<LedgerConfig>;
    return {
      sources: { ...DEFAULT_LEDGER.sources, ...(parsed.sources ?? {}) },
      redact: parsed.redact !== false,
      maxAgeDays: Math.max(0, Math.min(3_650, Number(parsed.maxAgeDays) || 0)),
    };
  } catch {
    return DEFAULT_LEDGER;
  }
}

export async function writeLedgerConfig(config: LedgerConfig): Promise<LedgerConfig> {
  await fs.mkdir(LEDGER_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

// --------------------------------------------------------------------- store

const MIGRATIONS = [
  `
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    source     TEXT NOT NULL,
    nativeId   TEXT NOT NULL,
    title      TEXT,
    project    TEXT,
    file       TEXT,
    startedAt  INTEGER,
    endedAt    INTEGER,
    turns      INTEGER NOT NULL DEFAULT 0,
    words      INTEGER NOT NULL DEFAULT 0,
    model      TEXT,
    indexedAt  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_ended ON sessions(endedAt DESC);
  CREATE INDEX sessions_source ON sessions(source, endedAt DESC);

  CREATE TABLE turns (
    id        INTEGER PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq       INTEGER NOT NULL,
    at        INTEGER,
    role      TEXT NOT NULL,
    text      TEXT NOT NULL
  );
  CREATE INDEX turns_session ON turns(sessionId, seq);
  CREATE VIRTUAL TABLE turns_fts USING fts5(text, tokenize = 'porter unicode61');

  /* One row per source FILE, so an unchanged transcript is never re-parsed and
     a growing one is read only from where the last pass stopped. */
  CREATE TABLE cursors (
    file    TEXT PRIMARY KEY,
    source  TEXT NOT NULL,
    bytes   INTEGER NOT NULL DEFAULT 0,
    mtime   INTEGER NOT NULL DEFAULT 0,
    at      INTEGER NOT NULL DEFAULT 0
  );
  `,
];

export function ledgerDb(): Db {
  return openDb("ledger", MIGRATIONS);
}

export type Session = {
  id: string;
  source: LedgerSource;
  nativeId: string;
  title: string | null;
  project: string | null;
  file: string | null;
  startedAt: number | null;
  endedAt: number | null;
  turns: number;
  words: number;
  model: string | null;
  indexedAt: number;
};

export type Turn = { role: "user" | "assistant"; text: string; at?: number };

// -------------------------------------------------------------------- write

/**
 * Replace one session's contents wholesale.
 *
 * Upsert-and-replace rather than append, because every source can rewrite
 * history: Cursor edits bubbles in place, an import can be re-dropped, and a
 * Claude Code session read at 40KB and again at 90KB must not end up with its
 * first forty duplicated. Deleting the turns and re-inserting is a few
 * milliseconds and removes the entire class of double-indexing bug.
 */
function saveSession(
  db: Db,
  meta: Omit<Session, "turns" | "words" | "indexedAt">,
  turns: Turn[],
  redact: boolean,
): void {
  const words = turns.reduce((sum, turn) => sum + turn.text.split(/\s+/).length, 0);
  db.tx(() => {
    db.run(
      "DELETE FROM turns_fts WHERE rowid IN (SELECT id FROM turns WHERE sessionId = ?)",
      meta.id,
    );
    db.run("DELETE FROM turns WHERE sessionId = ?", meta.id);
    db.run(
      `INSERT INTO sessions (id, source, nativeId, title, project, file, startedAt, endedAt, turns, words, model, indexedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, project = excluded.project, file = excluded.file,
         startedAt = excluded.startedAt, endedAt = excluded.endedAt,
         turns = excluded.turns, words = excluded.words, model = excluded.model,
         indexedAt = excluded.indexedAt`,
      meta.id,
      meta.source,
      meta.nativeId,
      meta.title,
      meta.project,
      meta.file,
      meta.startedAt,
      meta.endedAt,
      turns.length,
      words,
      meta.model,
      Date.now(),
    );
    for (let i = 0; i < turns.length; i++) {
      const text = redact ? scrub(turns[i].text) : turns[i].text;
      const { lastInsertRowid } = db.run(
        "INSERT INTO turns (sessionId, seq, at, role, text) VALUES (?,?,?,?,?)",
        meta.id,
        i,
        turns[i].at ?? meta.endedAt ?? null,
        turns[i].role,
        text,
      );
      db.run("INSERT INTO turns_fts (rowid, text) VALUES (?, ?)", lastInsertRowid, text);
    }
  });
}

/** Has this file changed since it was last read? */
function unchanged(db: Db, file: string, size: number, mtime: number): boolean {
  const row = db.get<{ bytes: number; mtime: number }>(
    "SELECT bytes, mtime FROM cursors WHERE file = ?",
    file,
  );
  return Boolean(row && row.bytes === size && row.mtime === Math.round(mtime));
}

function noteFile(db: Db, file: string, source: string, size: number, mtime: number): void {
  db.run(
    `INSERT INTO cursors (file, source, bytes, mtime, at) VALUES (?,?,?,?,?)
     ON CONFLICT(file) DO UPDATE SET bytes = excluded.bytes, mtime = excluded.mtime, at = excluded.at`,
    file,
    source,
    size,
    Math.round(mtime),
    Date.now(),
  );
}

// ------------------------------------------------------------------ sources

async function walk(dir: string, match: RegExp, depth = 4): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, match, depth - 1)));
    else if (match.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Titles for Claude Code sessions, borrowed from the desktop app.
 *
 * The JSONL transcripts have no title in them — the desktop app keeps its own
 * record keyed by `cliSessionId`, and that record has the auto-generated name
 * you actually recognise in a list ("Download creator images to local folder").
 * Reading it costs one directory walk and turns a list of UUIDs into a list of
 * conversations.
 */
async function claudeDesktopTitles(): Promise<Map<string, { title: string; model?: string }>> {
  const base = path.join(HOME, "Library", "Application Support", "Claude", "claude-code-sessions");
  const files = await walk(base, /\.json$/, 4);
  const map = new Map<string, { title: string; model?: string }>();
  for (const file of files.slice(0, 4_000)) {
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as {
        cliSessionId?: string;
        title?: string;
        model?: string;
      };
      if (parsed.cliSessionId && parsed.title) {
        map.set(parsed.cliSessionId, { title: parsed.title, model: parsed.model });
      }
    } catch {
      /* One unreadable session record costs one title. */
    }
  }
  return map;
}

/**
 * A title, from the first thing the human actually said.
 *
 * "The first user turn" is the obvious rule and it produces a list of titles
 * that all read `<command-name>/model</command-name> <command-message>…` —
 * because the first user turn is usually a slash command, a pasted caveat
 * block, or a hook's output, none of which is a conversation's subject. The
 * first pass at this shipped exactly that, and a session list where nine rows
 * in ten share the same opening forty characters is not a list.
 *
 * So the machinery is stripped and the first turn with real prose in it wins.
 */
const MACHINERY = [
  /* A capturing group, so the backreference closes the tag it opened. */
  /<command-(name|message|args|stdout)>[\s\S]*?<\/command-\1>/g,
  /<local-command-[\s\S]*?<\/local-command-[a-z]+>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<[a-z-]+_?important>[\s\S]*?<\/[a-z-]+_?important>/gi,
  /^Caveat: The messages below were generated.*$/gim,
];

/**
 * Openers that mean "a harness is talking", not "a person is asking".
 *
 * Stripping tags was not enough. A skill invocation begins with a path, a hook
 * announcement begins with its own condition, and a resumed session begins with
 * a caveat — so a first pass at this produced eight consecutive rows reading
 * "Base directory for this skill: …/fiverr-inbox", which identifies the skill
 * and not one of the eight conversations. A turn matching any of these is
 * passed over entirely and the next one is tried.
 */
const PREAMBLE = [
  /^base directory for this skill\b/i,
  /^a session-scoped stop hook\b/i,
  /^caveat\b/i,
  /^this session is being continued\b/i,
  /^please continue\b/i,
  /^continue$/i,
  /^<[a-z]/i,
  /^\[request interrupted\b/i,
  /^\{"type"/,
];

function cleanTurn(text: string): string {
  let out = text;
  for (const pattern of MACHINERY) out = out.replace(pattern, " ");
  /* Anything still wrapped in angle brackets at the start is a tag shape this
     list has not learned yet; dropping the leading run of them is cheaper than
     adding a pattern per harness. */
  out = out.replace(/^\s*(?:<[^>]{1,60}>\s*)+/, "").trim();
  out = out.replace(/^```[\s\S]*?```/, "").trim();
  return out.replace(/\s+/g, " ");
}

export function titleFromTurns(turns: Turn[]): string | null {
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const text = cleanTurn(turn.text);
    if (text.length < 8) continue;
    if (PREAMBLE.some((pattern) => pattern.test(text))) continue;
    return text.slice(0, 120);
  }
  /* Every human turn was machinery. The assistant's opening line is then the
     best available description of what the session was — an imperfect title
     beats a list of "(none)". */
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    const text = cleanTurn(turn.text);
    if (text.length < 8) continue;
    return text.slice(0, 120);
  }
  return null;
}

type IndexReport = { source: LedgerSource; sessions: number; turns: number; skipped: number };

async function indexClaudeCode(db: Db, config: LedgerConfig): Promise<IndexReport> {
  const report: IndexReport = { source: "claude-code", sessions: 0, turns: 0, skipped: 0 };
  const base = path.join(HOME, ".claude", "projects");
  const files = await walk(base, /\.jsonl$/, 3);
  const titles = config.sources["claude-desktop"] ? await claudeDesktopTitles() : new Map();
  const cutoff = config.maxAgeDays ? Date.now() - config.maxAgeDays * 86_400_000 : 0;

  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    if (cutoff && stat.mtimeMs < cutoff) continue;
    if (unchanged(db, file, stat.size, stat.mtimeMs)) {
      report.skipped++;
      continue;
    }
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    if (!raw) continue;

    const turns = turnsFromClaudeCode(raw).map((t) => ({ role: t.role, text: t.text }));
    if (!turns.length) {
      noteFile(db, file, "claude-code", stat.size, stat.mtimeMs);
      continue;
    }

    /* The per-line timestamps and cwd are richer than the file's mtime, and
       they are the only way a session that ran across midnight lands on the
       right day. Parsed opportunistically: a torn line costs precision, not
       the session. */
    let firstAt: number | null = null;
    let lastAt: number | null = null;
    let cwd: string | null = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        const record = JSON.parse(line) as { timestamp?: string; cwd?: string };
        if (record.cwd && !cwd) cwd = record.cwd;
        if (record.timestamp) {
          const at = Date.parse(record.timestamp);
          if (Number.isFinite(at)) {
            firstAt ??= at;
            lastAt = at;
          }
        }
      } catch {
        /* Ignore. */
      }
    }

    const nativeId = path.basename(file, ".jsonl");
    const known = titles.get(nativeId);
    saveSession(
      db,
      {
        id: `claude-code:${nativeId}`,
        source: "claude-code",
        nativeId,
        title: known?.title ?? titleFromTurns(turns),
        project: cwd ?? path.basename(path.dirname(file)),
        file,
        startedAt: firstAt ?? Math.round(stat.birthtimeMs),
        endedAt: lastAt ?? Math.round(stat.mtimeMs),
        model: known?.model ?? null,
      },
      turns,
      config.redact,
    );
    noteFile(db, file, "claude-code", stat.size, stat.mtimeMs);
    report.sessions++;
    report.turns += turns.length;
  }
  return report;
}

async function indexCodex(db: Db, config: LedgerConfig): Promise<IndexReport> {
  const report: IndexReport = { source: "codex", sessions: 0, turns: 0, skipped: 0 };
  const cutoff = config.maxAgeDays ? Date.now() - config.maxAgeDays * 86_400_000 : 0;
  for (const base of [
    path.join(HOME, ".codex", "sessions"),
    path.join(HOME, ".codex", "archived_sessions"),
  ]) {
    for (const file of await walk(base, /\.jsonl$/, 5)) {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) continue;
      if (cutoff && stat.mtimeMs < cutoff) continue;
      if (unchanged(db, file, stat.size, stat.mtimeMs)) {
        report.skipped++;
        continue;
      }
      const raw = await fs.readFile(file, "utf8").catch(() => "");
      if (!raw) continue;
      const turns = turnsFromCodex(raw).map((t) => ({ role: t.role, text: t.text }));
      if (!turns.length) {
        noteFile(db, file, "codex", stat.size, stat.mtimeMs);
        continue;
      }
      const nativeId = path.basename(file, ".jsonl");
      saveSession(
        db,
        {
          id: `codex:${nativeId}`,
          source: "codex",
          nativeId,
          title: titleFromTurns(turns),
          project: null,
          file,
          startedAt: Math.round(stat.birthtimeMs),
          endedAt: Math.round(stat.mtimeMs),
          model: null,
        },
        turns,
        config.redact,
      );
      noteFile(db, file, "codex", stat.size, stat.mtimeMs);
      report.sessions++;
      report.turns += turns.length;
    }
  }
  return report;
}

/** Decode a `cursorDiskKV` value, which may be TEXT or BLOB and may be null. */
function decodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const text =
    typeof value === "string"
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value).toString("utf8")
        : null;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Cursor and Windsurf, which keep conversations in a VS Code state database.
 *
 * The shape, worked out against a real store: `composerData:<id>` is the
 * conversation record, and each message is a separate `bubbleId:<composer>:<id>`
 * row whose `type` is 1 for the human and 2 for the assistant. Older
 * conversations instead carry the whole thing inline under `conversation`, so
 * both are read — a version check would be a guess, and handling both is four
 * extra lines.
 *
 * The database is copied before reading. Cursor is usually running.
 */
async function indexVscodeStore(
  db: Db,
  config: LedgerConfig,
  source: "cursor" | "windsurf",
  appDir: string,
): Promise<IndexReport> {
  const report: IndexReport = { source, sessions: 0, turns: 0, skipped: 0 };
  const stores = [
    path.join(HOME, "Library", "Application Support", appDir, "User", "globalStorage", "state.vscdb"),
  ];
  const cutoff = config.maxAgeDays ? Date.now() - config.maxAgeDays * 86_400_000 : 0;

  for (const store of stores) {
    const stat = await fs.stat(store).catch(() => null);
    if (!stat?.isFile()) continue;
    if (unchanged(db, store, stat.size, stat.mtimeMs)) {
      report.skipped++;
      continue;
    }
    const opened = await openForeignCopy(store);
    if (!opened) continue;
    try {
      if (!hasTable(opened.db, "cursorDiskKV")) continue;

      /* Bubbles first, grouped by conversation. Two thousand rows on a real
         install — small enough to hold, and reading them per-conversation
         would be N queries against a copied database for no gain. */
      const bubbles = new Map<string, Turn[]>();
      const bubbleRows = opened.db.all<{ key: string; value: unknown }>(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND value IS NOT NULL",
      );
      for (const row of bubbleRows) {
        const parts = row.key.split(":");
        if (parts.length < 3) continue;
        const parsed = decodeValue(row.value) as { type?: number; text?: string } | null;
        const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
        if (!text) continue;
        const list = bubbles.get(parts[1]) ?? [];
        list.push({ role: parsed?.type === 1 ? "user" : "assistant", text });
        bubbles.set(parts[1], list);
      }

      const composers = opened.db.all<{ key: string; value: unknown }>(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND value IS NOT NULL",
      );
      for (const row of composers) {
        const parsed = decodeValue(row.value) as {
          composerId?: string;
          name?: string;
          text?: string;
          createdAt?: number;
          lastUpdatedAt?: number;
          conversation?: { type?: number; text?: string }[];
        } | null;
        if (!parsed) continue;
        const nativeId = parsed.composerId ?? row.key.slice("composerData:".length);

        const inline = Array.isArray(parsed.conversation)
          ? parsed.conversation
              .filter((m) => typeof m?.text === "string" && m.text.trim())
              .map<Turn>((m) => ({
                role: m.type === 1 ? "user" : "assistant",
                text: (m.text ?? "").trim(),
              }))
          : [];
        const turns = inline.length ? inline : (bubbles.get(nativeId) ?? []);
        if (!turns.length) continue;

        const endedAt = Math.round(parsed.lastUpdatedAt ?? parsed.createdAt ?? stat.mtimeMs);
        if (cutoff && endedAt < cutoff) continue;

        saveSession(
          db,
          {
            id: `${source}:${nativeId}`,
            source,
            nativeId,
            title: parsed.name?.trim() || parsed.text?.trim()?.slice(0, 120) || titleFromTurns(turns),
            project: null,
            file: store,
            startedAt: parsed.createdAt ?? null,
            endedAt,
            model: null,
          },
          turns,
          config.redact,
        );
        report.sessions++;
        report.turns += turns.length;
      }
      noteFile(db, store, source, stat.size, stat.mtimeMs);
    } finally {
      await opened.dispose();
    }
  }
  return report;
}

/**
 * Exports dropped into a folder.
 *
 * Claude.ai and ChatGPT keep their conversations on a server, so no local tool
 * can honestly claim to read them. What it can do is read the export those
 * services will give you — and say so, rather than listing them as sources and
 * quietly indexing nothing.
 *
 * Both export formats are handled, plus plain markdown for anything else.
 */
async function indexImports(db: Db, config: LedgerConfig): Promise<IndexReport> {
  const report: IndexReport = { source: "import", sessions: 0, turns: 0, skipped: 0 };
  await fs.mkdir(IMPORTS_DIR, { recursive: true, mode: 0o700 }).catch(() => {});
  const entries = await fs.readdir(IMPORTS_DIR).catch(() => []);

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const file = path.join(IMPORTS_DIR, name);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    if (unchanged(db, file, stat.size, stat.mtimeMs)) {
      report.skipped++;
      continue;
    }
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    if (!raw.trim()) continue;

    if (/\.json$/i.test(name)) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const conversations = Array.isArray(parsed) ? parsed : [parsed];
      for (const conversation of conversations) {
        const extracted = extractExportedConversation(conversation);
        if (!extracted) continue;
        saveSession(
          db,
          {
            id: `import:${extracted.id}`,
            source: "import",
            nativeId: extracted.id,
            title: extracted.title ?? titleFromTurns(extracted.turns),
            project: name,
            file,
            startedAt: extracted.startedAt,
            endedAt: extracted.endedAt ?? Math.round(stat.mtimeMs),
            model: null,
          },
          extracted.turns,
          config.redact,
        );
        report.sessions++;
        report.turns += extracted.turns.length;
      }
    } else {
      /* Anything else is treated as one conversation of plain text. Better than
         refusing it: a pasted transcript is still searchable prose. */
      const turns: Turn[] = [{ role: "user", text: raw.slice(0, 2_000_000) }];
      saveSession(
        db,
        {
          id: `import:${name}`,
          source: "import",
          nativeId: name,
          title: name.replace(/\.[^.]+$/, ""),
          project: name,
          file,
          startedAt: Math.round(stat.birthtimeMs),
          endedAt: Math.round(stat.mtimeMs),
          model: null,
        },
        turns,
        config.redact,
      );
      report.sessions++;
      report.turns += 1;
    }
    noteFile(db, file, "import", stat.size, stat.mtimeMs);
  }
  return report;
}

/**
 * One conversation out of an export file, whichever service produced it.
 *
 * ChatGPT's format is a message graph in `mapping`; Claude's is a flat
 * `chat_messages` array. Both are matched structurally rather than by a version
 * field, because export formats change and the shapes have not.
 */
export function extractExportedConversation(input: unknown): {
  id: string;
  title: string | null;
  startedAt: number | null;
  endedAt: number | null;
  turns: Turn[];
} | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;

  const timeOf = (value: unknown): number | null => {
    if (typeof value === "number") return value > 1e12 ? value : value * 1_000;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  // ChatGPT: { title, create_time, mapping: { id: { message: {...} } } }
  if (record.mapping && typeof record.mapping === "object") {
    const nodes = Object.values(record.mapping as Record<string, unknown>);
    const messages: { at: number; role: string; text: string }[] = [];
    for (const node of nodes) {
      const message = (node as { message?: Record<string, unknown> })?.message;
      if (!message) continue;
      const role = (message.author as { role?: string } | undefined)?.role ?? "user";
      if (role === "system" || role === "tool") continue;
      const parts = (message.content as { parts?: unknown[] } | undefined)?.parts ?? [];
      const text = parts
        .map((p) => (typeof p === "string" ? p : typeof (p as { text?: string })?.text === "string" ? (p as { text: string }).text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) continue;
      messages.push({ at: timeOf(message.create_time) ?? 0, role, text });
    }
    if (!messages.length) return null;
    messages.sort((a, b) => a.at - b.at);
    return {
      id: String(record.conversation_id ?? record.id ?? record.title ?? messages[0].text.slice(0, 40)),
      title: typeof record.title === "string" ? record.title : null,
      startedAt: timeOf(record.create_time) ?? (messages[0].at || null),
      endedAt: timeOf(record.update_time) ?? (messages[messages.length - 1].at || null),
      turns: messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        text: m.text,
        at: m.at || undefined,
      })),
    };
  }

  // Claude.ai: { uuid, name, created_at, chat_messages: [{ sender, text | content }] }
  const chat = record.chat_messages;
  if (Array.isArray(chat)) {
    const turns: Turn[] = [];
    for (const entry of chat) {
      const message = entry as Record<string, unknown>;
      const sender = String(message.sender ?? message.role ?? "human");
      let text = typeof message.text === "string" ? message.text : "";
      if (!text && Array.isArray(message.content)) {
        text = (message.content as { type?: string; text?: string }[])
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n");
      }
      text = text.trim();
      if (!text) continue;
      turns.push({
        role: sender === "assistant" ? "assistant" : "user",
        text,
        at: timeOf(message.created_at) ?? undefined,
      });
    }
    if (!turns.length) return null;
    return {
      id: String(record.uuid ?? record.id ?? record.name ?? turns[0].text.slice(0, 40)),
      title: typeof record.name === "string" ? record.name : null,
      startedAt: timeOf(record.created_at),
      endedAt: timeOf(record.updated_at),
      turns,
    };
  }

  return null;
}

// ------------------------------------------------------------------- indexing

export type LedgerIndexResult = {
  reports: IndexReport[];
  sessions: number;
  turns: number;
  ms: number;
};

/** Bring the index up to date. Safe to run repeatedly and concurrently-ish. */
export async function reindexLedger(only?: LedgerSource[]): Promise<LedgerIndexResult> {
  const started = Date.now();
  const config = await readLedgerConfig();
  const db = ledgerDb();
  const wanted = (source: LedgerSource) =>
    config.sources[source] && (!only || only.includes(source));

  const reports: IndexReport[] = [];
  if (wanted("claude-code")) reports.push(await indexClaudeCode(db, config));
  if (wanted("codex")) reports.push(await indexCodex(db, config));
  if (wanted("cursor")) reports.push(await indexVscodeStore(db, config, "cursor", "Cursor"));
  if (wanted("windsurf")) reports.push(await indexVscodeStore(db, config, "windsurf", "Windsurf"));
  if (wanted("import")) reports.push(await indexImports(db, config));

  return {
    reports,
    sessions: reports.reduce((n, r) => n + r.sessions, 0),
    turns: reports.reduce((n, r) => n + r.turns, 0),
    ms: Date.now() - started,
  };
}

/** Throw the index away. The transcripts themselves are untouched. */
export async function forgetLedger(): Promise<void> {
  await dropDb("ledger");
}

// -------------------------------------------------------------------- search

export type LedgerHit = {
  turnId: number;
  sessionId: string;
  source: LedgerSource;
  title: string | null;
  project: string | null;
  role: string;
  at: number | null;
  seq: number;
  snippet: string;
  score: number;
};

export type LedgerSearch = {
  query: string;
  hits: LedgerHit[];
  /** Sessions represented, so the UI can group without a second query. */
  sessions: Session[];
  total: number;
};

export function searchLedger(
  query: string,
  opts?: { source?: LedgerSource | null; from?: number | null; to?: number | null; limit?: number },
): LedgerSearch {
  const db = ledgerDb();
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 40));
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.source) {
    filters.push("s.source = ?");
    params.push(opts.source);
  }
  if (opts?.from) {
    filters.push("COALESCE(t.at, s.endedAt) >= ?");
    params.push(opts.from);
  }
  if (opts?.to) {
    filters.push("COALESCE(t.at, s.endedAt) <= ?");
    params.push(opts.to);
  }
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

  for (const match of ftsLadder(query)) {
    const hits = db.all<LedgerHit>(
      `SELECT t.id AS turnId, t.sessionId, s.source, s.title, s.project, t.role,
              COALESCE(t.at, s.endedAt) AS at, t.seq,
              snippet(turns_fts, 0, '«', '»', '…', 18) AS snippet,
              -bm25(turns_fts) AS score
         FROM turns_fts
         JOIN turns t ON t.id = turns_fts.rowid
         JOIN sessions s ON s.id = t.sessionId
        WHERE turns_fts MATCH ? ${where}
        ORDER BY score DESC
        LIMIT ?`,
      match,
      ...params,
      limit,
    );
    if (!hits.length) continue;

    const ids = [...new Set(hits.map((h) => h.sessionId))];
    const sessions = db.all<Session>(
      `SELECT * FROM sessions WHERE id IN (${ids.map(() => "?").join(",")})`,
      ...ids,
    );
    const total =
      db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid
           JOIN sessions s ON s.id = t.sessionId WHERE turns_fts MATCH ? ${where}`,
        match,
        ...params,
      )?.n ?? hits.length;
    return { query, hits, sessions, total };
  }

  return { query, hits: [], sessions: [], total: 0 };
}

export function listSessions(opts?: {
  source?: LedgerSource | null;
  limit?: number;
  offset?: number;
  project?: string | null;
}): { sessions: Session[]; total: number } {
  const db = ledgerDb();
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.source) {
    filters.push("source = ?");
    params.push(opts.source);
  }
  if (opts?.project) {
    filters.push("project = ?");
    params.push(opts.project);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions ${where}`, ...params)?.n ?? 0;
  const sessions = db.all<Session>(
    `SELECT * FROM sessions ${where} ORDER BY COALESCE(endedAt, 0) DESC LIMIT ? OFFSET ?`,
    ...params,
    Math.min(200, Math.max(1, opts?.limit ?? 50)),
    Math.max(0, opts?.offset ?? 0),
  );
  return { sessions, total };
}

export function readSession(id: string): { session: Session; turns: (Turn & { seq: number })[] } | null {
  const db = ledgerDb();
  const session = db.get<Session>("SELECT * FROM sessions WHERE id = ?", id);
  if (!session) return null;
  const turns = db.all<Turn & { seq: number }>(
    "SELECT seq, role, text, at FROM turns WHERE sessionId = ? ORDER BY seq ASC",
    id,
  );
  return { session, turns };
}

export type LedgerStatus = {
  sessions: number;
  turns: number;
  words: number;
  bySource: { source: LedgerSource; sessions: number; turns: number; newest: number | null }[];
  projects: { project: string; sessions: number }[];
  oldest: number | null;
  newest: number | null;
  diskBytes: number;
  lastIndexedAt: number | null;
};

export async function ledgerStatus(): Promise<LedgerStatus> {
  const db = ledgerDb();
  const totals = db.get<{ sessions: number; turns: number; words: number; oldest: number | null; newest: number | null; lastIndexedAt: number | null }>(
    `SELECT COUNT(*) AS sessions, COALESCE(SUM(turns),0) AS turns, COALESCE(SUM(words),0) AS words,
            MIN(startedAt) AS oldest, MAX(endedAt) AS newest, MAX(indexedAt) AS lastIndexedAt
       FROM sessions`,
  );
  return {
    sessions: totals?.sessions ?? 0,
    turns: totals?.turns ?? 0,
    words: totals?.words ?? 0,
    bySource: db.all(
      `SELECT source, COUNT(*) AS sessions, COALESCE(SUM(turns),0) AS turns, MAX(endedAt) AS newest
         FROM sessions GROUP BY source ORDER BY sessions DESC`,
    ),
    projects: db.all(
      `SELECT project, COUNT(*) AS sessions FROM sessions
        WHERE project IS NOT NULL AND project <> '' GROUP BY project
        ORDER BY sessions DESC LIMIT 20`,
    ),
    oldest: totals?.oldest ?? null,
    newest: totals?.newest ?? null,
    diskBytes: await dbSize("ledger"),
    lastIndexedAt: totals?.lastIndexedAt || null,
  };
}

// ----------------------------------------------------------------------- ask

const ASK_SYSTEM = `You answer questions about the user's own past AI conversations, using only the numbered excerpts.

Rules:
- Only what the excerpts say. Never reconstruct code or commands from memory.
- When the answer is a snippet — a regex, a command, a config — reproduce it exactly as written in the excerpt, in a fenced block.
- Cite the excerpt numbers you used, like [2].
- Say which conversation and roughly when.
- If the excerpts do not answer it, say so and name what they do cover.`;

export type LedgerAnswer = {
  question: string;
  answer: string | null;
  needsModel: boolean;
  hits: LedgerHit[];
};

/** Search, then answer across what was found. */
export async function askLedger(question: string): Promise<LedgerAnswer> {
  const { hits } = searchLedger(question, { limit: 14 });
  if (!hits.length) return { question, answer: null, needsModel: false, hits: [] };

  const detection = await detectOllama().catch(() => null);
  const model = detection?.running ? recommendModel(detection.models) : null;
  if (!model) return { question, answer: null, needsModel: true, hits };

  const db = ledgerDb();
  /*
   * The neighbours matter more than the hit.
   *
   * A search hit is one turn, and a regex you worked out lives in the reply
   * AFTER the message that matched. Pulling the turn before and the two after
   * gives the model the exchange rather than the keyword, which is the
   * difference between "you discussed a regex" and the regex.
   */
  const excerpts = hits.slice(0, 8).map((hit, i) => {
    const around = db.all<{ role: string; text: string }>(
      "SELECT role, text FROM turns WHERE sessionId = ? AND seq BETWEEN ? AND ? ORDER BY seq",
      hit.sessionId,
      hit.seq - 1,
      hit.seq + 2,
    );
    const when = hit.at
      ? new Date(hit.at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : "unknown date";
    const body = around
      .map((turn) => `${turn.role === "user" ? "You" : "Assistant"}: ${turn.text.slice(0, 2_000)}`)
      .join("\n");
    return `[${i + 1}] ${SOURCE_LABEL[hit.source]} · ${hit.title ?? "untitled"} · ${when}\n${body}`;
  });

  const answer = await generate(
    model,
    `Question: ${question}\n\nExcerpts from past conversations:\n\n${excerpts.join("\n\n")}\n\nAnswer:`,
    { system: ASK_SYSTEM, timeoutMs: 120_000, maxTokens: 900 },
  ).catch(() => "");

  return { question, answer: answer.trim() || null, needsModel: false, hits };
}
