import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, dropDb, dbSize, ftsLadder, type Db } from "@/lib/signal-store";
import { scrub } from "@/lib/listen";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import {
  ADAPTERS,
  ORACLE_LABEL,
  ORACLE_SOURCES,
  ORACLE_WHERE,
  NEEDS_FULL_DISK,
  type OracleItem,
  type OracleSource,
} from "@/lib/oracle-sources";

/**
 * Oracle — one search bar over everything on this machine.
 *
 * The complaint the feature answers is specific: people assume a computer with
 * an AI on it can answer "when did I first talk to someone about that project",
 * and it cannot, because the answer is spread across Mail, Messages, a calendar
 * invitation and a folder of files, and nothing indexes all four together.
 * Spotlight indexes files. Mail searches mail. Nothing searches *you*.
 *
 * So Oracle is one table with everything in it, one full-text index over that
 * table, and a local model on top that answers in sentences and cites the item
 * it read. The interesting engineering is in lib/oracle-sources.ts, which knows
 * how each application stores what it stores; this file is the part that makes
 * seven very different things comparable.
 *
 * Three decisions worth defending:
 *
 * PER-SOURCE CONSENT AND PER-SOURCE PROGRESS. Indexing Mail is a different
 * decision from indexing Messages, and each keeps its own cursor so switching
 * one on does not re-read the others.
 *
 * BOUNDED PASSES. Each pass takes at most a few thousand items per source. A
 * first index of a decade of mail therefore completes over several passes
 * rather than in one twenty-minute stall, and can be interrupted at any point
 * without losing what it already did.
 *
 * REDACTION BEFORE STORAGE. Everything goes through the same secret scrubber
 * the rest of Lore uses. Mail in particular is full of pasted credentials.
 */

export type OracleConfig = {
  sources: Record<OracleSource, boolean>;
  /** Folders the `files` source walks. Nothing is walked by default. */
  roots: string[];
  /** Items per source per pass. */
  batch: number;
  /** Skip files larger than this many megabytes. */
  maxFileMb: number;
  redact: boolean;
};

export const DEFAULT_ORACLE: OracleConfig = {
  /*
   * Every source starts off, including files.
   *
   * The temptation is to default `files` on and point it at ~/Documents, since
   * it needs no special permission. That would make Oracle useful thirty
   * seconds sooner and would also mean a person who enabled "Oracle" got a
   * full-text index of their documents they did not specifically ask for. The
   * switch list is the consent; it should have nothing pre-ticked.
   */
  sources: {
    files: false,
    mail: false,
    calendar: false,
    messages: false,
    notes: false,
    browser: false,
    photos: false,
  },
  roots: [],
  batch: 2_000,
  maxFileMb: 8,
  redact: true,
};

const ORACLE_DIR = path.join(os.homedir(), ".lore", "oracle");
const CONFIG_FILE = path.join(ORACLE_DIR, "config.json");

export async function readOracleConfig(): Promise<OracleConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_ORACLE;
  try {
    const parsed = JSON.parse(raw) as Partial<OracleConfig>;
    return {
      sources: { ...DEFAULT_ORACLE.sources, ...(parsed.sources ?? {}) },
      roots: Array.isArray(parsed.roots)
        ? parsed.roots.filter((r): r is string => typeof r === "string" && r.startsWith("/")).slice(0, 24)
        : [],
      batch: Math.min(20_000, Math.max(100, Number(parsed.batch) || DEFAULT_ORACLE.batch)),
      maxFileMb: Math.min(200, Math.max(1, Number(parsed.maxFileMb) || DEFAULT_ORACLE.maxFileMb)),
      redact: parsed.redact !== false,
    };
  } catch {
    return DEFAULT_ORACLE;
  }
}

