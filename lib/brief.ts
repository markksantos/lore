import { countTokens } from "@/lib/tokens";
import type { WikiIndex, WikiPage } from "@/lib/index-core";
import type { WriteEvent } from "@/lib/journal";

/**
 * The brief: what your agents learned, in ten lines.
 *
 * Every previous screen in this app asked you to come to it — to open Review,
 * scan a list, and decide something. That loses to a corpus you have already
 * admitted you do not read. This is the one surface that works on a day you
 * forget Lore exists, because it comes to you and it is short.
 *
 * It is deliberately NOT a changelog. A changelog of 300 writes a week is the
 * same unreadable pile in a different order. This answers a narrower question:
 * of everything my agents wrote, what would I want to know if I only had thirty
 * seconds — and, crucially, what does it mean rather than which file moved.
 *
 * Nothing here writes to the wiki. It reads the journal and the pages, and the
 * only state it keeps is which brief you last saw.
 */

export type BriefItem = {
  pageId: string;
  relPath: string;
  title: string;
  /** Plain-English line. Written by the local model when one is available. */
  line: string;
  /** Why it made the cut, for the "why am I seeing this" question. */
  reason: string;
  kind: WriteEvent["kind"];
  at: number;
  linesAdded: number;
  linesRemoved: number;
  score: number;
  /** Which agent wrote it, when the harness hook recorded that. */
  agent: string | null;
  /** The passage the line was drawn from, so a claim can be checked. */
  evidence: string;
};

export type Brief = {
  since: number;
  until: number;
  /** Total writes in the window, so the count that was cut is visible. */
  events: number;
  pagesTouched: number;
  items: BriefItem[];
  /** Subjects that moved across several pages at once. */
  threads: { subject: string; pages: string[]; titles: string[] }[];
  /** True when a local model wrote the lines rather than the fallback. */
  synthesised: boolean;
};

/**
 * Scoring: what a person would actually want to hear about.
 *
 * This is NOT the Review ranking. Review asked "what could hurt me", which is a
 * risk model and produced a list of things to worry about. A brief answers "what
 * is worth knowing", which weighs differently: a brand new page about a client
 * is interesting, and the same page being reformatted is not, even though the
 * second one deletes more lines.
 *
 *  - NEW beats REWRITTEN beats APPENDED. A page that did not exist yesterday is
 *    the single most briefable event there is.
 *  - SUBSTANCE over churn. Ten lines added to a page that was empty is a fact;
 *    ten lines added to a 3,000-word transcript is noise. Scored as a share of
 *    the page rather than an absolute.
 *  - REACH still counts, because a change to something many pages lean on
 *    propagates — but far less than it does in a risk model.
 *  - RAW CAPTURE is discounted hard. Transcripts and exports are the bulk of a
 *    real corpus by volume and almost never the thing you want briefed.
 */
const RAW_HINT = /transcript|raw\/|export|\.srt|captions|dump/i;

export function scoreForBrief(
  event: WriteEvent,
  page: WikiPage,
  inbound: number,
): { score: number; reason: string } {
  const reasons: string[] = [];
  let score = 0;

  if (event.kind === "created") {
    score += 40;
    reasons.push("new page");
  } else if (event.kind === "rewritten") {
    score += 18;
    reasons.push("rewritten");
  } else if (event.kind === "appended") {
    score += 8;
  }

  // Share of the page that moved, not the raw line count.
  const size = Math.max(page.words / 8, 20);
  const churn = (event.linesAdded + event.linesRemoved) / size;
  score += Math.min(churn, 1) * 25;
  if (churn > 0.5 && event.kind !== "created") reasons.push("substantially changed");

  /* Only meaningful on a page that already existed. A "created" event whose
     later rewrites got collapsed into it still carries a removal count, and
     printing "new page · 208 lines removed" reads as a bug because it is one. */
  if (event.kind !== "created" && event.linesRemoved > 12) {
    score += 10;
    reasons.push(`${event.linesRemoved} lines removed`);
  }

  if (inbound >= 5) {
    score += Math.min(Math.log2(inbound + 1) * 4, 16);
    reasons.push(`${inbound} pages depend on it`);
  }

  // Captured material is the bulk of a real vault and the least briefable part
  // of it. Not excluded — a new transcript can matter — just made to earn it.
  if (RAW_HINT.test(page.relPath)) score *= 0.35;

  return {
    score: Math.round(score),
    reason: reasons.length ? reasons.join(" · ") : "changed",
  };
}

