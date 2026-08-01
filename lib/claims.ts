/**
 * Claim extraction — the unit a contradiction is actually made of.
 *
 * The detector this replaces matched `subject is NUMBER unit` and grouped by
 * the literal subject string. On the real wiki it scored 0 out of 9 known
 * disagreements, and one of the groups it *did* form was keyed on the word
 * "those". Two failures, both structural:
 *
 *   1. Exact string equality never matches. One page says "the video floor is
 *      $100", another says "video edits floor: $150". Same fact, different
 *      words, no group.
 *   2. A regex anchored on "is" treats the sentence's grammar as the signal,
 *      so pronouns and sentence fragments become subjects.
 *
 * So: pull a typed value out of the sentence first, then work backwards for
 * the words that qualify it, then compare subjects by weighted term overlap
 * rather than equality.
 *
 * Everything else in this file is precision. The first working version found
 * forty "contradictions" on the real wiki and every one was wrong: a rate card
 * read as thirty-one disagreeing prices, file sizes in MB read as version
 * numbers, and every client profile matching every other because they share a
 * template's headings. A false contradiction costs more attention than a
 * missed one, so the rules below are deliberately strict enough to return
 * nothing rather than return noise.
 */

export type ClaimKind =
  | "money"
  | "percent"
  | "duration"
  | "version"
  | "port"
  | "count";

export type Claim = {
  pageId: string;
  relPath: string;
  title: string;
  /** The qualifying words, normalised — what the number is *about*. */
  subject: string;
  /** Content terms from the claim's own clause. This is what must match. */
  terms: string[];
  /** The page's folder — the unit "same subject" is judged on. See scopeOf. */
  scope: string;
  /**
   * Terms from the heading and page title. Held apart from `terms` on purpose:
   * folding them in made every page generated from the same template match
   * every other one, because they share every heading.
   */
  context: string[];
  kind: ClaimKind;
  /** Canonical numeric value, so "1,200" and "1200" compare equal. */
  value: number;
  /** Normalised unit within the kind: "usd", "s", "d", "%"… */
  unit: string;
  /** The sentence it came from, for display. */
  text: string;
  line: number;
  at: number;
  /**
   * True when the sentence frames the value as historical or approximate —
   * "was 30s", "up to 5", "~200". These never *raise* a conflict, because
   * "the rate was $100 and is now $150" is a wiki working correctly.
   */
  soft: boolean;
};

const STOP = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "at", "by", "with", "and",
  "or", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "these", "those", "there", "here", "we", "i", "you", "he", "she", "they",
  "them", "our", "my", "your", "their", "as", "from", "into", "about", "per",
  "each", "every", "all", "any", "some", "no", "not", "so", "if", "then",
  "than", "when", "which", "what", "who", "how", "now", "just", "only", "also",
  "set", "use", "used", "using", "has", "have", "had", "will", "would", "can",
  "should", "must", "may", "might", "do", "does", "did", "get", "gets", "got",
  "run", "runs", "running", "one", "two", "three", "new", "old", "more", "most",
  "less", "least", "up", "down", "out", "over", "under", "after", "before",
  "total", "each", "via", "plus", "both", "same", "other", "another", "still",
]);

/** Words that make a number historical or fuzzy rather than a live claim. */
const SOFTENER =
  /\b(was|were|used to|previously|formerly|until|up to|at least|at most|around|roughly|approximately|nearly|almost|legacy|deprecated|earlier|ago|last seen|e\.g\.|example|option|either|range|between)\b|~/i;

/**
 * Units that mean the number is bookkeeping, not a claim about the world.
 *
 * These came straight out of the first bad run: `messages: 31` and
 * `updated: 2026-08-01` in a generated profile header were being compared
 * across every client the wiki has.
 */
