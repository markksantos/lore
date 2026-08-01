import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";

/**
 * What you have already been told.
 *
 * The brief's problem was never really authorship — it was repetition. A screen
 * that hands you the same page tomorrow, and the page you opened an hour ago,
 * is a mirror however the ranking is justified. Reviewers described it as "half
 * my brief was pages I wrote myself"; the general form is "half my brief was
 * things I already knew".
 *
 * The first attempt at this leaned on the Claude Code attribution hook, so it
 * could only work on a machine where that hook was installed — which, on the
 * machine it was built for, it was not. This needs nothing installed. Two
 * things count as seen:
 *
 *   - a page the brief has already shown you, and
 *   - a page you have opened in Lore.
 *
 * Both are facts Lore observes by itself, on day one, with no configuration.
 *
 * Seen is a decay, not a ban. A page that changes substantially again should
 * come back — the point is that the SAME news does not arrive twice, not that a
 * page is spent forever.
 */

const DIR = path.join(os.homedir(), ".lore");

/**
 * Who "you" are, when the wiki is shared.
 *
 * Seen state is per person, not per vault. On a shared wiki — a team repo, or
 * one folder synced across two machines — a single seen file means whoever
 * opens the brief first consumes the news for everybody else, and the second
 * reader is told they are up to date on things they have never seen.
 *
 * Defaults to the OS username, so a single-person setup behaves exactly as it
 * always has and nobody has to configure anything. LORE_USER overrides it for
 * people who share a login or want their two machines to count as one reader.
 */
function person(): string {
  const raw = (process.env.LORE_USER ?? os.userInfo().username ?? "me").trim();
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "me";
}

const filePath = (key: string) => path.join(DIR, `seen-${key}-${person()}.json`);

/** pageId → when it was last shown or opened. */
export type Seen = Record<string, number>;

/** Forget after this long, so a page can be news again in a new context. */
const FORGET_DAYS = 45;

export async function readSeen(root: string): Promise<Seen> {
  const key = vaultKey(root);
  let raw = await fs.readFile(filePath(key), "utf8").catch(() => "");
  /*
   * Fall back to the pre-per-person file.
   *
   * Seen state used to be one file per vault. Adding the reader to the name
   * would otherwise orphan it, and the first brief after upgrading would
   * present every page in the window as news — the exact failure this whole
   * module exists to prevent, introduced by the fix to a different one.
   */
  if (!raw) raw = await fs.readFile(path.join(DIR, `seen-${key}.json`), "utf8").catch(() => "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Seen;
    const cutoff = Date.now() - FORGET_DAYS * 86_400_000;
    // Prune on read: this file would otherwise grow one entry per page forever.
    return Object.fromEntries(Object.entries(parsed).filter(([, at]) => at > cutoff));
  } catch {
    return {};
  }
}

export async function markSeen(root: string, pageIds: string[]): Promise<void> {
  if (!pageIds.length) return;
  const seen = await readSeen(root);
  const now = Date.now();
  for (const id of pageIds) seen[id] = now;
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs
    .writeFile(filePath(vaultKey(root)), JSON.stringify(seen), "utf8")
    .catch(() => {});
}

/**
 * How much to discount a page you have already been told about.
 *
 * Strong immediately after, recovering over a couple of weeks. A page shown
 * this morning is worth almost nothing tonight; the same page three weeks later,
 * changed again, is news again.
 */
export function seenPenalty(seen: Seen, pageId: string, changedAt: number): number {
  const at = seen[pageId];
  if (!at) return 1;
  // Changed again since you last saw it — that is new information, not a repeat.
  if (changedAt > at + 60_000) return 0.75;
  const days = (Date.now() - at) / 86_400_000;
  if (days < 1) return 0.05;
  if (days < 7) return 0.25;
  if (days < 21) return 0.6;
  return 1;
}
