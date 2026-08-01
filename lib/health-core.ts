import { baseName, type WikiIndex } from "@/lib/index-core";
import { expiredFacts, type ExpiredFact } from "@/lib/page-facts";

/**
 * Wiki health, computed from an index.
 *
 * Pure, so the browser build reports the same numbers as the desktop one from
 * the same folder. A health score that disagreed between the two would be worse
 * than no score: the user would have to work out which one was lying.
 */

export type HealthReport = {
  score: number;
  pages: number;
  words: number;
  /** Pages nothing links to and that link nowhere — knowledge that fell out. */
  orphans: { id: string; title: string; relPath: string }[];
  /** [[links]] pointing at pages that don't exist yet. */
  unresolved: { from: string; target: string }[];
  /** Untouched for longer than the staleness window for their kind. */
  stale: { id: string; title: string; relPath: string; days: number }[];
  /**
   * Past the expiry their own author set.
   *
   * Distinct from `stale`, which is Lore guessing from a filename that a page
   * about pricing rots faster than a page about a decision. This is the author
   * saying how long they were willing to vouch for it, which is a far stronger
   * claim and deserves its own list.
   */
  expired: ExpiredFact[];
  untagged: number;
};

/**
 * Review windows in days. A page about a tool version rots far faster than a
 * page about a decision you made, so a single global "stale after 90 days"
 * threshold either screams about everything or catches nothing.
 */
const STALE_DAYS: { match: RegExp; days: number }[] = [
  { match: /pricing|cost|rate|invoice/i, days: 30 },
  { match: /tool|stack|version|setup|install|config/i, days: 90 },
  { match: /client|project|status|roadmap/i, days: 60 },
];
const STALE_DEFAULT_DAYS = 180;

/**
 * Optional per-vault override for the staleness windows above (see lib/policy).
 * Defaulting to the measured constants keeps every existing caller unchanged.
 */
export type WindowResolver = (id: string, title: string) => number;

export function renderHealth(index: WikiIndex, resolveWindow?: WindowResolver): HealthReport {
  const now = Date.now();
  const ids = new Set(index.pages.map((p) => p.id));

  const orphans = index.pages
    .filter((p) => !(index.backlinks[p.id]?.length ?? 0) && p.links.length === 0)
    .map((p) => ({ id: p.id, title: p.title, relPath: p.relPath }));

  const unresolved: { from: string; target: string }[] = [];
  for (const page of index.pages) {
    for (const target of page.rawLinks) {
      const key = target.toLowerCase();
      const hit =
        ids.has(target) ||
        index.pages.some(
          (p) => p.id.toLowerCase() === key || baseName(p.id).toLowerCase() === baseName(key),
        );
      if (!hit) unresolved.push({ from: page.id, target });
    }
  }

  const stale = index.pages
    .map((page) => {
      const window =
        resolveWindow?.(page.id, page.title) ??
        STALE_DAYS.find((rule) => rule.match.test(page.id) || rule.match.test(page.title))?.days ??
        STALE_DEFAULT_DAYS;
      const days = Math.floor((now - page.mtime) / 86_400_000);
      return { id: page.id, title: page.title, relPath: page.relPath, days, window };
    })
    .filter((p) => p.days > p.window)
    .sort((a, b) => b.days - a.days)
    .map(({ id, title, relPath, days }) => ({ id, title, relPath, days }));

  const untagged = index.pages.filter((p) => p.tags.length === 0).length;
  const expired = expiredFacts(index);
  const total = index.pages.length || 1;

  // A single number the user can watch move. Weighted so orphans and dead
  // links — the two things that actually make a wiki unusable to an agent —
  // cost more than a missing tag.
  const score = Math.max(
    0,
    Math.round(
      100 -
        (orphans.length / total) * 35 -
        Math.min(unresolved.length / total, 1) * 30 -
        (stale.length / total) * 20 -
        (untagged / total) * 15 -
        // Weighted per page rather than per corpus: an expired fact is a
        // promise the author made and the wiki broke, and ten of them on a
        // small vault should hurt as much as ten on a large one.
        Math.min(expired.length * 2, 15),
    ),
  );

  return {
    score,
    pages: index.pages.length,
    words: index.pages.reduce((sum, p) => sum + p.words, 0),
    orphans,
    unresolved,
    stale,
    expired,
    untagged,
  };
}