const META_UNIT = new Set([
  "updated", "created", "modified", "current", "chat", "chats", "profile",
  "index", "id", "ids", "uuid", "hash", "rev", "revision", "commit", "line",
  "lines", "words", "chars", "characters", "bytes", "kb", "mb", "gb", "tb",
  "px", "em", "rem", "items", "item", "entries", "entry", "rows", "row",
  "messages", "message", "results", "result", "am", "pm", "utc", "gmt",
  "am/pm", "th", "st", "nd", "rd", "am,", "ago", "today", "tomorrow",
]);

const DURATION_UNIT: Record<string, string> = {
  ms: "ms", millisecond: "ms", milliseconds: "ms",
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
  m: "min", min: "min", mins: "min", minute: "min", minutes: "min",
  h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
  d: "d", day: "d", days: "d",
  w: "w", week: "w", weeks: "w",
  mo: "mo", month: "mo", months: "mo",
  y: "y", yr: "y", year: "y", years: "y",
};

type Pattern = {
  kind: ClaimKind;
  re: RegExp;
  read: (m: RegExpMatchArray, line: string) => { value: number; unit: string } | null;
};

const num = (raw: string) => Number(raw.replace(/,/g, ""));

/*
 * Value patterns, most specific first.
 *
 * Order matters: `$150/mo` must be read as money before the bare-count rule
 * sees `150`, and `:4646` must be a port before it is a count.
 */
const PATTERNS: Pattern[] = [
  {
    kind: "money",
    // The trailing /mo or /video is part of the unit: $150/mo and $150/video
    // are different claims and grouping them is how a rate card becomes a
    // contradiction.
    re: /(?:\$|\bUSD\s*|\bBRL\s*|R\$)\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/\s*([a-z]{1,10}))?/gi,
    read: (m) => ({ value: num(m[1]), unit: m[2] ? `usd/${m[2].toLowerCase()}` : "usd" }),
  },
  {
    kind: "percent",
    re: /(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b)/gi,
    read: (m) => ({ value: num(m[1]), unit: "%" }),
  },
  {
    kind: "port",
    // Ports are the most-contradicted fact in a developer's wiki and read as
    // meaningless counts without their own rule.
    re: /(?:\bport\s+|localhost:|127\.0\.0\.1:|:)(\d{4,5})\b/gi,
    read: (m) => ({ value: num(m[1]), unit: "port" }),
  },
  {
    kind: "version",
    // A `v` prefix, or a named piece of software immediately before it. Bare
    // dotted decimals are file sizes, money and percentages far more often
    // than they are versions — "2.61 MB" was being reported as a version
    // conflict against "1.13 MB".
    re: /\b(?:v|version\s+|node\s+|next\.js\s+|python\s+|react\s+|typescript\s+|tailwind\s+v?)(\d+(?:\.\d+){0,3})\b/gi,
    read: (m) => ({
      value: num(m[1].split(".").slice(0, 2).join(".")),
      unit: "version",
    }),
  },
  {
    kind: "duration",
    re: /(\d[\d,]*(?:\.\d+)?)\s*(ms|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|weeks?|months?|years?)\b/gi,
    read: (m) => {
      const unit = DURATION_UNIT[m[2].toLowerCase()];
      return unit ? { value: num(m[1]), unit } : null;
    },
  },
  {
    kind: "count",
    // A bare number is only a claim when a unit word follows it, and only when
    // that word describes something in the world rather than the file.
    re: /\b(\d[\d,]*)\s+([a-z]{3,18})\b/gi,
    read: (m) => {
      const unit = m[2].toLowerCase();
      if (STOP.has(unit) || DURATION_UNIT[unit] || META_UNIT.has(unit)) return null;
      return { value: num(m[1]), unit };
    },
  },
];

/**
 * The folder a page lives in — the unit "same subject" is judged on.
 *
 * This is the constraint that separates a contradiction from a comparison. The
 * detector kept reporting "$50 per thumbnail" against "$35 per thumbnail", and
 * "delivered 2 days early" against "12 days early" — true pairs, different
 * clients, no disagreement anywhere. Numbers only contradict when they
 * describe the same subject, and on a real wiki the subject is encoded in the
 * path far more reliably than in the sentence.
 *
 * The folder, not the filename. `clients/acme/profile.md` and
 * `clients/acme/transcript-2026-07-28.md` are one subject, which is what makes
 * "this client's discount is 5% here and 10% there" reachable; `stack/deploy.md`
 * and `stack/deploy-notes.md` are also one subject, which an
 * identity-by-filename rule got wrong in the other direction.
 */
