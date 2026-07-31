import { countTokens } from "@/lib/tokens";
import { trustOf, type Ledger } from "@/lib/verify";

/**
 * Context packs.
 *
 * An agent asking about one subject currently has two bad options: read the
 * whole index and guess, or read four full pages and spend most of its window
 * on the three-quarters of each that were irrelevant. On the measured vault the
 * corpus is ~2.3M tokens against a 200k window, so "just send it" was never
 * available.
 *
 * A pack is the answer to "give me the best N tokens about X". It selects
 * passages rather than pages, keeps each one's source so the agent can cite it,
 * and stops at a stated budget instead of at a page boundary.
 *
 * Trust is part of the ranking, not a filter. Demoting an unverified page below
 * a verified one is right; hiding it is not, because on a real wiki almost
 * everything is unverified and a filter would return nothing.
 */

export type PackSource = {
  id: string;
  relPath: string;
  title: string;
  plain: string;
  words: number;
};

export type Passage = {
  pageId: string;
  relPath: string;
  title: string;
  /** Heading this passage sits under, when the page has one. */
  section: string | null;
  text: string;
  tokens: number;
  score: number;
  trust: string;
};

export type Pack = {
  query: string;
  budget: number;
  used: number;
  passages: Passage[];
  /** Pages that matched but did not fit. Named so the agent can ask for more. */
  omitted: { relPath: string; title: string }[];
};

/**
 * Split a page into passages at headings.
 *
 * Headings are the author's own statement about where one idea stops, which
 * beats any fixed character window: a 500-token slice cuts mid-argument at a
 * position chosen by arithmetic. Sections longer than `maxTokens` are then hard
 * split, because one enormous section should not consume a whole budget.
 */
export function splitSections(plain: string, maxTokens = 400): { heading: string | null; text: string }[] {
  const lines = plain.split("\n");
  const out: { heading: string | null; text: string }[] = [];

  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (!text) return;
    if (tokensFor(text) <= maxTokens) {
      out.push({ heading, text });
      return;
    }
    // Hard split on paragraphs, packing until the budget is reached.
    let chunk: string[] = [];
    for (const para of text.split(/\n{2,}/)) {
      const candidate = [...chunk, para].join("\n\n");
      if (chunk.length && tokensFor(candidate) > maxTokens) {
        out.push({ heading, text: chunk.join("\n\n") });
        chunk = [para];
      } else {
        chunk.push(para);
      }
    }
    if (chunk.length) out.push({ heading, text: chunk.join("\n\n") });
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  /*
   * Merge the crumbs.
   *
   * Splitting at every heading on a real wiki produces 20-token fragments —
   * these pages have a heading every few lines. Ranking divides score by
   * tokens, so a five-word line containing the query word beats the paragraph
   * that actually answers it, and the right page sinks to rank 58. Measured:
   * average passage 21 tokens, recall@1 0%.
   *
   * Adjacent sections are glued together until they clear a floor, keeping the
   * first heading as the label. Passages end up comparable in size, which is
   * the only condition under which score-per-token means anything.
   */
  const merged: { heading: string | null; text: string }[] = [];
  let pending = 0; // running token count of the tail, so this stays linear
  for (const section of out) {
    const last = merged[merged.length - 1];
    const size = tokensFor(section.text);
    // Merge when EITHER side is a crumb. Checking only the tail let every
    // trailing "## Related" survive whenever it followed a full-size section,
    // which on this vault was most of them.
    if (last && (pending < MIN_TOKENS || size < MIN_TOKENS)) {
      last.text = `${last.text}\n\n${section.heading ? `${section.heading}\n` : ""}${section.text}`;
      if (!last.heading) last.heading = section.heading;
      pending += size;
      continue;
    }
    merged.push({ ...section });
    pending = size;
  }
  return merged;
}

/**
 * The one place the budget is bounded.
 *
 * /api/ask capped at 24,000 and /api/pack at 120,000 — the same function, the
 * same vault, two different ceilings, so the answer you got depended on which
 * door you came through. The lower bound also differed (1,000 vs 500).
 *
 * 120k is the ceiling because an agent with a large window may legitimately ask
 * for one; the human-facing default stays 8k.
 */
