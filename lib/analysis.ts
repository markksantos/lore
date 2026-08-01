import { countTokens } from "@/lib/tokens";
import { trustOf, type Ledger } from "@/lib/verify";
import type { Attribution } from "@/lib/harness";
import { extractClaims, findConflicts } from "@/lib/claims";

/**
 * The analyses that make a wiki improve rather than merely be measured.
 *
 * Everything here reads data Lore already has — the index, the ledger, the
 * journal, the attribution log — and turns it into something a person can act
 * on this afternoon.
 */

export type AnalysisPage = {
  id: string;
  title: string;
  relPath: string;
  plain: string;
  words: number;
  tags: string[];
  folder: string;
  mtime: number;
  frontmatter: Record<string, unknown>;
};

// ------------------------------------------------------------ contradictions

/**
 * Numeric claims about the same subject that disagree.
 *
 * The implementation moved to lib/claims.ts. What was here matched
 * `subject is NUMBER unit` and grouped by the literal subject string, which
 * scored 0 of 9 known disagreements on the real wiki and produced one group
 * keyed on the pronoun "those". This wrapper keeps the shape its callers
 * expect and adds the trust state, which claims.ts has no business knowing
 * about.
 */
export type Contradiction = {
  subject: string;
  kind: string;
  /** 0-1. Shown, because a 0.5 and a 0.95 deserve different attention. */
  confidence: number;
  /** True when the claims come from pages about different subjects. */
  crossSubject: boolean;
  claims: {
    pageId: string;
    relPath: string;
    title: string;
    text: string;
    line: number;
    value: number;
    unit: string;
    trust: string;
    at: number;
  }[];
};

export function findContradictions(
  pages: AnalysisPage[],
  ledger: Ledger,
  hashes: Map<string, string>,
  limit = 30,
  includeCrossSubject = false,
): Contradiction[] {
  const claims = pages.flatMap((page) =>
    extractClaims({
      id: page.id,
      relPath: page.relPath,
      title: page.title,
      plain: page.plain,
      mtime: page.mtime,
    }),
  );

  return findConflicts(claims, limit, includeCrossSubject).map((conflict) => ({
    subject: conflict.subject,
    kind: conflict.kind,
    confidence: conflict.confidence,
    crossSubject: conflict.crossSubject,
    claims: conflict.claims.map((c) => ({
      pageId: c.pageId,
      relPath: c.relPath,
      title: c.title,
      text: c.text,
      line: c.line,
      value: c.value,
      unit: c.unit,
      trust: trustOf(ledger, c.pageId, hashes.get(c.pageId) ?? ""),
      at: c.at,
    })),
  }));
}

// ------------------------------------------------------------- calibration

export type Calibration = {
  band: string;
  pages: number;
  verified: number;
  lapsed: number;
  /** Of the ones a human ruled on, how many held up. */
  accuracy: number | null;
};

/**
 * Do agents know when they are right?
 *
 * Measured on a real vault: 1,156 pages carried an agent-written `confidence:`
 * field, 959 of them "high" and two "low". A grade that is 83% top marks and
 * self-awarded carries no information at all — but that is an assertion until
 * it is checked against what humans actually confirmed.
 *
 * This is that check. It only reports bands a human has ruled on, because
 * accuracy computed from zero verifications is a number that looks like
 * evidence and is not.
 */
export function calibration(
  pages: AnalysisPage[],
  ledger: Ledger,
  hashes: Map<string, string>,
): Calibration[] {
  const bands = new Map<string, { pages: number; verified: number; lapsed: number }>();

  for (const page of pages) {
    const raw = page.frontmatter?.confidence ?? page.frontmatter?.certainty;
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const band = String(raw).toLowerCase().trim();
    if (!band) continue;

    const row = bands.get(band) ?? { pages: 0, verified: 0, lapsed: 0 };
    row.pages += 1;
    const trust = trustOf(ledger, page.id, hashes.get(page.id) ?? "");
    if (trust === "verified" || trust === "aging") row.verified += 1;
    if (trust === "lapsed") row.lapsed += 1;
    bands.set(band, row);
  }

  return [...bands.entries()]
    .map(([band, row]) => {
      const ruled = row.verified + row.lapsed;
      return { band, ...row, accuracy: ruled ? Math.round((row.verified / ruled) * 100) : null };
    })
    .sort((a, b) => b.pages - a.pages);
}

// ------------------------------------------------------------ orphan rescue

export type Rescue = {
  pageId: string;
  title: string;
  relPath: string;
  suggestions: { pageId: string; title: string; relPath: string; shared: string[] }[];
};

/**
 * Where an unlinked page probably belongs.
 *
 * Health already reports orphans, which tells you a page fell out of the wiki
 * and nothing about how to put it back. On a corpus with 792 orphans, a list
 * without suggestions is a list nobody works through.
 *
 * Candidates come from shared tags and folder, then distinctive shared words —
 * cheap signals that do not need the embedding index to exist.
 */
