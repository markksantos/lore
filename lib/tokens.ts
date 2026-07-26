import { encode } from "gpt-tokenizer";

/**
 * Context budgeting.
 *
 * A 1,400-page wiki is roughly 2.3M tokens. No model can read it. That single
 * fact governs how a wiki should be structured for agents, and almost nobody
 * knows it about their own notes — because nothing measures it.
 *
 * Counting is done with a real BPE tokenizer rather than the usual chars/4
 * rule of thumb. The estimate is fine in aggregate but wrong exactly where it
 * matters: markdown is dense with punctuation, paths and code, all of which
 * tokenize far worse than prose. Being told a folder fits when it doesn't is
 * the one failure this feature exists to prevent.
 *
 * The counts come from a GPT-family tokenizer. Claude's differs by a few
 * percent, which is immaterial against a 200k window when the answer is
 * "this folder is 1.1M tokens".
 */

/** Context windows worth measuring against, largest last. */
export const WINDOWS = [
  { name: "200k", tokens: 200_000 },
  { name: "1M", tokens: 1_000_000 },
] as const;

export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    // The tokenizer can reject pathological input (lone surrogates from a
    // mangled paste). Falling back keeps the number roughly right instead of
    // failing the whole report.
    return Math.ceil(text.length / 4);
  }
}

export type BudgetNode = {
  /** Folder path, or "" for the vault root. */
  folder: string;
  pages: number;
  tokens: number;
  /** Largest pages in this folder, biggest first. */
  heaviest: { id: string; title: string; tokens: number }[];
};

export type BudgetReport = {
  totalPages: number;
  totalTokens: number;
  /** Tokens in the generated agent index — what an agent pays just to orient. */
  indexTokens: number;
  folders: BudgetNode[];
  /** Pages so large they crowd a window on their own. */
  outliers: { id: string; title: string; folder: string; tokens: number }[];
};

export function buildBudget(
  pages: { id: string; title: string; folder: string; text: string }[],
  indexMarkdown: string,
): BudgetReport {
  const byFolder = new Map<string, BudgetNode>();
  const all: { id: string; title: string; folder: string; tokens: number }[] = [];
  let totalTokens = 0;

  for (const page of pages) {
    const tokens = countTokens(page.text);
    totalTokens += tokens;
    all.push({ id: page.id, title: page.title, folder: page.folder, tokens });

    const node =
      byFolder.get(page.folder) ??
      ({ folder: page.folder, pages: 0, tokens: 0, heaviest: [] } satisfies BudgetNode);
    node.pages += 1;
    node.tokens += tokens;
    node.heaviest.push({ id: page.id, title: page.title, tokens });
    byFolder.set(page.folder, node);
  }

  for (const node of byFolder.values()) {
    node.heaviest.sort((a, b) => b.tokens - a.tokens);
    node.heaviest = node.heaviest.slice(0, 5);
  }

  // "Outlier" is relative to the corpus, not an absolute size: a 4k-token page
  // is unremarkable in a wiki of essays and alarming in a wiki of one-liners.
  const mean = pages.length ? totalTokens / pages.length : 0;
  const outliers = all
    .filter((p) => p.tokens > Math.max(mean * 6, 2_000))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 20);

  return {
    totalPages: pages.length,
    totalTokens,
    indexTokens: countTokens(indexMarkdown),
    folders: [...byFolder.values()].sort((a, b) => b.tokens - a.tokens),
    outliers,
  };
}

/** Human-readable token count: 2_338_412 -> "2.3M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