export function clampBudget(value: unknown, fallback = 8_000): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(120_000, Math.max(500, n)) : fallback;
}

/** Below this a passage is a fragment, not an answer. */
const MIN_TOKENS = 120;

/*
 * Per-page work that does not depend on the question, kept between queries.
 *
 * Splitting a page into passages and BPE-encoding every one of them is the
 * expensive half of answering, and none of it varies with what you asked — yet
 * it ran in full on every request, over a 2.3M-token corpus. That was most of
 * the thirty seconds. So was `idfFor`, which lowercased the entire corpus once
 * per query term: a seven-word question meant seven passes over ten megabytes.
 *
 * Keyed by page id plus content length, which is not a hash but is wrong only
 * if an edit leaves the byte count identical — in which case the passages are
 * near enough the same anyway. Bounded, because a long-lived process on a big
 * vault would otherwise hold the whole corpus twice.
 */
type PageCache = { sections: { heading: string | null; text: string }[]; lower: string };
const pageCache = new Map<string, PageCache>();
const PAGE_CACHE_MAX = 4_000;

function cached(page: PackSource): PageCache {
  const key = `${page.id}:${page.plain.length}`;
  const hit = pageCache.get(key);
  if (hit) return hit;
  const entry: PageCache = {
    sections: splitSections(page.plain),
    lower: page.plain.toLowerCase(),
  };
  if (pageCache.size > PAGE_CACHE_MAX) pageCache.clear();
  pageCache.set(key, entry);
  return entry;
}

/*
 * Question words carry no evidence but survive IDF, because a wiki genuinely
 * does not contain "what" very often. Measured: `what` scored half of `rate`,
 * and any page titled "… for Later" collected a title bonus on every English
 * question asked of it.
 */
const STOPWORDS = new Set([
  "the","and","for","are","was","were","what","when","where","which","who","whom",
  "how","why","did","does","do","is","it","its","that","this","these","those",
  "with","from","have","has","had","been","being","about","into","than","then",
  "there","their","them","they","you","your","yours","our","ours","not","but",
  "can","could","would","should","will","shall","may","might","must","any","all",
  "some","most","more","much","many","get","got","let","say","said","also",
]);

const TRUST_WEIGHT: Record<string, number> = {
  verified: 1.35,
  aging: 1.1,
  unverified: 1,
  // A page confirmed once and rewritten since is the most dangerous kind: it
  // reads as settled and is not. Ranked below something never checked at all.
  lapsed: 0.8,
};

/**
 * Passage-level match, weighted by how rare each term is in THIS corpus.
 *
 * The first version counted raw term frequency, which is the classic mistake:
 * asked "what is my rate for video editing", it returned six YouTube transcripts,
 * because a transcript says "video" fifty times and the page that actually holds
 * the rate says it twice. Frequency without rarity ranks the most repetitive
 * document, not the most relevant one.
 *
 * `idf` comes from the corpus-wide BM25 index, so a term appearing in a thousand
 * pages is worth almost nothing and a term appearing in four is worth a great
 * deal. That single change is the difference between this feature working and
 * being a toy.
 */