export function scopeOf(relPath: string): string {
  const cut = relPath.lastIndexOf("/");
  return cut === -1 ? "" : relPath.slice(0, cut).toLowerCase();
}

/** Split into content terms, lowercased, stopwords and short tokens dropped. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9./_-]+/)
    .map((t) => t.replace(/^[./_-]+|[./_-]+$/g, ""))
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d/.test(t));
}

const CLAUSE_END = /[.;:,—|)\n]/;

/**
 * The words that qualify a number.
 *
 * Read backwards to the start of the clause and forwards to the end of it —
 * "the floor for video edits is $100" puts the subject before, "$100 minimum
 * per video edit" puts it after. Taking both and letting the overlap scorer
 * decide beats guessing which grammar the author used.
 */
function subjectFor(
  plain: string,
  lineStart: number,
  valueAt: number,
  valueEnd: number,
): { subject: string; terms: string[] } {
  const clauseStart = Math.max(
    lineStart,
    ...[".", ";", ":", ",", "—", "(", "|"].map((p) => plain.lastIndexOf(p, valueAt - 1) + 1),
  );
  const before = plain.slice(clauseStart, valueAt);

  const tail = plain.slice(valueEnd, valueEnd + 48);
  const stop = tail.search(CLAUSE_END);
  const after = stop === -1 ? tail : tail.slice(0, stop);

  const subject = `${before.trim()} ${after.trim()}`.replace(/\s+/g, " ").trim();
  return {
    subject: subject.slice(0, 160),
    terms: [...new Set([...terms(before), ...terms(after)])].slice(0, 10),
  };
}

/** The nearest markdown heading at or above a character offset. */
function headingIndex(plain: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  for (const m of plain.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    out.push({ at: m.index ?? 0, text: m[1].trim() });
  }
  return out;
}

/**
 * Lines that list rather than assert.
 *
 * A markdown table row, a rate card line and a frontmatter field are all
 * enumerations of options — "30 min — $150 / 60 min — $250" is a price list,
 * and reading it as two disagreeing prices is exactly the mistake that made
 * the first version unusable.
 */
function isEnumeration(line: string): boolean {
  if (line.includes("|")) return true;
  if (/^\s*[a-z][\w -]{0,28}:\s*\S/i.test(line) && !/\s(is|are|was|=)\s/i.test(line)) {
    return true;
  }
  // Three or more numbers on one line is a table in prose clothing.
  return (line.match(/\d[\d,.]*/g) ?? []).length >= 3;
}

export type ClaimSource = {
  id: string;
  relPath: string;
  title: string;
  plain: string;
  mtime: number;
};