export async function writeOracleConfig(config: OracleConfig): Promise<OracleConfig> {
  await fs.mkdir(ORACLE_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

// --------------------------------------------------------------------- store

const MIGRATIONS = [
  `
  CREATE TABLE items (
    id        INTEGER PRIMARY KEY,
    source    TEXT NOT NULL,
    nativeId  TEXT NOT NULL,
    title     TEXT,
    body      TEXT NOT NULL DEFAULT '',
    who       TEXT,
    at        INTEGER,
    uri       TEXT,
    meta      TEXT,
    indexedAt INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX items_native ON items(source, nativeId);
  CREATE INDEX items_at ON items(at DESC);
  CREATE INDEX items_source_at ON items(source, at DESC);
  CREATE VIRTUAL TABLE items_fts USING fts5(
    title, body, who, tokenize = 'porter unicode61'
  );

  /* One row per source: how far it has read, and how the last pass went. */
  CREATE TABLE progress (
    source   TEXT PRIMARY KEY,
    since    INTEGER NOT NULL DEFAULT 0,
    lastAt   INTEGER NOT NULL DEFAULT 0,
    items    INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0,
    error    TEXT
  );
  `,
  /*
   * Two cursors, not one.
   *
   * `since` alone was wrong for every source that yields newest-first — Messages,
   * browser history, Notes, Photos, the calendar database. The first pass took
   * the newest N items and set `since` to the newest of them; the second pass
   * then asked for "anything newer than that" and correctly found nothing, so it
   * reported itself COMPLETE with a decade of history unread. The index looked
   * finished and was one batch deep.
   *
   * `backfill` is the other end: the oldest item stored so far. A pass walks
   * forward from `since` for anything new, and backwards from `backfill` for
   * history, and only claims completion when the backward walk runs dry.
   */
  `
  ALTER TABLE progress ADD COLUMN backfill INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE progress ADD COLUMN backfillDone INTEGER NOT NULL DEFAULT 0;
  `,
];

export function oracleDb(): Db {
  return openDb("oracle", MIGRATIONS);
}

export type OracleRow = {
  id: number;
  source: OracleSource;
  nativeId: string;
  title: string | null;
  body: string;
  who: string | null;
  at: number | null;
  uri: string | null;
  meta: string | null;
  indexedAt: number;
};

// ------------------------------------------------------------------ indexing

export type OraclePass = {
  source: OracleSource;
  added: number;
  updated: number;
  /** The source ran out of new items — this pass caught it up. */
  complete: boolean;
  ms: number;
  error: string | null;
};

/**
 * Read one source until its batch is full, from both ends of its history.
 *
 * Forward from `since` for anything new, then backward from `backfill` for
 * anything old, because a single forward cursor is wrong for every source that
 * yields newest-first: the first pass takes the newest N and moves the cursor
 * past them, and the second correctly finds nothing newer and calls itself
 * complete with a decade unread.
 *
 * `since` advances only to the newest item stored AND only to a time in the
 * past — the calendar yields events years ahead, and one of those setting the
 * forward cursor would mean nothing is ever "new" again.
 */
async function runSource(
  db: Db,
  source: OracleSource,
  config: OracleConfig,
): Promise<OraclePass> {
  const started = Date.now();
  const adapter = ADAPTERS[source];
  const progress = db.get<{ since: number; backfill: number; backfillDone: number }>(
    "SELECT since, backfill, backfillDone FROM progress WHERE source = ?",
    source,
  );
  const since = progress?.since ?? 0;
  const backfill = progress?.backfill ?? 0;
  const backfillDone = progress?.backfillDone === 1;

  let added = 0;
  let updated = 0;
  let newest = since;
  let oldest = backfill;
  let seen = 0;

  try {
    const probe = await adapter.probe();
    if (!probe.available) {
      db.run(
        `INSERT INTO progress (source, since, lastAt, items, complete, error) VALUES (?,?,?,0,0,?)
         ON CONFLICT(source) DO UPDATE SET lastAt = excluded.lastAt, error = excluded.error`,
        source,
        since,
        Date.now(),
        probe.reason,
      );
      return { source, added: 0, updated: 0, complete: false, ms: Date.now() - started, error: probe.reason };
    }

    /*
     * Forward first, then backward.
     *
     * New things matter more than old things: a message that arrived this
     * morning should be searchable before a message from 2019. So a pass asks
     * for anything newer than `since`, and spends whatever batch is left
     * walking backwards from `backfill` until the source runs out of history.
     */
    const store = (item: OracleItem) => {
      const title = item.title ? (config.redact ? scrub(item.title) : item.title) : null;
      const body = config.redact ? scrub(item.body) : item.body;
      const who = item.who ? (config.redact ? scrub(item.who) : item.who) : null;
      /* The URI is stored and shown, and a URL routinely carries a token in a
         query parameter. It goes through the scrubber like everything else. */
      const uri = item.uri && config.redact ? scrub(item.uri) : (item.uri ?? null);

      db.tx(() => {
        const existing = db.get<{ id: number }>(
          "SELECT id FROM items WHERE source = ? AND nativeId = ?",
          source,
          item.nativeId,
        );
        if (existing) {
          db.run(
            "UPDATE items SET title = ?, body = ?, who = ?, at = ?, uri = ?, meta = ?, indexedAt = ? WHERE id = ?",
            title,
            body,
            who,
            item.at,
            uri,
            item.meta ? JSON.stringify(item.meta) : null,
            Date.now(),
            existing.id,
          );
          db.run(
            "UPDATE items_fts SET title = ?, body = ?, who = ? WHERE rowid = ?",
            title ?? "",
            body,
            who ?? "",
            existing.id,
          );
          updated++;
        } else {
          const { lastInsertRowid } = db.run(
            "INSERT INTO items (source, nativeId, title, body, who, at, uri, meta, indexedAt) VALUES (?,?,?,?,?,?,?,?,?)",
            source,
            item.nativeId,
            title,
            body,
            who,
            item.at,
            uri,
            item.meta ? JSON.stringify(item.meta) : null,
            Date.now(),
          );
          db.run(
            "INSERT INTO items_fts (rowid, title, body, who) VALUES (?,?,?,?)",
            lastInsertRowid,
            title ?? "",
            body,
            who ?? "",
          );
          added++;
        }
      });

      /*
       * Only timestamps in the PAST move the forward cursor.
       *
       * The calendar yields events scheduled years ahead — a real one on the
       * development machine runs to 2031 — and letting one of those set `since`
       * poisons the cursor with a date in the future, after which nothing is
       * ever indexed again because nothing is ever "newer".
       */
      if (item.at && item.at > newest && item.at <= Date.now()) newest = item.at;
      if (item.at && (oldest === 0 || item.at < oldest)) oldest = item.at;
    };

    for await (const item of adapter.collect({
      since,
      before: 0,
      limit: config.batch,
      roots: config.roots,
      maxFileBytes: config.maxFileMb * 1_048_576,
    })) {
      seen++;
      store(item);
    }

    const remaining = Math.max(0, config.batch - seen);
    /*
     * The backward walk needs somewhere to walk back FROM, which the first pass
     * does not have — `backfill` is only set once something has been stored.
     * So pass one is forward-only by construction.
     */
    const backwardRan = !backfillDone && remaining > 0 && backfill > 0;
    let backfilled = 0;
    const addedBeforeBackfill = added;
    if (backwardRan) {
      for await (const item of adapter.collect({
        since: 0,
        before: backfill,
        limit: remaining,
        roots: config.roots,
        maxFileBytes: config.maxFileMb * 1_048_576,
      })) {
        backfilled++;
        store(item);
      }
    }

    /*
     * History is exhausted only once a backward walk has RUN and come back
     * empty.
     *
     * The first version treated "there is no backward cursor yet" as "there is
     * nothing behind us", so pass one — which cannot have a cursor — marked the
     * backfill finished and pass two called the source complete with one batch
     * indexed. Reproduced against real browser history: 150 rows on pass one,
     * then "complete" forever, with three months present and everything before
     * it unreachable.
     *
     * A source with no timeline (`files` walks a directory) yields nothing on
     * its first backward pass and is marked done then — one extra cheap pass,
     * and no special case anywhere.
     */
    /*
     * Dry means "found nothing NEW", not "yielded nothing".
     *
     * Some rows have no usable timestamp — a browser history entry with
     * `last_visit_time` of zero, a note whose modification date is a sentinel.
     * They are stored (they are still searchable) but they cannot advance the
     * backward cursor, and the SQL `< bound` returns them on every pass
     * forever. Measured: pass four onwards yielded the same 77 already-stored
     * rows and the source never once reported itself complete.
     */
    const backfillDoneNow = backfillDone || (backwardRan && added === addedBeforeBackfill);
    const complete = seen + backfilled < config.batch && backfillDoneNow;

    db.run(
      `INSERT INTO progress (source, since, lastAt, items, complete, error, backfill, backfillDone)
       VALUES (?,?,?,?,?,NULL,?,?)
       ON CONFLICT(source) DO UPDATE SET since = excluded.since, lastAt = excluded.lastAt,
         items = progress.items + excluded.items, complete = excluded.complete, error = NULL,
         backfill = excluded.backfill, backfillDone = excluded.backfillDone`,
      source,
      newest,
      Date.now(),
      added + updated,
      complete ? 1 : 0,
      oldest,
      backfillDoneNow ? 1 : 0,
    );
    return { source, added, updated, complete, ms: Date.now() - started, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.run(
      `INSERT INTO progress (source, since, lastAt, items, complete, error) VALUES (?,?,?,0,0,?)
       ON CONFLICT(source) DO UPDATE SET lastAt = excluded.lastAt, error = excluded.error`,
      source,
      since,
      Date.now(),
      message.slice(0, 300),
    );
    return { source, added, updated, complete: false, ms: Date.now() - started, error: message };
  }
}

export async function reindexOracle(only?: OracleSource[]): Promise<{ passes: OraclePass[]; ms: number }> {
  const started = Date.now();
  const config = await readOracleConfig();
  const db = oracleDb();
  const passes: OraclePass[] = [];
  for (const source of ORACLE_SOURCES) {
    if (!config.sources[source]) continue;
    if (only && !only.includes(source)) continue;
    passes.push(await runSource(db, source, config));
  }
  return { passes, ms: Date.now() - started };
}

/** Start a source over from nothing — after adding a folder, say. */
export function resetSource(source: OracleSource): void {
  const db = oracleDb();
  db.tx(() => {
    db.run(
      "DELETE FROM items_fts WHERE rowid IN (SELECT id FROM items WHERE source = ?)",
      source,
    );
    db.run("DELETE FROM items WHERE source = ?", source);
    db.run("DELETE FROM progress WHERE source = ?", source);
  });
}

export async function forgetOracle(): Promise<void> {
  await dropDb("oracle");
}

// -------------------------------------------------------------------- search

export type OracleHit = {
  id: number;
  source: OracleSource;
  title: string | null;
  who: string | null;
  at: number | null;
  uri: string | null;
  snippet: string;
  score: number;
};

export type OracleQuery = {
  sources?: OracleSource[] | null;
  from?: number | null;
  to?: number | null;
  limit?: number;
};

export function searchOracle(query: string, opts?: OracleQuery): { hits: OracleHit[]; total: number } {
  const db = oracleDb();
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 40));
  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.sources?.length) {
    filters.push(`i.source IN (${opts.sources.map(() => "?").join(",")})`);
    params.push(...opts.sources);
  }
  if (opts?.from) {
    filters.push("i.at >= ?");
    params.push(opts.from);
  }
  if (opts?.to) {
    filters.push("i.at <= ?");
    params.push(opts.to);
  }
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

  for (const match of ftsLadder(query)) {
    const hits = db.all<OracleHit>(
      `SELECT i.id, i.source, i.title, i.who, i.at, i.uri,
              snippet(items_fts, 1, '«', '»', '…', 20) AS snippet,
              -bm25(items_fts, 4.0, 1.0, 2.0) AS score
         FROM items_fts
         JOIN items i ON i.id = items_fts.rowid
        WHERE items_fts MATCH ? ${where}
        ORDER BY score DESC
        LIMIT ?`,
      match,
      ...params,
      limit,
    );
    if (!hits.length) continue;
    const total =
      db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM items_fts JOIN items i ON i.id = items_fts.rowid
          WHERE items_fts MATCH ? ${where}`,
        match,
        ...params,
      )?.n ?? hits.length;
    return { hits, total };
  }
  return { hits: [], total: 0 };
}

export function readItem(id: number): OracleRow | null {
  return oracleDb().get<OracleRow>("SELECT * FROM items WHERE id = ?", id);
}

// ----------------------------------------------------------------------- ask

/**
 * A time window from a question, for the "over $2000 last quarter" shape.
 *
 * Shared vocabulary with Ghost's `parseWhen` but a different range: Ghost
 * reasons in minutes because it is answering about this afternoon, Oracle
 * reasons in months because it is answering about last year.
 */
export function parseOracleWhen(question: string, now = Date.now()): { from: number; to: number } | null {
  const text = question.toLowerCase();
  const date = new Date(now);
  const startOfYear = (offset = 0) => new Date(date.getFullYear() - offset, 0, 1).getTime();
  const startOfMonth = (offset = 0) =>
    new Date(date.getFullYear(), date.getMonth() - offset, 1).getTime();

  if (/\blast quarter\b/.test(text)) {
    const quarter = Math.floor(date.getMonth() / 3);
    const from = new Date(date.getFullYear(), (quarter - 1) * 3, 1).getTime();
    return { from, to: new Date(date.getFullYear(), quarter * 3, 1).getTime() };
  }
  if (/\bthis quarter\b/.test(text)) {
    const quarter = Math.floor(date.getMonth() / 3);
    return { from: new Date(date.getFullYear(), quarter * 3, 1).getTime(), to: now };
  }
  if (/\blast month\b/.test(text)) return { from: startOfMonth(1), to: startOfMonth(0) };
  if (/\bthis month\b/.test(text)) return { from: startOfMonth(0), to: now };
  if (/\blast year\b/.test(text)) return { from: startOfYear(1), to: startOfYear(0) };
  if (/\bthis year\b/.test(text)) return { from: startOfYear(0), to: now };

  const ago = text.match(/(\d+)\s*(day|week|month|year)s?\s+ago/);
  if (ago) {
    const amount = Number(ago[1]);
    const unit = ago[2];
    const ms =
      unit === "day" ? 86_400_000
      : unit === "week" ? 604_800_000
      : unit === "month" ? 2_629_800_000
      : 31_557_600_000;
    const centre = now - amount * ms;
    return { from: centre - ms, to: Math.min(now, centre + ms) };
  }

  const last = text.match(/\b(?:last|past)\s+(\d+)?\s*(day|week|month|year)s?/);
  if (last) {
    const amount = Number(last[1] ?? 1);
    const unit = last[2];
    const ms =
      unit === "day" ? 86_400_000
      : unit === "week" ? 604_800_000
      : unit === "month" ? 2_629_800_000
      : 31_557_600_000;
    return { from: now - amount * ms, to: now };
  }

  const year = text.match(/\b(20\d{2})\b/);
  if (year) {
    const y = Number(year[1]);
    return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
  }
  return null;
}

/**
 * Which sources a question is obviously about.
 *
 * "What did Jane say in that email" should not have to compete with a browser
 * history entry containing the same words. Only fires on an unambiguous noun —
 * a question that names no source searches everything, which is the default and
 * the right one.
 */
export function inferSources(question: string): OracleSource[] | null {
  const text = question.toLowerCase();
  const picked = new Set<OracleSource>();
  if (/\b(e-?mails?|inbox|mailbox|sent (?:me|you|it)?)\b/.test(text)) picked.add("mail");
  if (/\b(imessage|text(?:ed|s)?|messages?|sms)\b/.test(text)) picked.add("messages");
  if (/\b(calendar|meeting|invite|appointment|call with)\b/.test(text)) picked.add("calendar");
  if (/\b(note|notes)\b/.test(text)) picked.add("notes");
  if (/\b(website|browsed?|browsing|url|visited|link)\b/.test(text)) picked.add("browser");
  if (/\b(photos?|pictures?|screenshots?|image)\b/.test(text)) picked.add("photos");
  if (/\b(files?|documents?|folder|pdf|spreadsheet)\b/.test(text)) picked.add("files");
  return picked.size && picked.size < ORACLE_SOURCES.length ? [...picked] : null;
}

const ASK_SYSTEM = `You answer questions about the user's own files, mail, messages, calendar, notes, browsing and photos, using ONLY the numbered items.

Rules:
- Only what the items say. Never infer a fact that is not written down.
- Lead with the answer. "You first messaged Edan about it on 4 March 2026" — not "Based on the items provided".
- Cite the item numbers you used, like [3].
- Dates and names come from the items, exactly as written.
- If the items do not contain the answer, say so and say what they do show.
- Four sentences at most.`;

export type OracleAnswer = {
  question: string;
  answer: string | null;
  needsModel: boolean;
  window: { from: number; to: number } | null;
  sources: OracleSource[] | null;
  hits: OracleHit[];
};

export async function askOracle(question: string): Promise<OracleAnswer> {
  const window = parseOracleWhen(question);
  const sources = inferSources(question);
  let { hits } = searchOracle(question, {
    sources,
    from: window?.from ?? null,
    to: window?.to ?? null,
    limit: 16,
  });

  /*
   * Widen rather than answer "nothing found".
   *
   * The inferred source and the parsed window are both guesses, and a guess
   * that returns nothing is worse than no guess at all. Dropping them in turn —
   * source first, since it is the weaker signal — recovers the case where a
   * person said "email" about something that reached them as a calendar
   * invitation.
   */
  if (!hits.length && sources) {
    hits = searchOracle(question, { from: window?.from ?? null, to: window?.to ?? null, limit: 16 }).hits;
  }
  if (!hits.length && window) {
    hits = searchOracle(question, { limit: 16 }).hits;
  }

  if (!hits.length) {
    return { question, answer: null, needsModel: false, window, sources, hits: [] };
  }

  const detection = await detectOllama().catch(() => null);
  const model = detection?.running ? recommendModel(detection.models) : null;
  if (!model) return { question, answer: null, needsModel: true, window, sources, hits };

  const db = oracleDb();
  const items = hits.slice(0, 10).map((hit, i) => {
    const row = db.get<{ body: string }>("SELECT body FROM items WHERE id = ?", hit.id);
    const when = hit.at
      ? new Date(hit.at).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "no date";
    const head = [ORACLE_LABEL[hit.source], hit.title, hit.who, when].filter(Boolean).join(" · ");
    return `[${i + 1}] ${head}\n${(row?.body ?? hit.snippet).slice(0, 2_500)}`;
  });

  const answer = await generate(
    model,
    `Question: ${question}\n\nItems from the user's own data:\n\n${items.join("\n\n")}\n\nAnswer:`,
    { system: ASK_SYSTEM, timeoutMs: 120_000, maxTokens: 600 },
  ).catch(() => "");

  return { question, answer: answer.trim() || null, needsModel: false, window, sources, hits };
}

