import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Page history.
 *
 * The journal already records that a page changed, and by how many lines. What
 * it could never do is give you the text back — the shadow copy holds exactly
 * one version, the current one, because its only job was to diff against.
 *
 * So every time the watcher is about to overwrite a shadow, the copy it is
 * about to lose is kept here first. That turns "an agent rewrote 400 lines of
 * this page last Tuesday" from a statistic into something you can read, diff and
 * put back.
 *
 * Deliberately outside the vault, in `~/.lore/history/<vaultKey>/`. A wiki that
 * is already a git repo should not grow a second, competing history inside
 * itself, and a wiki that is not should not suddenly start.
 *
 * Snapshots are content-addressed by hash, so a page rewritten back to a
 * previous state does not store a third copy of it.
 */

const DIR = path.join(os.homedir(), ".lore");
const historyDir = (key: string) => path.join(DIR, "history", key);

/** Per page. Enough to cover a bad week of agent edits, bounded so it cannot grow forever. */
const MAX_VERSIONS = 40;

export type Version = {
  /** When this content STOPPED being current — the moment it was replaced. */
  at: number;
  hash: string;
  bytes: number;
  lines: number;
};

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/**
 * Flat, reversible encoding of a page path into a directory name.
 *
 * Nesting real directories under history/ would mirror the vault's tree, which
 * breaks the moment a folder is renamed to something that was previously a
 * file. Percent-encoding the separator keeps one directory per page for the
 * life of that path, and stays readable when someone goes looking by hand.
 */
const slug = (relPath: string) => relPath.replace(/%/g, "%25").replace(/\//g, "%2F");

const pageDir = (key: string, relPath: string) => path.join(historyDir(key), slug(relPath));

/**
 * Keep a copy of `content` as a past version of `relPath`.
 *
 * Called with the text that is about to be replaced, never the new text — a
 * snapshot of the current state would be indistinguishable from the live file
 * and would double the disk cost for nothing.
 */
export async function snapshot(key: string, relPath: string, content: string): Promise<void> {
  try {
    const dir = pageDir(key, relPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const hash = hashOf(content);
    const file = path.join(dir, `${Date.now()}.${hash}.snap`);

    // Content-addressed: if the most recent snapshot is byte-identical there is
    // nothing to record. This is common — a save that only touched frontmatter
    // leaves the body untouched, and reconcile can re-observe a settled file.
    const existing = await listRaw(key, relPath);
    if (existing[0]?.hash === hash) return;

    await fs.writeFile(file, content, "utf8");

    for (const stale of existing.slice(MAX_VERSIONS - 1)) {
      await fs.rm(path.join(dir, stale.file), { force: true }).catch(() => {});
    }
  } catch {
    // History is a convenience layered on top of the watcher. If it cannot be
    // written the write itself must still be observed and journaled.
  }
}

type RawVersion = Version & { file: string };

async function listRaw(key: string, relPath: string): Promise<RawVersion[]> {
  const dir = pageDir(key, relPath);
  const names = await fs.readdir(dir).catch(() => [] as string[]);

  const out: RawVersion[] = [];
  for (const file of names) {
    const match = /^(\d+)\.([a-f0-9]+)\.snap$/.exec(file);
    if (!match) continue;
    const stat = await fs.stat(path.join(dir, file)).catch(() => null);
    if (!stat) continue;
    out.push({
      at: Number(match[1]),
      hash: match[2],
      file,
      bytes: stat.size,
      // Cheap and good enough for a picker; reading every snapshot to count
      // lines exactly would make listing a page's history O(disk).
      lines: 0,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Newest first. */
export async function listVersions(key: string, relPath: string): Promise<Version[]> {
  const raw = await listRaw(key, relPath);
  return raw.map(({ at, hash, bytes }) => ({ at, hash, bytes, lines: 0 }));
}

export async function readVersion(
  key: string,
  relPath: string,
  at: number,
): Promise<string | null> {
  const raw = await listRaw(key, relPath);
  const hit = raw.find((v) => v.at === at);
  if (!hit) return null;
  return fs.readFile(path.join(pageDir(key, relPath), hit.file), "utf8").catch(() => null);
}

/** Every page that has at least one stored version, for history search. */
export async function pagesWithHistory(key: string): Promise<string[]> {
  const names = await fs.readdir(historyDir(key)).catch(() => [] as string[]);
  return names.map((n) => n.replace(/%2F/g, "/").replace(/%25/g, "%"));
}

export type HistoryHit = {
  relPath: string;
  at: number;
  /** The matching line, trimmed, with a little of what surrounds it. */
  excerpt: string;
};

/**
 * Search text that is no longer in the wiki.
 *
 * The point is recovering things that were deleted: "I know we wrote down why
 * we picked Postgres, and now nothing says it." Live search cannot find that by
 * definition, because the sentence is gone.
 */
export async function searchHistory(
  key: string,
  query: string,
  limit = 40,
): Promise<HistoryHit[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 3) return [];

  const hits: HistoryHit[] = [];
  for (const relPath of await pagesWithHistory(key)) {
    for (const version of await listRaw(key, relPath)) {
      if (hits.length >= limit) return hits;
      const text = await fs
        .readFile(path.join(pageDir(key, relPath), version.file), "utf8")
        .catch(() => "");
      const line = text.split("\n").find((l) => l.toLowerCase().includes(needle));
      if (line) hits.push({ relPath, at: version.at, excerpt: line.trim().slice(0, 240) });
    }
  }
  return hits;
}
