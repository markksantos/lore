import type { WikiIndex, WikiPage } from "@/lib/index-core";

/**
 * Two frontmatter fields Lore acts on: `expires` and `supersedes`.
 *
 * Both exist because a wiki's worst failure is not being wrong — it is being
 * confidently out of date, in a way nothing about the file can reveal. A price
 * from March and a price from yesterday look identical on disk. A page that has
 * been replaced looks exactly like the page that replaced it.
 *
 * `expires: 2026-09-01` is the author saying how long they are willing to
 * vouch for a number. Past that date the page still exists and still reads the
 * same; what changes is that Lore says so — in health, in the brief, and, most
 * importantly, to any agent that retrieves it.
 *
 * `supersedes: old/page.md` is the author saying which page this replaces.
 * That is a link the wiki cannot infer: two pages on one subject are usually
 * both current, and only whoever wrote the second one knows otherwise. Stated,
 * it turns a silent duplicate into a redirect.
 */

export type ExpiredFact = {
  id: string;
  relPath: string;
  title: string;
  /** Millisecond epoch of the stated expiry. */
  expires: number;
  /** Whole days past it; negative means it has not expired yet. */
  daysOver: number;
};

/**
 * Parse a frontmatter date without inventing one.
 *
 * `Date.parse` on a bare `2026-09-01` yields UTC midnight, which is what we
 * want; on anything it does not understand it yields NaN, and a NaN expiry must
 * read as "no expiry" rather than as "expired in 1970".
 */
function parseDate(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function expiryOf(page: WikiPage): number | null {
  const raw =
    page.frontmatter.expires ??
    page.frontmatter.expiry ??
    page.frontmatter.valid_until ??
    page.frontmatter.review_by;
  return parseDate(raw);
}

/** Pages whose stated expiry has passed, most overdue first. */
export function expiredFacts(index: WikiIndex, now = Date.now()): ExpiredFact[] {
  const out: ExpiredFact[] = [];
  for (const page of index.pages) {
    const expires = expiryOf(page);
    if (expires === null || expires > now) continue;
    out.push({
      id: page.id,
      relPath: page.relPath,
      title: page.title,
      expires,
      daysOver: Math.floor((now - expires) / 86_400_000),
    });
  }
  return out.sort((a, b) => b.daysOver - a.daysOver);
}

/** True when this page carries an expiry that has not yet passed. */
export function isFresh(page: WikiPage, now = Date.now()): boolean {
  const expires = expiryOf(page);
  return expires !== null && expires > now;
}

// ------------------------------------------------------------- supersession

export type Supersession = {
  /** The page that has been replaced. */
  oldId: string;
  /** The page that replaced it. */
  newId: string;
  newRelPath: string;
  newTitle: string;
};

function targetsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Normalise a `supersedes:` target to a page id.
 *
 * Authors write `old/page.md`, `old/page`, `[[old/page]]` and sometimes just
 * `page`. All four mean the same thing, and rejecting three of them would make
 * the field useless in practice.
 */
function resolveTarget(raw: string, index: WikiIndex): string | null {
  const cleaned = raw
    .trim()
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/\.mdx?$/i, "")
    .toLowerCase();
  if (!cleaned) return null;

  const byId = index.pages.find((p) => p.id.toLowerCase() === cleaned);
  if (byId) return byId.id;

  const base = cleaned.slice(cleaned.lastIndexOf("/") + 1);
  const matches = index.pages.filter(
    (p) => p.id.slice(p.id.lastIndexOf("/") + 1).toLowerCase() === base,
  );
  // Ambiguous short names are left unresolved rather than guessed — pointing a
  // reader at the wrong current page is worse than not redirecting them.
  return matches.length === 1 ? matches[0].id : null;
}

/** Map from a superseded page id to the page that replaced it. */
export function supersessions(index: WikiIndex): Map<string, Supersession> {
  const out = new Map<string, Supersession>();
  for (const page of index.pages) {
    for (const raw of targetsOf(page.frontmatter.supersedes ?? page.frontmatter.replaces)) {
      const oldId = resolveTarget(raw, index);
      if (!oldId || oldId === page.id) continue;
      // A page cannot be superseded twice; the newest claim wins, which is the
      // only rule that survives a chain of rewrites.
      const existing = out.get(oldId);
      const existingPage = existing && index.pages.find((p) => p.id === existing.newId);
      if (existingPage && existingPage.mtime > page.mtime) continue;
      out.set(oldId, {
        oldId,
        newId: page.id,
        newRelPath: page.relPath,
        newTitle: page.title,
      });
    }
  }
  return out;
}

/**
 * Follow a supersession chain to the page that is actually current.
 *
 * A → B → C is normal on a wiki that gets rewritten, and stopping at B would
 * send a reader to a page that has itself been replaced. Cycles are possible
 * when two pages claim to supersede each other, so the walk is bounded.
 */
export function currentVersion(
  id: string,
  map: Map<string, Supersession>,
): Supersession | null {
  let hop = map.get(id);
  if (!hop) return null;
  const seen = new Set([id]);
  while (hop && !seen.has(hop.newId)) {
    seen.add(hop.newId);
    const next = map.get(hop.newId);
    if (!next) break;
    hop = next;
  }
  return hop ?? null;
}
