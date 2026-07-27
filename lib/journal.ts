import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import chokidar, { type FSWatcher } from "chokidar";
import { invalidateVault } from "@/lib/wiki";
import { snapshot } from "@/lib/history";

/**
 * The write journal.
 *
 * Measured on a real vault: 303 pages changed in seven days, 56 in the last
 * day, and 60 of 75 modified files were in-place rewrites rather than appends —
 * roughly 1,500 lines of existing prose deleted, unreviewed.
 *
 * You cannot gate that. An earlier design tried: an MCP `propose_edit` tool
 * that queued changes for approval. Agents ignored it, because it competed with
 * their built-in write tool and lost. And even a perfect gate would produce a
 * 303-item weekly queue, which resolves to "Accept All" and false confidence —
 * worse than no gate at all.
 *
 * So this watches instead. It is deliberately harness-agnostic: it observes the
 * filesystem, so it captures Claude Code, Cursor, a shell script, Obsidian and
 * your own hand equally. Nothing has to opt in.
 *
 * What it records is chosen to answer one question — *did an agent quietly
 * delete something I cared about?* — so it tracks bytes and lines REMOVED as
 * carefully as those added, and classifies rewrites separately from appends.
 */

const DIR = path.join(os.homedir(), ".lore");
const journalPath = (vaultKey: string) => path.join(DIR, `journal-${vaultKey}.jsonl`);
const shadowDir = (vaultKey: string) => path.join(DIR, "shadow", vaultKey);

/** Stable short key per vault so two linked wikis never share a journal. */
export function vaultKey(root: string): string {
  return crypto.createHash("sha1").update(root).digest("hex").slice(0, 10);
}

export type WriteKind = "created" | "appended" | "rewritten" | "deleted";

export type WriteEvent = {
  at: number;
  relPath: string;
  kind: WriteKind;
  linesAdded: number;
  linesRemoved: number;
  /**
   * Content hash of the raw file after the write. Recorded but not currently
   * read: the trust ledger pins its own hash of the page's plain-text body,
   * computed at verify time, so the two are not comparable.
   */
  hash: string;
};

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/**
 * Classify a change by comparing against the previous copy we kept.
 *
 * "Appended" means every line that existed before still exists in order at the
 * top — the safe kind. Anything that alters or drops prior lines is a rewrite,
 * which is the kind worth a human's attention.
 */
function classify(before: string | null, after: string | null): {
  kind: WriteKind;
  linesAdded: number;
  linesRemoved: number;
} {
  if (before === null) {
    return { kind: "created", linesAdded: after ? after.split("\n").length : 0, linesRemoved: 0 };
  }
  if (after === null) {
    return { kind: "deleted", linesAdded: 0, linesRemoved: before.split("\n").length };
  }

  const b = before.split("\n");
  const a = after.split("\n");

  let prefix = 0;
  while (prefix < b.length && prefix < a.length && b[prefix] === a[prefix]) prefix++;

  const isPureAppend = prefix === b.length && a.length >= b.length;
  if (isPureAppend) {
    return { kind: "appended", linesAdded: a.length - b.length, linesRemoved: 0 };
  }

  let suffix = 0;
  while (
    suffix < b.length - prefix &&
    suffix < a.length - prefix &&
    b[b.length - 1 - suffix] === a[a.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    kind: "rewritten",
    linesAdded: Math.max(0, a.length - prefix - suffix),
    linesRemoved: Math.max(0, b.length - prefix - suffix),
  };
}

async function readShadow(key: string, relPath: string): Promise<string | null> {
  const p = path.join(shadowDir(key), relPath);
  return fs.readFile(p, "utf8").catch(() => null);
}

async function writeShadow(key: string, relPath: string, content: string): Promise<void> {
  const p = path.join(shadowDir(key), relPath);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf8").catch(() => {});
}

export async function appendEvent(key: string, event: WriteEvent): Promise<void> {
  try {
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    await fs.appendFile(journalPath(key), JSON.stringify(event) + "\n", "utf8");
  } catch {
    // Observation must never break the thing being observed.
  }
}

export async function readJournal(key: string, sinceMs = 0): Promise<WriteEvent[]> {
  const raw = await fs.readFile(journalPath(key), "utf8").catch(() => "");
  const out: WriteEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as WriteEvent;
      if (e.at >= sinceMs) out.push(e);
    } catch {
      // Torn final line from a killed process; skipping is correct.
    }
  }
  return out;
}

// ------------------------------------------------------------------- watcher

const watchers = new Map<string, FSWatcher>();