/** Every typed numeric claim on one page. */
export function extractClaims(page: ClaimSource, cap = 120): Claim[] {
  const out: Claim[] = [];
  const headings = headingIndex(page.plain);
  const taken: [number, number][] = [];

  for (const pattern of PATTERNS) {
    for (const match of page.plain.matchAll(pattern.re)) {
      const at = match.index ?? 0;
      const end = at + match[0].length;
      // A more specific pattern already claimed this span — `$150/mo` must not
      // also be read as the count "150 mo".
      if (taken.some(([s, e]) => at < e && end > s)) continue;

      const lineStart = page.plain.lastIndexOf("\n", at) + 1;
      const lineEnd = page.plain.indexOf("\n", at);
      const text = page.plain.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();

      const read = pattern.read(match, text);
      if (!read) continue;
      taken.push([at, end]);
      if (isEnumeration(text)) continue;

      /*
       * A range is one fact, not two.
       *
       * "3-11 sec" and "$100–$400" state a span, and reading the endpoints as
       * separate claims produced "four words — 11 vs 15" on the real wiki from
       * two pages that agree completely. Detected from the characters either
       * side of the number rather than from a wider pattern, because the
       * separator varies (-, –, —, "to") and the surrounding grammar does not.
       */
      const beforeChar = page.plain.slice(Math.max(0, at - 4), at);
      const afterChar = page.plain.slice(end, end + 4);
      if (/\d\s?[-–—]\s?$/.test(beforeChar) || /^\s?[-–—]\s?\d/.test(afterChar)) continue;
      if (/\d\s+to\s+$/i.test(beforeChar) || /^\s+to\s+\d/i.test(afterChar)) continue;

      let heading = page.title;
      for (const h of headings) {
        if (h.at <= at) heading = h.text;
        else break;
      }

      const { subject, terms: own } = subjectFor(page.plain, lineStart, at, end);
      // Two content terms minimum. One word cannot identify a subject well
      // enough to accuse another page of contradicting it.
      if (own.length < 2) continue;

      out.push({
        pageId: page.id,
        relPath: page.relPath,
        title: page.title,
        subject,
        terms: own,
        scope: scopeOf(page.relPath),
        context: [...new Set([...terms(heading), ...terms(page.title)])].slice(0, 8),
        kind: pattern.kind,
        value: read.value,
        unit: read.unit,
        text: text.slice(0, 220),
        line: page.plain.slice(0, lineStart).split("\n").length,
        at: page.mtime,
        soft: SOFTENER.test(text),
      });
      if (out.length >= cap) return out;
    }
  }

  return out;
}

// ------------------------------------------------------------------ conflicts

export type ClaimConflict = {
  /** The vocabulary the two claims agree they are about. */
  subject: string;
  kind: ClaimKind;
  unit: string;
  /** 0–1: how confident we are these describe the same thing. */
  confidence: number;
  /**
   * True when the claims come from pages about different subjects.
   *
   * Kept as a flag rather than filtered away, and excluded from the report by
   * default. Within one subject a numeric disagreement is unambiguous: the
   * wiki says two things about one thing. Across subjects it usually is not —
   * two clients with different discounts are not a contradiction, they are two
   * clients — and no amount of vocabulary weighting separates those from the
   * genuine "the video floor is $100 here and $150 there". Precision within a
   * subject is worth more than coverage across them, so the honest default is
   * to show the case we can stand behind and let the other be asked for.
   */
  crossSubject: boolean;
  claims: Claim[];
};

/**
 * Inverse document frequency over subject terms.
 *
 * "rate" appearing in four hundred claims tells you nothing; "firpta" in two
 * tells you they are about the same thing. Without this weighting the overlap
 * score is dominated by whichever generic noun both sentences happened to use,
 * which is how the old detector produced a group keyed on "those".
 */
type Stats = {
  idf: Map<string, number>;
  /** How many distinct subjects each term appears in. */
  df: Map<string, number>;
  scopes: number;
};

function statsOf(claims: Claim[]): Stats {
  /*
   * Frequency is counted over distinct SUBJECTS, not over claims.
   *
   * This wiki holds a thousand client transcripts generated from one template,
   * so the phrase "delivered N days ahead of deadline" appears in hundreds of
   * them. Counted per claim those words look moderately rare and their
   * combined weight cleared every threshold, which is how "12 days early for
   * one client" got reported as contradicting "2 days early for another".
   * Counted per subject they are what they are — boilerplate — and collapse to
   * almost no weight. What survives is the vocabulary that varies between
   * subjects, which is exactly the vocabulary that can identify one.
   */
  const seen = new Map<string, Set<string>>();
  const scopes = new Set<string>();
  for (const c of claims) {
    scopes.add(c.scope);
    for (const t of new Set(c.terms)) {
      const set = seen.get(t);
      if (set) set.add(c.scope);
      else seen.set(t, new Set([c.scope]));
    }
  }
  const n = Math.max(scopes.size, 1);
  const idf = new Map<string, number>();
  const df = new Map<string, number>();
  for (const [term, where] of seen) {
    df.set(term, where.size);
    idf.set(term, Math.log(1 + n / (1 + where.size)));
  }
  return { idf, df, scopes: scopes.size };
}