export function rescueOrphans(
  orphans: AnalysisPage[],
  all: AnalysisPage[],
  limit = 25,
): Rescue[] {
  const df = new Map<string, number>();
  const tokensOf = (p: AnalysisPage) =>
    new Set(
      `${p.title} ${p.plain.slice(0, 4000)}`
        .toLowerCase()
        .match(/[a-z][a-z0-9-]{4,}/g) ?? [],
    );

  const tokenCache = new Map<string, Set<string>>();
  for (const page of all) {
    const t = tokensOf(page);
    tokenCache.set(page.id, t);
    for (const word of t) df.set(word, (df.get(word) ?? 0) + 1);
  }

  const out: Rescue[] = [];
  for (const orphan of orphans.slice(0, limit)) {
    const mine = tokenCache.get(orphan.id) ?? new Set();
    const scored: { page: AnalysisPage; score: number; shared: string[] }[] = [];

    for (const other of all) {
      if (other.id === orphan.id) continue;
      let score = 0;
      const shared: string[] = [];

      if (other.folder === orphan.folder) score += 3;
      for (const tag of orphan.tags) if (other.tags.includes(tag)) score += 4;

      for (const word of mine) {
        const seen = df.get(word) ?? 0;
        // Words appearing nearly everywhere say nothing about relatedness.
        if (seen > all.length * 0.15) continue;
        if (tokenCache.get(other.id)?.has(word)) {
          score += 2;
          if (shared.length < 4) shared.push(word);
        }
      }

      if (score >= 6) scored.push({ page: other, score, shared });
    }

    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) continue;

    out.push({
      pageId: orphan.id,
      title: orphan.title,
      relPath: orphan.relPath,
      suggestions: scored.slice(0, 3).map((s) => ({
        pageId: s.page.id,
        title: s.page.title,
        relPath: s.page.relPath,
        shared: s.shared,
      })),
    });
  }
  return out;
}

// ------------------------------------------------------------- corpus value

export type CorpusValue = {
  pages: number;
  tokens: number;
  /** Windows of 200k needed to hold the whole corpus. */
  windows: number;
  verifiedTokens: number;
  coldTokens: number;
  /** Tokens saved per question by sending a pack instead of the whole index. */
  savedPerQuestion: number;
};

/**
 * What the wiki costs and what Lore saves.
 *
 * The saving is the difference between handing an agent the index and handing
 * it a pack: measured against a typical 8k pack, not a number invented for a
 * marketing page.
 */
export function corpusValue(
  pages: AnalysisPage[],
  ledger: Ledger,
  hashes: Map<string, string>,
  coldIds: Set<string>,
  packBudget = 8_000,
): CorpusValue {
  let tokens = 0;
  let verifiedTokens = 0;
  let coldTokens = 0;

  for (const page of pages) {
    const t = countTokens(page.plain);
    tokens += t;
    if (trustOf(ledger, page.id, hashes.get(page.id) ?? "") === "verified") verifiedTokens += t;
    if (coldIds.has(page.id)) coldTokens += t;
  }

  return {
    pages: pages.length,
    tokens,
    windows: Math.ceil(tokens / 200_000),
    verifiedTokens,
    coldTokens,
    savedPerQuestion: Math.max(0, tokens - packBudget),
  };
}

// ---------------------------------------------------------------- line blame

export type BlameLine = { line: number; text: string; agent: string | null; at: number | null };

/**
 * Who wrote each line.
 *
 * Git cannot answer this on a wiki, because most writes never reach a commit —
 * they are an agent editing a file between commits, or a human in the app. The
 * journal plus the attribution log can, approximately: a line present in the
 * current text but absent from a given past version was introduced after it.
 */
export function blame(
  current: string,
  versions: { at: number; text: string }[],
  attributions: Attribution[],
  relPath: string,
): BlameLine[] {
  const ordered = [...versions].sort((a, b) => a.at - b.at);
  const attributionsFor = attributions
    .filter((a) => a.file.endsWith(relPath))
    .sort((a, b) => a.at - b.at);

  return current.split("\n").map((text, i) => {
    if (!text.trim()) return { line: i + 1, text, agent: null, at: null };

    // The first version that already contained this line dates it; if every
    // stored version has it, the line predates our history and is unattributed.
    const introduced = ordered.find((v) => v.text.includes(text));
    const at = introduced ? introduced.at : (ordered[0]?.at ?? null);
    if (introduced && ordered[0] && introduced.at === ordered[0].at) {
      return { line: i + 1, text, agent: null, at: null };
    }

    const writer = attributionsFor.filter((a) => at === null || a.at <= at).pop();
    return { line: i + 1, text, agent: writer?.agent ?? null, at };
  });
}
