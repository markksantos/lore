import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The desktop timeline — "what was I doing at 3pm?", answered.
 *
 * The recording itself is not ours. DesktopRecord is a native app that already
 * exists on this account: screenshots on change (perceptual-hash deduped),
 * Apple Vision OCR into SQLite FTS, frontmost app + window title + browser URL
 * per frame, activity blocks, and per-block notes synthesized by a local
 * model. Rebuilding that in Node would produce a worse recorder with no
 * Vision framework; what Lore adds is the half the recorder does not have —
 * retrieval, the wiki, agents, and Ask.
 *
 * So this module is a READER. It opens the app's SQLite read-only, answers
 * time questions, serves frames with strict containment, and — behind its own
 * opt-in — files each day's activity as a wiki page through the same write
 * path as every agent, which is what makes "what was I doing Tuesday?" a
 * question Ask can answer and an MCP tool can serve.
 *
 * Raw captures never enter the vault. A screenshot of your screen is the most
 * sensitive file your machine produces; they stay in the app's own store under
 * Application Support, and the wiki gets prose about them, not them.
 */

const STORE_DIR = path.join(os.homedir(), "Library", "Application Support", "DesktopRecord");
const DB_PATH = path.join(STORE_DIR, "desktoprecord.sqlite");

export type TimelineCapture = {
  uuid: string;
  at: number;
  app: string;
  bundleId: string;
  title: string;
  url: string | null;
  imagePath: string;
  ocrExcerpt: string;
};

export type TimelineBlock = {
  uuid: string;
  start: number;
  end: number;
  apps: string[];
  urls: string[];
  titles: string[];
  captureCount: number;
  representative: string | null;
  /** The synthesized note, when the app's model pass has run. */
  note: { summary: string; entities: string[]; facts: string[]; openThreads: string[] } | null;
};

export type TimelineStatus = {
  installed: boolean;
  recording: boolean;
  captures: number;
  days: number;
  newestAt: number | null;
  oldestAt: number | null;
};

/* node:sqlite is loaded lazily so the module can be imported in builds where
 * the experimental warning matters, and typed loosely because @types/node in
 * this repo predates it. Every statement below is read-only. */
type SqliteDb = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
    all: (...args: unknown[]) => Record<string, unknown>[];
  };
  close: () => void;
};

async function openDb(): Promise<SqliteDb | null> {
  const exists = await fs.stat(DB_PATH).then(() => true).catch(() => false);
  if (!exists) return null;
  try {
    // The specifier goes through a variable so TypeScript does not demand
    // type declarations @types/node does not ship yet for this runtime module.
    const specifier = "node:sqlite";
    const sqlite = (await import(specifier)) as unknown as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDb;
    };
    return new sqlite.DatabaseSync(DB_PATH, { readOnly: true });
  } catch {
    return null;
  }
}