type Match = {
  /** 0–1 overlap of the two subjects' vocabulary, weighted by rarity. */
  score: number;
  shared: string[];
  /** Subject count of the rarest term the two share — lower is stronger. */
  rarestDf: number;
};

/**
 * How much two claims look like they are about the same thing.
 *
 * Scored against the SMALLER of the two subjects, not their union. A Jaccard
 * over the union punishes a claim for saying more: "the grimoire viewer runs
 * on port 4747 locally" and "the grimoire viewer listens on port 4646" share
 * everything that matters and only three of eight distinct words, which scored
 * 0.38 and was thrown away. What we actually want to ask is whether one
 * subject is contained in the other.
 */
function compare(a: Claim, b: Claim, stats: Stats): Match {
  const setA = new Set(a.terms);
  const setB = new Set(b.terms);
  const weigh = (set: Set<string>) =>
    [...set].reduce((sum, t) => sum + (stats.idf.get(t) ?? 1), 0);

  const shared: string[] = [];
  let sharedWeight = 0;
  let rarestDf = Infinity;
  for (const t of setA) {
    if (!setB.has(t)) continue;
    shared.push(t);
    sharedWeight += stats.idf.get(t) ?? 1;
    rarestDf = Math.min(rarestDf, stats.df.get(t) ?? 1);
  }

  const floor = Math.min(weigh(setA), weigh(setB));
  // Agreeing on the section they sit under is corroboration, never the reason
  // for a match on its own — hence a small additive bonus rather than
  // membership in the term set.
  const sharedContext = a.context.filter((t) => b.context.includes(t)).length;
  const base = floor === 0 ? 0 : sharedWeight / floor;
  return {
    score: Math.min(1, base + Math.min(sharedContext, 3) * 0.02),
    shared,
    rarestDf,
  };
}

/**
 * The bar a pair must clear, which depends on whether they are about the same
 * subject.
 *
 * Within one subject — two pages in the same folder — a numeric disagreement
 * is unambiguous and the ordinary thresholds apply. Across subjects the claims
 * have only their words in common, so they must also share at least one word
 * that is genuinely distinguishing: `maxDf` caps how many other subjects the
 * rarest shared term is allowed to appear in.
 *
 * That cap is relative to the corpus, and has to be. An earlier version
 * required an absolute weight of 6, which on a 700-subject wiki was easy and
 * on a two-page test was unreachable — so the detector silently found nothing
 * and every planted contradiction failed while every trap passed.
 */
const NEAR = { score: 0.45, terms: 2, maxDf: Infinity };
const FAR = { score: 0.62, terms: 3, maxDf: 2 };

/**
 * A folder holding more than this many pages is an archive, not a subject.
 *
 * `scopeOf` assumes a folder groups pages about one thing, which holds for
 * `clients/acme/` and `stack/` and fails badly for
 * `content/youtube/raw/transcripts/`, where six hundred unrelated transcripts
 * share a directory. Treating those as one subject reported "150 mil" in one
 * video against "230 mil" in another as a contradiction. Above the threshold
 * each page becomes its own subject, which pushes those pairs into the
 * cross-subject tier where they are excluded by default.
 */
const ARCHIVE_PAGES = 20;

function withSubjects(claims: Claim[]): Claim[] {
  const pagesPerScope = new Map<string, Set<string>>();
  for (const c of claims) {
    const set = pagesPerScope.get(c.scope);
    if (set) set.add(c.pageId);
    else pagesPerScope.set(c.scope, new Set([c.pageId]));
  }
  return claims.map((c) =>
    (pagesPerScope.get(c.scope)?.size ?? 0) > ARCHIVE_PAGES ? { ...c, scope: c.pageId } : c,
  );
}

