/**
 * Term ranking and link authority.
 *
 * The original search matched the query as one literal phrase. That is right
 * for "the thing you meant is usually the exact title" and wrong for everything
 * else: "postgres backup" scored zero against a page that says "backup of the
 * postgres cluster", because the two words never appear adjacent.
 *
 * BM25 fixes that without giving up the property that made literal search feel
 * sharp — rare words still dominate, so a query containing one distinctive term
 * still lands on the page that owns it.
 *
 * Authority is layered on top, from the link graph the wiki already has. Two
 * pages mentioning "deploy" are not equally likely to be the one you want; the
 * one eleven other pages link to is. It is applied as a modest multiplier, never
 * as a sort key, because a hub page must not outrank an exact title match.
 */

export type RankPage = {
  id: string;
  title: string;
  plain: string;
  tags: string[];
};

type Inverted = {
  /** term -> pageId -> count within that page */
  postings: Map<string, Map<string, number>>;
  length: Map<string, number>;
  avgLength: number;
  total: number;
};

const WORD = /[a-z0-9][a-z0-9'-]*/g;

export function terms(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

function buildInverted(pages: RankPage[]): Inverted {
  const postings = new Map<string, Map<string, number>>();
  const length = new Map<string, number>();
  let total = 0;

  for (const page of pages) {
    // Title and tags are folded in three times. A word in the title is a much
    // stronger claim about what a page is about than the same word buried in
    // paragraph nine, and BM25 has no other way to know that.
    const words = terms(`${page.title} ${page.title} ${page.title} ${page.tags.join(" ")} ${page.plain}`);
    length.set(page.id, words.length);
    total += words.length;

    const seen = new Map<string, number>();
    for (const word of words) seen.set(word, (seen.get(word) ?? 0) + 1);
    for (const [word, count] of seen) {
      let row = postings.get(word);
      if (!row) postings.set(word, (row = new Map()));
      row.set(page.id, count);
    }
  }

  return {
    postings,
    length,
    avgLength: pages.length ? total / pages.length : 1,
    total: pages.length,
  };
}

/**
 * Cached per vault, invalidated by a cheap signature rather than a timer.
 *
 * Building this over 1,400 pages is fast but not free, and search runs on every
 * keystroke. The signature is page count plus the newest mtime, which changes on
 * any edit that matters and costs nothing to compute.
 */
const cache = new Map<string, { signature: string; inverted: Inverted }>();

export function invertedFor(root: string, pages: RankPage[], signature: string): Inverted {
  const hit = cache.get(root);
  if (hit && hit.signature === signature) return hit.inverted;
  const inverted = buildInverted(pages);
  cache.set(root, { signature, inverted });
  return inverted;
}

const K1 = 1.4;
const B = 0.72;

/** Okapi BM25. Returns pageId -> score, unranked pages absent. */
export function bm25(query: string, inverted: Inverted): Map<string, number> {
  const scores = new Map<string, number>();
  const queryTerms = [...new Set(terms(query))];

  for (const term of queryTerms) {
    const row = inverted.postings.get(term);
    if (!row) continue;

    // Rare terms carry more information. This is what keeps a distinctive word
    // in the query from being drowned by a common one.
    const idf = Math.log(1 + (inverted.total - row.size + 0.5) / (row.size + 0.5));

    for (const [pageId, count] of row) {
      const len = inverted.length.get(pageId) ?? inverted.avgLength;
      const norm = count * (K1 + 1);
      const denom = count + K1 * (1 - B + (B * len) / inverted.avgLength);
      scores.set(pageId, (scores.get(pageId) ?? 0) + idf * (norm / denom));
    }
  }
  return scores;
}

/**
 * PageRank over the wiki's own links.
 *
 * Twenty iterations is well past convergence for a graph this size and small
 * enough to run inline. The damping factor is the standard 0.85; nothing here
 * justifies tuning it.
 */
export function authority(
  pageIds: string[],
  backlinks: Record<string, string[]>,
  iterations = 20,
): Map<string, number> {
  const n = pageIds.length || 1;
  const rank = new Map(pageIds.map((id) => [id, 1 / n]));

  // Outbound degree, derived from backlinks so there is one source of truth.
  const outDegree = new Map<string, number>();
  for (const targets of Object.values(backlinks)) {
    for (const from of targets) outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
  }

  for (let i = 0; i < iterations; i++) {
    const next = new Map(pageIds.map((id) => [id, 0.15 / n]));
    for (const [target, sources] of Object.entries(backlinks)) {
      if (!next.has(target)) continue;
      let inflow = 0;
      for (const from of sources) {
        inflow += (rank.get(from) ?? 0) / Math.max(outDegree.get(from) ?? 1, 1);
      }
      next.set(target, (next.get(target) ?? 0) + 0.85 * inflow);
    }
    for (const [id, value] of next) rank.set(id, value);
  }

  // Normalised to 0..1 so the caller can apply it as a bounded multiplier and
  // not have ranking behaviour change with the size of the vault.
  const max = Math.max(...rank.values(), Number.EPSILON);
  for (const [id, value] of rank) rank.set(id, value / max);
  return rank;
}