// -------------------------------------------------------------------- status

export type SourceStatus = {
  source: OracleSource;
  label: string;
  where: string;
  needsFullDisk: boolean;
  enabled: boolean;
  available: boolean;
  reason: string;
  items: number;
  newest: number | null;
  complete: boolean;
  lastAt: number | null;
  error: string | null;
};

export type OracleStatus = {
  items: number;
  diskBytes: number;
  sources: SourceStatus[];
  oldest: number | null;
  newest: number | null;
};

export async function oracleStatus(): Promise<OracleStatus> {
  const config = await readOracleConfig();
  const db = oracleDb();
  const counts = new Map(
    db
      .all<{ source: OracleSource; n: number; newest: number | null }>(
        "SELECT source, COUNT(*) AS n, MAX(at) AS newest FROM items GROUP BY source",
      )
      .map((row) => [row.source, row]),
  );
  const progress = new Map(
    db
      .all<{ source: OracleSource; complete: number; lastAt: number; error: string | null }>(
        "SELECT source, complete, lastAt, error FROM progress",
      )
      .map((row) => [row.source, row]),
  );

  const sources: SourceStatus[] = [];
  for (const source of ORACLE_SOURCES) {
    /* Probed even when disabled: the settings screen has to be able to say
       "Messages · needs Full Disk Access" beside an off switch, so the user
       knows what turning it on will ask of them. */
    const probe = await ADAPTERS[source].probe().catch((error: unknown) => ({
      available: false,
      reason: error instanceof Error ? error.message : "Could not check this source.",
    }));
    const row = progress.get(source);
    sources.push({
      source,
      label: ORACLE_LABEL[source],
      where: source === "files" ? config.roots.join(", ") || ORACLE_WHERE.files : ORACLE_WHERE[source],
      needsFullDisk: NEEDS_FULL_DISK.includes(source),
      enabled: config.sources[source],
      available: probe.available,
      reason: probe.reason,
      items: counts.get(source)?.n ?? 0,
      newest: counts.get(source)?.newest ?? null,
      complete: row?.complete === 1,
      lastAt: row?.lastAt ?? null,
      error: row?.error ?? null,
    });
  }

  const totals = db.get<{ n: number; oldest: number | null; newest: number | null }>(
    "SELECT COUNT(*) AS n, MIN(at) AS oldest, MAX(at) AS newest FROM items",
  );

  return {
    items: totals?.n ?? 0,
    diskBytes: await dbSize("oracle"),
    sources,
    oldest: totals?.oldest ?? null,
    newest: totals?.newest ?? null,
  };
}
