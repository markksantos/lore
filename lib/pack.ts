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
    if (countTokens(text) <= maxTokens) {
      out.push({ heading, text });
      return;
    }
    // Hard split on paragraphs, packing until the budget is reached.
    let chunk: string[] = [];
    for (const para of text.split(/\n{2,}/)) {
      const candidate = [...chunk, para].join("\n\n");
      if (chunk.length && countTokens(candidate) > maxTokens) {
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
  return out;
}

const TRUST_WEIGHT: Record<string, number> = {
  verified: 1.35,
  aging: 1.1,
  unverified: 1,
  // A page confirmed once and rewritten since is the most dangerous kind: it
  // reads as settled and is not. Ranked below something never checked at all.
  lapsed: 0.8,
};

function relevance(text: string, terms: string[], title: string, heading: string | null): number {
  const hay = text.toLowerCase();
  const head = `${title} ${heading ?? ""}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const inBody = hay.split(term).length - 1;
    if (inBody) score += Math.min(inBody, 4) * 2;
    if (head.includes(term)) score += 8;
  }
  return score;
}

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
): Pack {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 2);

  const scored: Passage[] = [];
  for (const page of pages) {
    const trust = trustOf(ledger, page.id, hashes.get(page.id) ?? "");
    for (const section of splitSections(page.plain)) {
      const base = relevance(section.text, terms, page.title, section.heading);
      if (base <= 0) continue;
      const tokens = countTokens(section.text);
      scored.push({
        pageId: page.id,
        relPath: page.relPath,
        title: page.title,
        section: section.heading,
        text: section.text,
        tokens,
        score: base * (TRUST_WEIGHT[trust] ?? 1),
        trust,
      });
    }
  }

  scored.sort((a, b) => b.score / Math.max(b.tokens, 1) - a.score / Math.max(a.tokens, 1));

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