/** Run one query against a fresh read-only handle, then close it. */
async function query<T>(work: (db: SqliteDb) => T): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return work(db);
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      // A close failure on a read-only handle costs nothing.
    }
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Parse the app's JSON-array columns without trusting them. */
function list(v: unknown): string[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

export async function timelineStatus(): Promise<TimelineStatus> {
  const installed = await fs
    .stat(DB_PATH)
    .then(() => true)
    .catch(() => false);
  if (!installed) {
    return { installed, recording: false, captures: 0, days: 0, newestAt: null, oldestAt: null };
  }
  const stats = await query((db) => {
    const row = db
      .prepare("SELECT COUNT(*) AS n, MIN(timestamp) AS oldest, MAX(timestamp) AS newest FROM captures")
      .get();
    const days = db.prepare("SELECT COUNT(DISTINCT day) AS d FROM captures").get();
    return { row, days };
  });
  const n = num(stats?.row?.n);
  const newest = stats?.row?.newest == null ? null : num(stats.row.newest) * 1000;
  return {
    installed,
    // "Recording" means frames landed in the last ten minutes — the DB cannot
    // say whether the process is alive, only whether it is producing.
    recording: newest !== null && Date.now() - newest < 10 * 60_000,
    captures: n,
    days: num(stats?.days?.d),
    newestAt: newest,
    oldestAt: stats?.row?.oldest == null ? null : num(stats.row.oldest) * 1000,
  };
}

/** The blocks (with notes) and captures around a moment, widest first. */
export async function around(
  atMs: number,
  windowMinutes = 45,
): Promise<{ blocks: TimelineBlock[]; captures: TimelineCapture[] }> {
  const from = (atMs - windowMinutes * 60_000) / 1000;
  const to = (atMs + windowMinutes * 60_000) / 1000;

  const result = await query((db) => {
    const blocks = db
      .prepare(
        `SELECT b.*, n.summary, n.entities, n.facts, n.open_threads
         FROM blocks b LEFT JOIN notes n ON n.block_uuid = b.uuid
         WHERE b.end_ts >= ? AND b.start_ts <= ?
         ORDER BY b.start_ts ASC LIMIT 40`,
      )
      .all(from, to);
    const captures = db
      .prepare(
        `SELECT uuid, timestamp, active_app_name, active_app_bundle_id,
                active_window_title, browser_url, image_path, ocr_text
         FROM captures WHERE timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC LIMIT 400`,
      )
      .all(from, to);
    return { blocks, captures };
  });

  if (!result) return { blocks: [], captures: [] };

  return {
    blocks: result.blocks.map((b) => ({
      uuid: str(b.uuid),
      start: num(b.start_ts) * 1000,
      end: num(b.end_ts) * 1000,
      apps: list(b.bundle_ids),
      urls: list(b.urls),
      titles: list(b.titles),
      captureCount: num(b.capture_count),
      representative: b.representative_capture_uuid ? str(b.representative_capture_uuid) : null,
      note: b.summary
        ? {
            summary: str(b.summary),
            entities: list(b.entities),
            facts: list(b.facts),
            openThreads: list(b.open_threads),
          }
        : null,
    })),
    captures: result.captures.map((c) => ({
      uuid: str(c.uuid),
      at: num(c.timestamp) * 1000,
      app: str(c.active_app_name),
      bundleId: str(c.active_app_bundle_id),
      title: str(c.active_window_title),
      url: c.browser_url ? str(c.browser_url) : null,
      imagePath: str(c.image_path),
      // An excerpt, not the full OCR: a frame of a code editor OCRs to
      // kilobytes, and the caller wanting more has the frame itself.
      ocrExcerpt: str(c.ocr_text).replace(/\s+/g, " ").trim().slice(0, 280),
    })),
  };
}

/** Full-text search over everything the screen has shown, via the app's FTS. */
export async function searchScreen(
  q: string,
  limit = 30,
): Promise<{ at: number; app: string; title: string; snippet: string; uuid: string }[]> {
  if (!q.trim()) return [];
  const rows = await query((db) =>
    db
      .prepare(
        `SELECT c.uuid, c.timestamp, c.active_app_name, c.active_window_title,
                snippet(captures_fts, 0, '', '', ' … ', 12) AS snip
         FROM captures_fts JOIN captures c ON c.id = captures_fts.rowid
         WHERE captures_fts MATCH ? ORDER BY c.timestamp DESC LIMIT ?`,
      )
      // FTS5 syntax characters in a user query are noise, not operators.
      .all(q.replace(/["'*^]/g, " ").trim(), limit),
  );
  return (rows ?? []).map((r) => ({
    uuid: str(r.uuid),
    at: num(r.timestamp) * 1000,
    app: str(r.active_app_name),
    title: str(r.active_window_title),
    snippet: str(r.snip),
  }));
}

/**
 * Resolve a capture's image to a servable absolute path.
 *
 * By uuid, never by caller-supplied path — an endpoint that accepts a path and
 * serves the file is a read primitive over the whole disk wearing a timeline
 * costume. The uuid is looked up, and the resulting path must still resolve
 * inside the app's store before a byte leaves.
 */
export async function frameFor(uuid: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(uuid)) return null;
  const row = await query((db) =>
    db.prepare("SELECT image_path FROM captures WHERE uuid = ?").get(uuid),
  );
  const imagePath = str(row?.image_path);
  if (!imagePath) return null;
  const absolute = path.isAbsolute(imagePath) ? imagePath : path.join(STORE_DIR, imagePath);
  const resolved = path.resolve(absolute);
  if (!resolved.startsWith(path.resolve(STORE_DIR) + path.sep)) return null;
  return fs
    .stat(resolved)
    .then((s) => (s.isFile() ? resolved : null))
    .catch(() => null);
}

// -------------------------------------------------------------------- filing

/**
 * A day of activity as one wiki page.
 *
 * The recorder's notes live in its SQLite, which Ask cannot retrieve from and
 * agents cannot cite. Filing renders each day's blocks as prose under
 * timeline/, through POST /api/page like any other agent write — attributed,
 * journalled, feedback-checked. Screenshots are referenced by time, never
 * copied: the page says what you were doing; the Timeline screen shows it.
 */
export function renderDayPage(day: string, blocks: TimelineBlock[]): string {
  const lines: string[] = [];
  const hhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  for (const block of blocks) {
    if (block.end - block.start < 3 * 60_000 && !block.note) continue;
    const apps = block.apps
      .map((id) => id.split(".").pop() ?? id)
      .filter((v, i, all) => all.indexOf(v) === i)
      .slice(0, 4);
    lines.push(`## ${hhmm(block.start)}–${hhmm(block.end)} — ${apps.join(", ") || "screen"}`);
    lines.push("");
    if (block.note) {
      lines.push(block.note.summary.trim());
      for (const fact of block.note.facts.slice(0, 6)) lines.push(`- ${fact}`);
      if (block.note.openThreads.length) {
        lines.push(`- Open: ${block.note.openThreads.slice(0, 3).join("; ")}`);
      }
    } else {
      const titles = block.titles.filter(Boolean).slice(0, 3).join(" · ");
      if (titles) lines.push(titles);
    }
    const urls = block.urls.filter(Boolean).slice(0, 4);
    if (urls.length) lines.push(`Sites: ${urls.join(", ")}`);
    lines.push("");
  }

  if (!lines.length) return "";
  return [`# ${day}`, "", ...lines].join("\n");
}

/** Every block of one day, oldest first. */
export async function blocksForDay(day: string): Promise<TimelineBlock[]> {
  const start = Date.parse(`${day}T00:00:00`);
  if (!Number.isFinite(start)) return [];
  return (await around(start + 12 * 3_600_000, 12 * 60)).blocks;
}