/**
 * Start watching a vault. Idempotent per root.
 *
 * Two details that matter on real editors:
 *  - `awaitWriteFinish` absorbs atomic saves. Most editors write to a temp file
 *    and rename, which fires add/unlink/add in milliseconds; without debouncing
 *    the journal fills with phantom delete-recreate pairs.
 *  - We only journal when the CONTENT hash actually changed. Agents and editors
 *    both rewrite files with identical bytes surprisingly often, and a journal
 *    full of no-op entries is a journal nobody reads.
 *
 * The watcher is HASH-AUTHORITATIVE: a filesystem event is treated as a hint to
 * go and re-hash, never as a fact about what happened. That matters because the
 * events genuinely lie — chokidar throttles `change` at 50ms with no trailing
 * event, so the last write in a fast burst can be dropped, and on Windows libuv
 * uses a 4KB buffer whose overflow surfaces only as a null filename. A periodic
 * reconcile sweep therefore backstops the event stream; without it the journal
 * silently misses exactly the bursts an agent produces.
 */
export async function watchVault(root: string): Promise<void> {
  const key = vaultKey(root);
  if (watchers.has(key)) return;

  const watcher = chokidar.watch(root, {
    ignored: (p) => /(^|[/\\])(\.git|\.obsidian|\.trash|node_modules)([/\\]|$)/.test(p),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  const onChange = async (abs: string, removed = false) => {
    if (!/\.mdx?$/i.test(abs)) return;
    const relPath = path.relative(root, abs).split(path.sep).join("/");

    const after = removed ? null : await fs.readFile(abs, "utf8").catch(() => null);
    const before = await readShadow(key, relPath);

    if (after !== null && before !== null && hashOf(after) === hashOf(before)) return;

    const { kind, linesAdded, linesRemoved } = classify(before, after);
    await appendEvent(key, {
      at: Date.now(),
      relPath,
      kind,
      linesAdded,
      linesRemoved,
      hash: after === null ? "" : hashOf(after),
    });

    // Keep the version we are about to lose. The shadow holds exactly one copy
    // and is about to be overwritten, so this is the only moment the previous
    // text still exists anywhere.
    if (before !== null) await snapshot(key, relPath, before);

    if (after === null) {
      await fs.rm(path.join(shadowDir(key), relPath), { force: true }).catch(() => {});
    } else {
      await writeShadow(key, relPath, after);
    }

    // The scan cache has no other way to learn about a write it did not make.
    // Trust is pinned to a content hash, so a stale index means reporting a
    // page as verified after an agent has already rewritten it — the precise
    // failure this whole feature exists to catch.
    invalidateVault(root);
  };

  watcher
    .on("add", (p) => onChange(p))
    .on("change", (p) => onChange(p))
    .on("unlink", (p) => onChange(p, true));

  watchers.set(key, watcher);

  // Slow backstop for the events the OS drops. 90s is frequent enough that a
  // missed burst surfaces while you still remember causing it, and rare enough
  // that the hashing cost is invisible.
  const timer = setInterval(() => {
    reconcile(root).catch(() => {});
  }, 90_000);
  timer.unref?.();
  reconcilers.set(key, timer);
}

export async function stopWatching(root: string): Promise<void> {
  const key = vaultKey(root);
  await watchers.get(key)?.close();
  watchers.delete(key);
  const timer = reconcilers.get(key);
  if (timer) clearInterval(timer);
  reconcilers.delete(key);
}

const reconcilers = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Walk the vault and journal anything the event stream missed.
 *
 * This is the safety net for dropped events. It is cheap — hashing a 1,400-page
 * corpus is well under a second — so it runs on a slow interval and simply
 * compares every file against its shadow copy.
 */
export async function reconcile(root: string): Promise<number> {
  const key = vaultKey(root);
  const found: string[] = [];

  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (/^(\.|node_modules$)/.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (/\.mdx?$/i.test(entry.name)) {
        found.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  };
  await walk(root);

  let missed = 0;
  for (const relPath of found) {
    const after = await fs.readFile(path.join(root, relPath), "utf8").catch(() => null);
    if (after === null) continue;
    const before = await readShadow(key, relPath);
    if (before !== null && hashOf(before) === hashOf(after)) continue;

    const { kind, linesAdded, linesRemoved } = classify(before, after);
    await appendEvent(key, {
      at: Date.now(),
      relPath,
      kind,
      linesAdded,
      linesRemoved,
      hash: hashOf(after),
    });
    await writeShadow(key, relPath, after);
    missed += 1;
  }
  if (missed) invalidateVault(root);
  return missed;
}

/**
 * Seed the shadow copy from the current vault so the first real edit produces a
 * meaningful diff instead of reporting every page as newly created.
 */
export async function primeShadow(
  root: string,
  files: { relPath: string; text: string }[],
): Promise<void> {
  const key = vaultKey(root);
  const existing = await fs.readdir(shadowDir(key)).catch(() => null);
  if (existing && existing.length) return;
  for (const f of files) await writeShadow(key, f.relPath, f.text);
}
