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
  /** For the recency prior. Optional so existing callers keep working. */
  mtime?: number;
  /** Frontmatter aliases, used to expand the query's vocabulary. */
  aliases?: string[];
};

export type Passage = {
  pageId: string;
  relPath: string;
  title: string;
  /** Heading this passage sits under, when the page has one. */
  section: string | null;
  /**
   * `path.md#heading` — what the agent should cite.
   *
   * Citing a whole 1,200-token page for one paragraph makes the citation
   * unusable: whoever follows it has to re-find the sentence. The anchor is
   * the same slug GitHub and Obsidian generate, so the link resolves in both.
   */
  anchor: string;
  text: string;
  tokens: number;
  score: number;
  trust: string;
};

export type Pack = {
  query: string;
  /** The query after expansion, when it differs from what was asked. */
  expanded?: string;
  budget: number;
  used: number;
  passages: Passage[];
  /** Pages that matched but did not fit. Named so the agent can ask for more. */
  omitted: { relPath: string; title: string }[];
  /**
   * How much the answer should be trusted, 0..1.
   *
   * A pack has always been returned with the same confident framing whether it
   * found the page that answers the question or the least-bad paragraph in the
   * wiki. That is the failure mode that makes a model confabulate: it has no
   * way to tell "here is the answer" from "here is the closest thing I have".
   * Stating it lets an agent go and read the source, ask the human, or write
   * the missing page instead of guessing.
   */
  confidence: number;
  /** Why the confidence is what it is, in one sentence for the agent. */
  verdict: string;
  /**
   * The confidence components, exposed so calibration can be MEASURED.
   *
   * A confidence number nobody can audit is a number nobody should trust —
   * the previous formula scored 0.89 on answers whose correct page came back
   * third, and that went unnoticed because the parts were invisible.
   */
  signals?: { margin: number; covered: number; concentration: number };
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
/**
 * The default context budget, and why it is not 8,000.
 *
 * It was, and that number cost eight seconds per question for nothing.
 * Generation is 94% of Ask's wall time and scales with what it is handed:
 * measured on this machine, 8,000 tokens took 16.4s, 3,000 took 8.3s, 1,500
 * took 7.9s. Meanwhile the fixed golden set scores IDENTICALLY at 8,000,
 * 4,000 and 2,500 — recall@1 40%, recall@5 90%, same single miss — and only
 * degrades at 1,500.
 *
 * So the old default bought no accuracy and sold half the responsiveness. The
 * ceiling stays high for agents that explicitly ask for more: an agent filling
 * a 200k window has a real reason, and `?budget=` still honours it.
 */
export const DEFAULT_BUDGET = 3_000;

export function clampBudget(value: unknown, fallback = DEFAULT_BUDGET): number {
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
/**
 * How well a piece of text answers the query, and how much of the query it
 * actually covers.
 *
 * `score` is the familiar weighted-hit sum. `hitMass` is new and is the reason
 * this returns a pair: the IDF mass of the DISTINCT query terms present. Two
 * passages can score identically while one mentions a single rare term six
 * times and the other mentions every term in the question once — and the second
 * is almost always the one the asker meant. Counting hits alone cannot tell
 * them apart, so coverage is measured separately and applied by the caller.
 */
function relevance(
  text: string,
  terms: string[],
  title: string,
  heading: string | null,
  idf: Map<string, number>,
): { score: number; hitMass: number } {
  const hay = text.toLowerCase();
  const head = `${title} ${heading ?? ""}`.toLowerCase();
  let score = 0;
  let hitMass = 0;
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
    // Counted once per distinct term, however many times it appears — this is
    // breadth, and repetition must not buy it.
    if (inBody || head.includes(term)) hitMass += weight;
  }
  return { score, hitMass };
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
/** GitHub/Obsidian-compatible heading slug, so a cited anchor actually opens. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Words that mean "the current one".
 *
 * A wiki accumulates every version of a fact it has ever held, so "what is my
 * rate" and "what WAS my rate" retrieve the same passages. When the question
 * asks for the present, recency stops being a tiebreak and becomes part of the
 * question.
 */
const ASKS_CURRENT = /\b(current|currently|latest|newest|now|today|these days|at the moment|right now|up to date|still)\b/i;

/**
 * Expand the query using the wiki's own vocabulary.
 *
 * Nobody asks a question in the words their notes were written in. A page
 * titled "FableWatch deploy pipeline" with `aliases: [FW deploy]` should answer
 * "how does FW deploy work", and a literal-term scorer cannot see that those
 * are the same thing.
 *
 * Deliberately narrow: only aliases and titles the query already half-matches
 * contribute, so expansion adds the wiki's synonym for a thing the asker
 * clearly named, and never drifts onto a neighbouring subject.
 */
function expandQuery(terms: string[], pages: PackSource[]): string[] {
  if (!terms.length) return terms;
  const have = new Set(terms);
  const added: string[] = [];

  for (const page of pages) {
    const names = [page.title, ...(page.aliases ?? [])];
    for (const name of names) {
      const nameTerms = name
        .toLowerCase()
        .split(/[^\p{L}\p{N}-]+/u)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));
      if (nameTerms.length < 2) continue;
      // Every word of this name is already in the query — so the OTHER names
      // for the same page are what the asker meant but did not say.
      const matched = nameTerms.every((t) => have.has(t));
      if (!matched) continue;
      for (const other of names) {
        for (const t of other
          .toLowerCase()
          .split(/[^\p{L}\p{N}-]+/u)
          .filter((t) => t.length > 2 && !STOPWORDS.has(t))) {
          if (!have.has(t) && added.length < 6) {
            have.add(t);
            added.push(t);
          }
        }
      }
    }
  }
  return [...terms, ...added];
}