/** A term in at most this many subjects counts as distinguishing. */
function distinguishingDf(scopes: number): number {
  return Math.max(2, Math.ceil(scopes * 0.02));
}

/**
 * An index lists subjects; it is not one.
 *
 * `clients/index.md` sits in the same folder as every client page, so the
 * folder rule made "27 live orders" on the index a same-subject disagreement
 * with "73 live orders" on one of the clients it links to. A hub page is
 * always compared at the cross-subject bar.
 */
const HUB = /^(index|readme|_index|home|overview|summary|contents)$/i;

const isHub = (relPath: string) =>
  HUB.test(relPath.replace(/\.mdx?$/i, "").split("/").pop() ?? "");

function barFor(a: Claim, b: Claim, farMaxDf: number) {
  const sameSubject =
    a.scope === b.scope && !isHub(a.relPath) && !isHub(b.relPath);
  return sameSubject ? NEAR : { ...FAR, maxDf: farMaxDf };
}

function clears(
  m: Match,
  bar: { score: number; terms: number; maxDf: number },
): boolean {
  return (
    m.score >= bar.score && m.shared.length >= bar.terms && m.rarestDf <= bar.maxDf
  );
}

/** Below this relative gap the two numbers are the same number rounded. */
const MIN_RELATIVE_GAP = 0.02;
/** More members than this and it is an enumeration we failed to spot. */
const MAX_GROUP = 6;

function meaningfullyDifferent(a: number, b: number): boolean {
  const gap = Math.abs(a - b);
  return gap / Math.max(Math.abs(a), Math.abs(b), 1) >= MIN_RELATIVE_GAP;
}

/**
 * Pairs of claims that measure the same thing and disagree.
 *
 * Grown as cliques, not connected components. Transitive merging turned a rate
 * card into a single "contradiction" holding thirty-one different prices,
 * because each line matched the next. A new member must match EVERY existing
 * member, which is the difference between "these three pages disagree about
 * one number" and "these thirty lines each mention money".
 */