/**
 * What actually changed, as text — the added lines, not the top of the page.
 *
 * The first version of this handed the model `page.plain.slice(0, 700)`, which
 * is the page's intro paragraph and has nothing to do with the edit. For an
 * append — the most common thing an agent does — that describes the part that
 * did not change, so appending to the same page three weeks running printed the
 * identical sentence three times. The header promised "what the page now says";
 * the code delivered "what this page has always said".
 *
 * `before` is the previous version from history. Where there isn't one, the
 * caller falls back to the page top and the line is weaker but never wrong.
 */
export function changedText(before: string, after: string, maxChars = 900): string {
  const prev = new Set(before.split("\n").map((l) => l.trim()).filter(Boolean));
  const added: string[] = [];
  for (const raw of after.split("\n")) {
    const line = raw.trim();
    if (!line || prev.has(line)) continue;
    added.push(line);
    if (added.join(" ").length > maxChars) break;
  }
  return added.join("\n").slice(0, maxChars);
}

/** The most informative chunk of a page, for the model and for the fallback. */
export function evidenceFor(page: WikiPage, maxChars = 700): string {
  const body = page.plain.trim();
  if (!body) return "";
  // Skip a leading title echo; the first real sentence is where the fact is.
  const stripped = body.replace(new RegExp(`^${escapeRe(page.title)}[\\s.:—-]*`, "i"), "");
  return stripped.slice(0, maxChars);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Subjects that moved across several pages in the same window.
 *
 * A single page changing is an event; the same name appearing in four pages
 * that all changed this week is a story, and it is the thing a person would
 * actually ask about. Matched on capitalised multi-word names and folder-level
 * co-occurrence, which is crude but wrong in a visible way rather than a
 * confident one.
 */
export function findThreads(
  items: { pageId: string; title: string; relPath: string }[],
  minPages = 3,
): { subject: string; pages: string[]; titles: string[] }[] {
  const byFolder = new Map<string, { pages: string[]; titles: string[] }>();
  for (const item of items) {
    const folder = item.relPath.split("/").slice(0, 2).join("/");
    if (!folder.includes("/")) continue;
    const entry = byFolder.get(folder) ?? { pages: [], titles: [] };
    entry.pages.push(item.pageId);
    entry.titles.push(item.title);
    byFolder.set(folder, entry);
  }

  return [...byFolder.entries()]
    .filter(([, v]) => v.pages.length >= minPages)
    .map(([subject, v]) => ({
      subject: subject.split("/").pop() ?? subject,
      pages: v.pages.slice(0, 8),
      titles: v.titles.slice(0, 8),
    }))
    .sort((a, b) => b.pages.length - a.pages.length)
    .slice(0, 4);
}

/**
 * Collapse the journal to one entry per page, keeping the most significant.
 *
 * An agent that touches a page eleven times in an afternoon produced one piece
 * of news, not eleven. Creation always wins, because "this page is new" is the
 * fact even if a later append moved more lines.
 */
/**
 * Drop deletions that are really renames.
 *
 * A rename lands in the journal as a delete plus a create, and reporting the
 * delete half produced brief rows saying three of the user's client transcripts
 * had been destroyed when they had simply been redated. They scored 1000, so
 * they took the top three slots, and they linked nowhere because the page no
 * longer exists under that name.
 *
 * Pairing is by folder and size within the window: a deletion is treated as a
 * rename when a page was created in the same folder in the same window. Crude,
 * and deliberately biased toward silence — a missed deletion is a quiet brief,
 * a false one is the app lying about data loss.
 */
export function withoutRenames(events: WriteEvent[]): WriteEvent[] {
  const createdFolders = new Set<string>();
  for (const e of events) {
    if (e.kind === "created") createdFolders.add(dirOf(e.relPath));
  }
  return events.filter(
    (e) => e.kind !== "deleted" || !createdFolders.has(dirOf(e.relPath)),
  );
}

const dirOf = (relPath: string) => relPath.split("/").slice(0, -1).join("/");

export function collapseEvents(events: WriteEvent[]): Map<string, WriteEvent> {
  const latest = new Map<string, WriteEvent>();
  for (const e of events) {
    const prev = latest.get(e.relPath);
    if (!prev) {
      latest.set(e.relPath, { ...e });
      continue;
    }
    latest.set(e.relPath, {
      ...e,
      kind: prev.kind === "created" || e.kind === "created" ? "created" : e.kind,
      at: Math.max(prev.at, e.at),
      linesAdded: prev.linesAdded + e.linesAdded,
      linesRemoved: prev.linesRemoved + e.linesRemoved,
    });
  }
  return latest;
}

/**
 * The line when no model wrote one. Derived from `evidence`, which is the diff
 * where one exists — computing the diff and then displaying the page top
 * anyway was the original bug wearing a hat.
 *
 * Headings are stripped rather than swallowed: `plain` now keeps `# ` markers,
 * and a heading has no terminal punctuation, so a naive first-sentence split
 * returned `"# Wiki Index\nPersonal knowledge base."` as one line.
 */
export function lineFrom(evidence: string): string {
  const prose = evidence
    .split("\n")
    .map((l) => l.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").trim())
    .filter(Boolean)
    .join(" ");
  const sentence = prose.split(/(?<=[.!?])\s/)[0] ?? prose;
  const trimmed = sentence.trim();
  if (!trimmed) return "Changed, but the page has no readable body.";
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}…` : trimmed;
}

/** Kept for callers that only have the page. */
export function fallbackLine(page: WikiPage): string {
  return lineFrom(evidenceFor(page, 400));
}

/**
 * Assemble the brief from an index and a journal window.
 *
 * Pure: the caller supplies the events and decides whether to run a model over
 * the result. That keeps this testable and keeps the slow part optional — a
 * brief with fallback lines is still a brief, and is strictly better than a
 * spinner.
 */
export function buildBrief(
  index: WikiIndex,
  events: WriteEvent[],
  since: number,
  limit = 8,
  agentByPath: Record<string, { agent: string } | undefined> = {},
): Brief {
  const collapsed = collapseEvents(withoutRenames(events));
  const byId = new Map(index.pages.map((p) => [p.relPath, p]));

  const scored: BriefItem[] = [];
  for (const [relPath, event] of collapsed) {
    const page = byId.get(relPath);
    /*
     * A deleted page is not in the index, so `continue` silently dropped every
     * deletion — the one event the journal exists to catch. ("Did an agent
     * quietly delete something I cared about?" is its own opening comment.)
     * Deletions are reported from the event alone.
     */
    if (!page) {
      if (event.kind !== "deleted") continue;
      const name = relPath.split("/").pop()?.replace(/\.mdx?$/i, "") ?? relPath;
      scored.push({
        pageId: relPath.replace(/\.mdx?$/i, ""),
        relPath,
        title: name,
        line: `Deleted — ${relPath}`,
        reason: "removed from the wiki",
        kind: "deleted",
        at: event.at,
        linesAdded: 0,
        linesRemoved: event.linesRemoved,
        /* High, not infinite. At 1000 a single deletion outranked every real
           item and a handful of them took the whole brief. */
        score: 120 + Math.min(event.linesRemoved, 200) * 0.3,
        agent: agentByPath[relPath]?.agent ?? null,
        evidence: "",
      });
      continue;
    }
    const inbound = index.backlinks[page.id]?.length ?? 0;
    const { score, reason } = scoreForBrief(event, page, inbound);
    scored.push({
      pageId: page.id,
      relPath,
      title: page.title,
      line: fallbackLine(page),
      reason,
      kind: event.kind,
      at: event.at,
      linesAdded: event.linesAdded,
      linesRemoved: event.linesRemoved,
      score,
      agent: agentByPath[relPath]?.agent ?? null,
      evidence: evidenceFor(page),
    });
  }

  scored.sort((a, b) => b.score - a.score || b.at - a.at);

  /*
   * Spread the brief across the wiki instead of down one folder.
   *
   * Ranking alone gave eight items that were all client conversations, because
   * that is where the volume is. A brief where every line is the same kind of
   * thing tells you about one folder and hides the rest of the week — so no
   * folder may take more than a third of the slots while other folders still
   * have something to say.
   */
  const perFolder = Math.max(2, Math.ceil(limit / 3));
  const taken = new Map<string, number>();
  const items: BriefItem[] = [];
  for (const pass of [0, 1]) {
    for (const item of scored) {
      if (items.length >= limit) break;
      if (items.includes(item)) continue;
      const folder = item.relPath.split("/").slice(0, 2).join("/");
      const n = taken.get(folder) ?? 0;
      // Second pass ignores the cap, so a quiet week still fills the brief.
      if (pass === 0 && n >= perFolder) continue;
      taken.set(folder, n + 1);
      items.push(item);
    }
  }

  return {
    since,
    until: Date.now(),
    events: events.length,
    pagesTouched: collapsed.size,
    items,
    threads: findThreads(scored.slice(0, 40)),
    synthesised: false,
  };
}

/** Rough cost of briefing, so the caller can keep the model call bounded. */
export function briefTokens(brief: Brief): number {
  return brief.items.reduce((sum, item) => sum + countTokens(item.evidence), 0);
}