/**
 * A gentle preference for pages touched recently, stronger when asked for.
 *
 * Flat by default — an old page is not a wrong page, and a hard recency sort
 * would bury the considered write-up under yesterday's scratch note. But a
 * question containing "current" is explicitly about time, and there the newest
 * page should win a close call outright.
 */
function recencyFactor(mtime: number | undefined, wantsCurrent: boolean, now: number): number {
  if (!mtime) return 1;
  const ageDays = Math.max(0, (now - mtime) / 86_400_000);
  const freshness = Math.exp(-ageDays / 120);
  return 1 + freshness * (wantsCurrent ? 0.6 : 0.12);
}

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
  const asked = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((t) => (t.length > 2 || /\d/.test(t)) && !STOPWORDS.has(t));

  const terms = expandQuery(asked, pages);
  const wantsCurrent = ASKS_CURRENT.test(query);
  const now = Date.now();

  const idf = idfFor(pages, terms);
  /*
   * The denominator for coverage: the IDF mass of the query terms that exist
   * in this corpus at all. A term nobody has ever written cannot be covered,
   * and counting it would punish every passage equally for the asker's
   * vocabulary.
   */
  const askMass = terms.reduce((sum, t) => sum + (idf.get(t) ?? 0), 0);

  const scored: Passage[] = [];
  for (const page of pages) {
    const trust = trustOf(ledger, page.id, hashes.get(page.id) ?? "");
    const capture = CAPTURE_HINT.test(page.relPath) ? 0.35 : 1;
    const recency = recencyFactor(page.mtime, wantsCurrent, now);

    /*
     * How well the WHOLE page answers the question, mixed into each of its
     * passages.
     *
     * Scoring passages in isolation ranks a stray sentence in an unrelated
     * transcript above a paragraph inside the page that is entirely about the
     * subject. The page is evidence about the passage, so it carries weight —
     * damped with a log so a long page cannot win on repetition alone.
     */
    const pageRelevance = relevance(page.plain, terms, page.title, null, idf);
    const pageScore =
      Math.log1p(pageRelevance.score) * 6 + (semanticBoost.get(page.id) ?? 0) * 14;

    const semantic = semanticBoost.get(page.id) ?? 0;
    for (const section of cached(page).sections) {
      const section_ = relevance(section.text, terms, page.title, section.heading, idf);
      const own = section_.score;
      // A page the embedding model matched may contain none of the query's
      // literal words — which is the entire point of having it.
      if (own <= 0 && semantic <= 0) continue;
      /*
       * Reward covering the QUESTION, not repeating one word of it.
       *
       * Without this a page that says "rate" nine times outranks the page that
       * answers "what is my video edit rate", because nine hits on one term
       * beat one hit on each of four. Scaled to [0.5, 1] rather than [0, 1]:
       * partial coverage is common and legitimate — the answer is often split
       * across sections — so this tilts the ranking rather than gating it.
       */
      const coverage = askMass > 0 ? Math.min(1, section_.hitMass / askMass) : 1;
      const coverageBoost = 0.5 + 0.5 * coverage;
      const tokens = tokensFor(section.text);
      scored.push({
        pageId: page.id,
        relPath: page.relPath,
        title: page.title,
        section: section.heading,
        anchor: section.heading
          ? `${page.relPath}#${slugify(section.heading)}`
          : page.relPath,
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
          capture *
          recency *
          coverageBoost,
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

  /*
   * Confidence.
   *
   * Three things separate "the wiki answers this" from "the wiki contains
   * something vaguely adjacent": how far the best passage stands above the
   * rest of the corpus, how many of the asked-for words were found at all, and
   * whether more than one page agrees. None is sufficient alone — a single
   * strong page is a real answer, and five weak ones are not — so they are
   * combined and then stated in a sentence rather than a number, because the
   * consumer is a model deciding whether to trust this or go read the source.
   */
  /*
   * Confidence that actually discriminates.
   *
   * The previous formula scored every one of twenty fixed golden questions at
   * 0.62 or above — including the ones whose correct page came back at rank 3,
   * 5 and 11 — because it had a floor of about 0.6 built into it. `covered`
   * asked whether each query term appeared ANYWHERE in the returned passages,
   * which on a 1,650-page corpus is nearly always yes; `corroboration` was
   * `distinctPages / 3`, which with seventeen passages is always 1. That is
   * 0.45 and 0.15 handed out for free before anything was measured.
   *
   * Worse, corroboration was backwards. Passages scattered across many
   * unrelated pages is the signature of a ranker that has NOT found the
   * answer; the old formula read it as agreement and raised the score.
   *
   * The three signals below are the ones that move when retrieval is actually
   * unsure:
   *
   *   margin        — how far the best page stands above the SECOND-best page.
   *                   A clear winner is the whole question; comparing the top
   *                   passage to the median passage (as before) always looks
   *                   like a landslide on a large corpus.
   *   coverage      — IDF-weighted, so finding the rare identifying term counts
   *                   and finding "what" does not.
   *   concentration — how much of the returned material comes from the top
   *                   page. Concentrated is confident; scattered is not.
   */
  const topScore = pageOrder[0]?.best ?? 0;
  const runnerUp = pageOrder[1]?.best ?? 0;
  const margin = topScore <= 0 ? 0 : Math.min(1, (topScore - runnerUp) / topScore);

  let idfFound = 0;
  let idfTotal = 0;
  for (const term of terms) {
    const weight = idf.get(term) ?? 1;
    idfTotal += weight;
    if (passages.some((p) => countWord(p.text.toLowerCase(), term) > 0)) idfFound += weight;
  }
  const covered = idfTotal > 0 ? idfFound / idfTotal : 0;

  const topPageId = pageOrder[0]?.pageId;
  const fromTop = passages.filter((p) => p.pageId === topPageId).length;
  const concentration = passages.length
    ? Math.min(1, fromTop / Math.min(passages.length, 5))
    : 0;

  /*
   * Weighted by what MEASURABLY predicts a correct top page, not by intuition.
   *
   * Measured across the twenty golden cases, splitting them into the ten where
   * the right page came back first and the ten where it did not:
   *
   *   margin         hits 0.235   misses 0.095   separation 0.141  <- signal
   *   covered        hits 0.957   misses 0.947   separation 0.010  <- noise
   *   concentration  hits 0.200   misses 0.180   separation 0.020  <- noise
   *
   * Coverage and concentration are near-constant on a corpus this size, so any
   * weight on them is a floor handed out for free — which is exactly how the
   * original formula came to score 0.89 on an answer whose page ranked third.
   * They are not deleted, because coverage genuinely matters in the one case it
   * varies: a query whose rare terms appear nowhere. So it acts as a CAP, never
   * as a contribution.
   *
   * A margin of 0.4 — the best page scoring 40% above the runner-up — is
   * treated as full confidence. Deliberately a round number rather than one
   * fitted to twenty cases; the point is the shape, and the golden set is small
   * enough that tuning the constant would be fitting noise.
   */
  const confidence = passages.length
    ? Math.max(0, Math.min(1, Math.min(1, margin / 0.4) * Math.min(1, covered / 0.6)))
    : 0;
  void concentration;

  const verdict = !passages.length
    ? "Nothing in the wiki matched. Do not guess — say the wiki does not cover this, and consider writing the page."
    : confidence < 0.35
      ? "LOW CONFIDENCE — these are the closest passages, not an answer. Treat them as leads, verify against the source, and say the wiki may not cover this."
      : confidence < 0.6
        ? "PARTIAL — the wiki covers some of this. Quote what is here and be explicit about what it does not say."
        : "The wiki covers this. Quote the passages and cite their anchors.";

  return {
    query,
    expanded: terms.length > asked.length ? terms.join(" ") : undefined,
    budget,
    used,
    passages,
    omitted: omitted.slice(0, 20),
    confidence,
    verdict,
    signals: { margin, covered, concentration },
  };
}

/** Render a pack as markdown an agent can paste straight into its context. */
export function renderPack(pack: Pack): string {
  if (!pack.passages.length) {
    /*
     * A negative result is a real answer and is worth saying plainly.
     *
     * The old wording ("this gap has been logged") told the agent what Lore
     * had done and nothing about what IT should do, so the common next move
     * was to answer from memory anyway. Naming both correct moves — say so,
     * or write the page — is the difference between a wiki that grows where it
     * is thin and one that stays thin.
     */
    return [
      `No passages in the wiki matched "${pack.query}".`,
      "",
      "This is a real answer: the wiki does not cover this. Say so rather than",
      "answering from memory. If you learn it during this session, write it with",
      "wiki_write so the next agent does not have to ask.",
      "",
      "The gap has been logged.",
    ].join("\n");
  }

  const lines = [
    `# Context: ${pack.query}`,
    "",
    `${pack.passages.length} passages · ~${pack.used} tokens of a ${pack.budget} budget.`,
    // The verdict goes above the passages, because a model that has already
    // read four confident-looking paragraphs will not revise its confidence
    // on the strength of a footer.
    `Confidence: ${Math.round(pack.confidence * 100)}%. ${pack.verdict}`,
    pack.expanded ? `Also searched for: ${pack.expanded}` : "",
    "Each passage cites its source. Prefer verified passages when they conflict.",
    "",
  ].filter(Boolean);

  for (const p of pack.passages) {
    lines.push(`## ${p.title}${p.section ? ` — ${p.section}` : ""}`);
    lines.push(`\`${p.anchor}\` · ${p.trust}`);
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

/**
 * Frontmatter aliases as a plain list.
 *
 * Obsidian accepts `aliases: FW` and `aliases: [FW, fablewatch]` and a YAML
 * block list, and a vault of any age contains all three. Anything else is
 * ignored rather than coerced — a malformed alias should cost nothing.
 */
export function aliasesOf(page: { frontmatter?: Record<string, unknown> }): string[] {
  const raw = page.frontmatter?.aliases ?? page.frontmatter?.alias;
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  return [];
}