export function findConflicts(
  claims: Claim[],
  limit = 40,
  includeCrossSubject = false,
): ClaimConflict[] {
  const all = withSubjects(claims);
  const stats = statsOf(all);
  const farMaxDf = distinguishingDf(stats.scopes);

  const buckets = new Map<string, Claim[]>();
  for (const c of all) {
    if (c.soft) continue;
    const key = `${c.kind}|${c.unit}`;
    buckets.set(key, [...(buckets.get(key) ?? []), c]);
  }

  const out: ClaimConflict[] = [];

  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;

    /*
     * Candidates come from an inverted index on rare terms, not from every
     * other claim in the bucket.
     *
     * The first version compared all pairs. On the real wiki the `count`
     * bucket alone holds tens of thousands of claims — a billion comparisons,
     * and a detector that never returns. Two claims can only clear MIN_SCORE
     * if they share a term carrying real weight, so only those pairs are worth
     * scoring. Terms appearing in more than COMMON of the bucket are skipped:
     * "rate" would otherwise link every price to every other price at a cost
     * of O(n²) and a benefit of nothing.
     */
    const COMMON = Math.max(16, Math.floor(bucket.length * 0.03));
    const postings = new Map<string, number[]>();
    for (let i = 0; i < bucket.length; i++) {
      for (const t of new Set(bucket[i].terms)) {
        const list = postings.get(t);
        if (list) list.push(i);
        else postings.set(t, [i]);
      }
    }

    const claimed = new Set<number>();

    for (let i = 0; i < bucket.length; i++) {
      if (claimed.has(i)) continue;
      const candidates = new Set<number>();
      for (const t of new Set(bucket[i].terms)) {
        const list = postings.get(t);
        if (!list || list.length > COMMON) continue;
        for (const j of list) if (j !== i && !claimed.has(j)) candidates.add(j);
        if (candidates.size > 300) break;
      }
      if (!candidates.size) continue;

      const group = [i];
      let best = 0;
      let shared: string[] = bucket[i].terms;

      // Strongest first, so the clique forms around the clearest match.
      const ranked = [...candidates]
        .map((j) => ({ j, m: compare(bucket[i], bucket[j], stats) }))
        .filter(({ j, m }) => clears(m, barFor(bucket[i], bucket[j], farMaxDf)))
        .sort((x, y) => y.m.score - x.m.score);

      for (const { j, m } of ranked) {
        if (group.length >= MAX_GROUP) break;
        const fitsAll = group.every((g) =>
          clears(compare(bucket[g], bucket[j], stats), barFor(bucket[g], bucket[j], farMaxDf)),
        );
        if (!fitsAll) continue;
        group.push(j);
        best = Math.max(best, m.score);
        shared = shared.filter((t) => bucket[j].terms.includes(t));
      }

      if (group.length < 2) continue;

      const claims = group.map((g) => bucket[g]);
      const pages = new Set(claims.map((c) => c.pageId));
      const values = [...new Set(claims.map((c) => c.value))];
      if (pages.size < 2 || values.length < 2) continue;
      // Every distinct value must actually differ from every other; 2.55 and
      // 2.61 are the same measurement, reported twice.
      const distinct = values.every((v, x) =>
        values.every((w, y) => x === y || meaningfullyDifferent(v, w)),
      );
      if (!distinct) continue;

      for (const g of group) claimed.add(g);
      const subjects = new Set(claims.map((c) => c.scope));
      out.push({
        subject: shared.slice(0, 4).join(" ") || claims[0].subject.slice(0, 60),
        kind: claims[0].kind,
        unit: key.split("|")[1],
        confidence: Math.min(1, best),
        crossSubject: subjects.size > 1,
        claims: claims.sort((a, b) => b.at - a.at),
      });
    }
  }

  return out
    .filter((c) => includeCrossSubject || !c.crossSubject)
    .sort(
      (a, b) =>
        b.confidence * Math.max(...b.claims.map((c) => c.at)) -
        a.confidence * Math.max(...a.claims.map((c) => c.at)),
    )
    .slice(0, limit);
}

/**
 * Does new text disagree with what the wiki already says?
 *
 * This is the write-time question, and it is stricter still: it runs while an
 * agent is waiting, and a false alarm here teaches the agent to ignore the
 * channel permanently. Only hard claims, only strong overlap, one warning per
 * incoming claim.
 */
export function conflictsWith(
  incoming: Claim[],
  existing: Claim[],
  minScore = 0.6,
): { incoming: Claim; existing: Claim; confidence: number }[] {
  // Re-scoped together so both sides agree on what counts as one subject,
  // then split back by position — withSubjects returns copies, so the
  // originals cannot be looked up by identity.
  const scoped = withSubjects([...incoming, ...existing]);
  const mineAll = scoped.slice(0, incoming.length);
  const theirsAll = scoped.slice(incoming.length);
  const stats = statsOf(scoped);
  const farMaxDf = distinguishingDf(stats.scopes);
  const out: { incoming: Claim; existing: Claim; confidence: number }[] = [];

  for (const mine of mineAll) {
    if (mine.soft) continue;
    let best: { existing: Claim; confidence: number } | null = null;
    for (const theirs of theirsAll) {
      if (theirs.soft) continue;
      if (theirs.kind !== mine.kind || theirs.unit !== mine.unit) continue;
      if (theirs.pageId === mine.pageId) continue;
      if (!meaningfullyDifferent(theirs.value, mine.value)) continue;
      const bar = barFor(mine, theirs, farMaxDf);
      const m = compare(mine, theirs, stats);
      if (!clears(m, bar) || m.score < minScore) continue;
      if (!best || m.score > best.confidence) best = { existing: theirs, confidence: m.score };
    }
    // One warning per incoming claim: the agent needs the strongest
    // disagreement, not every page that mentions a number.
    if (best) out.push({ incoming: mine, ...best });
  }

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