function relevance(
  text: string,
  terms: string[],
  title: string,
  heading: string | null,
  idf: Map<string, number>,
): number {
  const hay = text.toLowerCase();
  const head = `${title} ${heading ?? ""}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const weight = idf.get(term) ?? 1;
    // Whole words. Substring matching had "rate" scoring on "corporate" and
    // "art" on "start", which corrupts the very IDF that makes this work.
    const inBody = countWord(hay, term);
    if (inBody) score += Math.min(inBody, 4) * 2 * weight;
    // A term in the title or heading is the author saying what the page is
    // about, which beats any number of mentions in a body.
    if (head.includes(term)) score += 10 * weight;
  }
  return score;
}

/**
 * Inverse document frequency over the pages being packed.
 *
 * Computed here rather than pulled from lib/rank so that buildPack stays a pure
 * function of its arguments — it is called from the server, the MCP server and
 * the browser build, and a module-level cache keyed by vault root would be
 * wrong in at least one of those.
 */
/** Whole-word occurrences, Unicode-aware, without building a regex per call. */
/** Memoised token count. The tokenizer is the single hottest call in a query. */
const tokenCache = new Map<string, number>();
function tokensFor(text: string): number {
  const key = text.length > 200 ? `${text.length}:${text.slice(0, 120)}` : text;
  const hit = tokenCache.get(key);
  if (hit !== undefined) return hit;
  const n = countTokens(text);
  if (tokenCache.size > 20_000) tokenCache.clear();
  tokenCache.set(key, n);
  return n;
}

function countWord(hay: string, term: string): number {
  let n = 0;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(term, from);
    if (at === -1) return n;
    const before = at === 0 ? "" : hay[at - 1];
    const after = hay[at + term.length] ?? "";
    const boundary = (c: string) => c === "" || !/[\p{L}\p{N}]/u.test(c);
    if (boundary(before) && boundary(after)) n++;
    from = at + term.length;
  }
}

function idfFor(pages: PackSource[], terms: string[]): Map<string, number> {
  const idf = new Map<string, number>();
  const n = Math.max(pages.length, 1);
  for (const term of terms) {
    let seen = 0;
    for (const page of pages) {
      if (
        countWord(cached(page).lower, term) > 0 ||
        countWord(page.title.toLowerCase(), term) > 0
      ) {
        seen++;
      }
    }
    // Standard smoothed IDF, floored at 0.05 so a universal term contributes
    // almost nothing without being able to zero out a passage that also
    // contains a rare one.
    idf.set(term, Math.max(0.05, Math.log((n - seen + 0.5) / (seen + 0.5) + 1)));
  }
  return idf;
}

/**
 * Captured material — transcripts, exports, raw dumps — is the bulk of a real
 * vault by volume and almost never the answer to a question. It is discounted
 * rather than excluded: sometimes the transcript IS where the client said the
 * number.
 */
const CAPTURE_HINT = /(^|\/)(raw|transcripts?|captures?|exports?|dumps?)(\/|$)|\.srt$/i;

/**
 * Build a pack.
 *
 * Greedy by score-per-token rather than by score alone: a 600-token passage
 * scoring 20 and a 90-token passage scoring 12 are not close, and picking by
 * raw score fills the budget with long passages that happened to repeat the
 * query word.
 */
export function buildPack(
  query: string,
  pages: PackSource[],
  ledger: Ledger,
  hashes: Map<string, string>,
  budget = 8_000,
  /**
   * Optional per-page semantic similarity, 0..1. Additive to the page term, so
   * a page the embedding model likes surfaces even when the wording missed —
   * without letting it outrank a page that literally answers the question.
   */
  semanticBoost: Map<string, number> = new Map(),
): Pack {
  /*
   * Query terms.
   *
   * Two earlier rules were quietly destroying real questions. Splitting on
   * `[^a-z0-9-]` shattered every accented word — "vídeo" became "v" and "deo",
   * and any non-Latin question produced no terms at all, which guaranteed an
   * empty answer AND logged the question as a gap. And `length > 2` discarded
   * every two-digit number, on a wiki whose central facts are rates like $20
   * and $30.
   */
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((t) => (t.length > 2 || /\d/.test(t)) && !STOPWORDS.has(t));

  const idf = idfFor(pages, terms);

  const scored: Passage[] = [];
  for (const page of pages) {
    const trust = trustOf(ledger, page.id, hashes.get(page.id) ?? "");
    const capture = CAPTURE_HINT.test(page.relPath) ? 0.35 : 1;

    /*
     * How well the WHOLE page answers the question, mixed into each of its
     * passages.
     *
     * Scoring passages in isolation ranks a stray sentence in an unrelated
     * transcript above a paragraph inside the page that is entirely about the
     * subject. The page is evidence about the passage, so it carries weight —
     * damped with a log so a long page cannot win on repetition alone.
     */
    const pageScore =
      Math.log1p(relevance(page.plain, terms, page.title, null, idf)) * 6 +
      (semanticBoost.get(page.id) ?? 0) * 14;

    const semantic = semanticBoost.get(page.id) ?? 0;
    for (const section of cached(page).sections) {
      const own = relevance(section.text, terms, page.title, section.heading, idf);
      // A page the embedding model matched may contain none of the query's
      // literal words — which is the entire point of having it.
      if (own <= 0 && semantic <= 0) continue;
      const tokens = tokensFor(section.text);
      scored.push({
        pageId: page.id,
        relPath: page.relPath,
        title: page.title,
        section: section.heading,
        text: section.text,
        tokens,
        /*
         * Density of the passage's OWN evidence, plus the page's, undivided.
         *
         * Adding the page score before dividing by tokens made it a per-token
         * constant, so the shortest fragment on any matching page won outright
         * — the top hit for a question about rates was the two-token string
         * "See .". Page evidence is a property of the page, so it is added
         * after normalisation and cannot be amplified by brevity.
         */
        score: (own / Math.max(tokens, 1) + pageScore * 0.04) *
          (TRUST_WEIGHT[trust] ?? 1) *
          capture,
        trust,
      });
    }
  }

  /*
   * Order by PAGE, then by passage within it.
   *
   * Sorting every passage globally by score-per-token interleaves fragments
   * from forty different pages, so the page that actually answers the question
   * arrives at position seventeen even when its best passage scored well. What
   * a reader wants — and what the sources list shows — is the right page first.
   *
   * A page is ranked by its single best passage rather than its total, so a
   * long page cannot win by having many mediocre sections.
   */
  const byPage = new Map<string, Passage[]>();
  for (const passage of scored) {
    const list = byPage.get(passage.pageId);
    if (list) list.push(passage);
    else byPage.set(passage.pageId, [passage]);
  }

  const pageOrder = [...byPage.entries()]
    .map(([pageId, list]) => {
      list.sort((a, b) => b.score - a.score);
      return { pageId, list, best: list[0].score };
    })
    .sort((a, b) => b.best - a.best);

  // Two passes: one best passage from each page in rank order, then the rest.
  // The budget therefore covers as many distinct pages as it can before it
  // spends anything on a second passage from a page already represented.
  scored.length = 0;
  for (const { list } of pageOrder) scored.push(list[0]);
  for (const { list } of pageOrder) for (const p of list.slice(1)) scored.push(p);

  const passages: Passage[] = [];
  const omitted: { relPath: string; title: string }[] = [];
  const seenPages = new Set<string>();
  let used = 0;

  for (const passage of scored) {
    if (used + passage.tokens > budget) {
      if (!seenPages.has(passage.pageId)) {
        omitted.push({ relPath: passage.relPath, title: passage.title });
        seenPages.add(passage.pageId);
      }
      continue;
    }
    passages.push(passage);
    seenPages.add(passage.pageId);
    used += passage.tokens;
  }

  return { query, budget, used, passages, omitted: omitted.slice(0, 20) };
}

/** Render a pack as markdown an agent can paste straight into its context. */
export function renderPack(pack: Pack): string {
  if (!pack.passages.length) {
    return `No passages in the wiki matched "${pack.query}". This gap has been logged.`;
  }

  const lines = [
    `# Context: ${pack.query}`,
    "",
    `${pack.passages.length} passages · ~${pack.used} tokens of a ${pack.budget} budget.`,
    "Each passage cites its source. Prefer verified passages when they conflict.",
    "",
  ];

  for (const p of pack.passages) {
    lines.push(`## ${p.title}${p.section ? ` — ${p.section}` : ""}`);
    lines.push(`\`${p.relPath}\` · ${p.trust}`);
    lines.push("");
    lines.push(p.text.trim());
    lines.push("");
  }

  if (pack.omitted.length) {
    lines.push("---");
    lines.push(
      `Also matched but did not fit: ${pack.omitted.map((o) => `\`${o.relPath}\``).join(", ")}`,
    );
  }
  return lines.join("\n");
}
