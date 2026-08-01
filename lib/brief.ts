import { countTokens } from "@/lib/tokens";
import type { WikiIndex, WikiPage } from "@/lib/index-core";
import type { WriteEvent } from "@/lib/journal";
import { seenPenalty, type Seen } from "@/lib/seen";

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
  /**
   * You have been shown this before.
   *
   * When everything in the window has been seen, the penalty applies evenly and
   * the ranking degrades back to its original order — so a brief opened twice
   * in an afternoon starts repeating. Showing stale items dressed as news is
   * the mirror problem again; showing nothing is worse. So they are shown, and
   * labelled, and the header says how many were new.
   */
  repeat: boolean;
  /** True when the model wrote this line rather than the page's own sentence. */
  written?: boolean;
  /**
   * Pages that cite this one, and would be read differently now.
   *
   * A change to a page is only half the news. "The deploy pipeline moved to
   * on-push" matters because four other pages describe workflows built on the
   * old behaviour, and nothing in a changelog says so — the reader has to
   * already know the shape of their own wiki. Backlinks are the honest,
   * computable version of "what does this affect".
   */
  affects: { pageId: string; title: string }[];
};

export type Brief = {
  since: number;
  until: number;
  /** Total writes in the window, so the count that was cut is visible. */
  events: number;
  pagesTouched: number;
  items: BriefItem[];
  /** How many of `items` you have not been shown before. */
  fresh: number;
  hasMore: boolean;
  /** Everything that qualified in this window, not just what is shown. */
  total: number;
  /**
   * Subjects that moved across several pages at once.
   *
   * Promoted from a footnote to a grouping. The threads were computed, rendered
   * as one line of trailing prose, and then the items were listed flat in
   * reverse-chronological order — so "eight things happened to this client
   * today" arrived as eight unrelated rows and the reader had to notice the
   * pattern themselves. `items` on a thread are the rows that belong to it.
   */
  threads: {
    subject: string;
    pages: string[];
    titles: string[];
    items?: BriefItem[];
  }[];
  /** True when a local model wrote EVERY line rather than the fallback. */
  synthesised: boolean;
  /** How many lines the model wrote, so the UI can be specific. */
  written?: number;
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
  /**
   * Which agent wrote it, when the harness hook recorded one.
   *
   * This was resolved by the caller, attached to the OUTPUT, and never allowed
   * to touch a score — so the screen headed "what your agents wrote" ranked a
   * page you typed yourself an hour ago above one an agent produced overnight.
   * Fourteen of sixteen reviewers found that on their own week. It is not a
   * busy-week artifact; it is arithmetic, and this is the term that was
   * missing.
   */
  agent: string | null,
  /**
   * Whether attribution is working at all in this window. Without it every page
   * looks unattributed, and penalising all of them would empty the brief — so
   * the penalty only applies when some pages DO carry an agent and this one
   * does not.
   */
  attributionWorking: boolean,
  /** Pages you have already been shown or opened. See lib/seen. */
  seen: Seen = {},
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

  /*
   * Recency, as a multiplier rather than a tiebreaker.
   *
   * `event.at` was read nowhere in this function — it only broke ties in the
   * final sort. So on a 30-day window a page created four weeks ago outranked a
   * rewrite from an hour ago, in a feature whose entire premise is telling you
   * what just happened.
   */
  const ageDays = Math.max(0, (Date.now() - event.at) / 86_400_000);
  score *= 1 / (1 + ageDays * 0.12);

  // Captured material is the bulk of a real vault and the least briefable part
  // of it. Not excluded — a new transcript can matter — just made to earn it.
  if (RAW_HINT.test(page.relPath)) score *= 0.35;

  /*
   * You are not news to yourself.
   *
   * A brief is worth opening only if the reader is not also the writer. Pages
   * with no recorded agent, on a vault where attribution is otherwise working,
   * are almost always the ones the person wrote by hand — and handing those
   * back is what made the whole screen read as a mirror.
   */
  if (attributionWorking && !agent) score *= 0.3;
  else if (agent) reasons.unshift(`by ${agent}`);

  /*
   * The repeat penalty — the part that does not need a hook installed.
   *
   * Authorship was the wrong lever to reach for first: it only works where the
   * Claude Code hook is recording, and on the machine this was built for it was
   * not. "Have I already been told this" is observable by Lore alone, on day
   * one, and it is the thing that actually makes a brief feel like a mirror.
   */
  score *= seenPenalty(seen, page.id, event.at);

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
  /*
   * Group at whichever path depth actually forms a group.
   *
   * Two previous versions each worked on one corpus and failed on the other.
   * `slice(0, 2)` made every `concepts/foo.md` its own group, so pages in the
   * same folder never grouped. Its replacement used the containing folder,
   * which is right for `stack/` and produces nothing at all on a wiki where
   * every client has a folder of their own — `clients/conversations/acme/` had
   * one changed page, so did the other fifteen, and no group ever reached
   * three. The screen shipped with zero threads on real data and typechecked
   * perfectly.
   *
   * The subject is not at a fixed depth, because it is not the same thing on
   * every wiki. So: try every depth, take the DEEPEST that forms a group, and
   * do not let one item belong to two — the most specific true grouping is the
   * most informative one, and "acme" beats "clients" whenever both hold.
   */
  const maxDepth = items.reduce(
    (max, item) => Math.max(max, item.relPath.split("/").length - 1),
    0,
  );

  const claimed = new Set<string>();
  const out: { subject: string; pages: string[]; titles: string[] }[] = [];

  for (let depth = maxDepth; depth >= 1; depth--) {
    const byPrefix = new Map<string, { pages: string[]; titles: string[] }>();
    for (const item of items) {
      if (claimed.has(item.pageId)) continue;
      const parts = item.relPath.split("/");
      if (parts.length - 1 < depth) continue;
      const prefix = parts.slice(0, depth).join("/");
      const entry = byPrefix.get(prefix) ?? { pages: [], titles: [] };
      entry.pages.push(item.pageId);
      entry.titles.push(item.title);
      byPrefix.set(prefix, entry);
    }

    for (const [prefix, value] of [...byPrefix.entries()].sort(
      (a, b) => b[1].pages.length - a[1].pages.length,
    )) {
      if (value.pages.length < minPages) continue;
      for (const id of value.pages) claimed.add(id);
      out.push({
        subject: prefix.split("/").pop() ?? prefix,
        pages: value.pages.slice(0, 12),
        titles: value.titles.slice(0, 12),
      });
    }
  }

  return out.sort((a, b) => b.pages.length - a.pages.length).slice(0, 4);
}

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
  /*
   * Extract a sentence, not a collage.
   *
   * The old version stripped heading markers but KEPT the heading text and
   * joined every line into one string, so a client profile opened with
   * "boat-rehab-tv - Chattanooga Fiberglass / Boat Rehab TV Who they are
   * Owner/operator of…" — the page title, a section label and half a bullet
   * fused into one unreadable run, then sliced mid-word at 177 characters.
   * Nine of nine blind reviewers flagged it, because it is the first text on
   * the app's first screen.
   *
   * Rules, in order of what they fix:
   *  - a heading is a label, not prose: dropped entirely, never merged
   *  - lines are candidates individually, never joined across breaks
   *  - prose beats fields: prefer a line that reads like a sentence; fall
   *    back to the first informative "Label: value" line only when the text
   *    has no prose at all
   *  - never cut mid-word: long lines end at a word boundary
   */
  const lines = evidence
    .split("\n")
    .map((raw) => ({
      heading: /^\s{0,3}#{1,6}\s+/.test(raw),
      text: unmark(
        raw
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          .replace(/^[-*+]\s+/, "")
          .replace(/^\d+\.\s+/, "")
          .trim(),
      ),
    }))
    .filter((l) => l.text.length > 0);

  const isField = (text: string) => /^[\w][\w /()&'-]{0,32}:\s*\S/.test(text);
  const isProse = (text: string) =>
    !isField(text) &&
    (/[.!?]["')\]]?\s*$/.test(text) || text.split(/\s+/).length >= 8) &&
    // A slash-and-dash title echo ("name - Company / Channel") is not a
    // sentence however long it is.
    !/^[\w.-]+\s+[-–—]\s/.test(text);

  const source =
    lines.find((l) => !l.heading && isProse(l.text)) ??
    lines.find((l) => !l.heading && isField(l.text) && l.text.length > 12) ??
    lines.find((l) => !l.heading);

  if (!source) return "Changed, but the page has no readable body.";

  const sentence = (source.text.split(/(?<=[.!?])\s+/)[0] ?? source.text).trim();
  if (sentence.length <= 180) return sentence;
  const cut = sentence.slice(0, 177);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/**
 * Flatten the markdown a fallback line inherits from the page.
 *
 * The brief renders as plain text — the model-written lines are prose and have
 * no markup in them — so a fallback line taken verbatim from a page arrived on
 * screen as `[jmcartan](jmcartan/profile.md) - **Jared McArtan…**`. That is the
 * one line on the screen that looks broken, and it is the line shown when the
 * feature is least able to impress anyone.
 *
 * Links become their text, emphasis and code markers are dropped, images are
 * removed entirely. Not a markdown parser: this runs on one sentence and only
 * needs to handle the constructs that appear at the start of a page.
 */
function unmark(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => alias || target)
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^>\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
/** The pages that cite this one, capped — a hub with 200 backlinks is noise. */
function affectedBy(index: WikiIndex, pageId: string): { pageId: string; title: string }[] {
  const inbound = index.backlinks[pageId] ?? [];
  if (!inbound.length || inbound.length > 12) return [];
  return inbound
    .map((id) => index.pages.find((p) => p.id === id))
    .filter((p): p is WikiPage => Boolean(p))
    .slice(0, 4)
    .map((p) => ({ pageId: p.id, title: p.title }));
}

export function buildBrief(
  index: WikiIndex,
  events: WriteEvent[],
  since: number,
  limit = 8,
  agentByPath: Record<string, { agent: string } | undefined> = {},
  seen: Seen = {},
  /** Skip this many ranked items — the cursor for scrolling further back. */
  offset = 0,
): Brief {
  const collapsed = collapseEvents(withoutRenames(events));
  const byId = new Map(index.pages.map((p) => [p.relPath, p]));
  // Is the Claude Code hook actually recording anything this window?
  const attributionWorking = Object.keys(agentByPath).length > 0;

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
        repeat: false,
        // A deleted page's backlinks are now dead links, which is exactly
        // the thing worth naming.
        affects: affectedBy(index, relPath.replace(/\.mdx?$/i, "")),
        agent: agentByPath[relPath]?.agent ?? null,
        evidence: "",
      });
      continue;
    }
    const inbound = index.backlinks[page.id]?.length ?? 0;
    const { score, reason } = scoreForBrief(
      event,
      page,
      inbound,
      agentByPath[relPath]?.agent ?? null,
      attributionWorking,
      seen,
    );
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
      repeat: Boolean(seen[page.id]) && event.at <= (seen[page.id] ?? 0) + 60_000,
      affects: affectedBy(index, page.id),
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
  // The diversity cap applies to the whole window being paged through, not to
      // each page of it — otherwise page two re-applies the cap to what is left
      // and the spread collapses.
  const window = limit + offset;
  const perFolder = Math.max(2, Math.ceil(window / 3));
  const taken = new Map<string, number>();
  const items: BriefItem[] = [];
  for (const pass of [0, 1]) {
    for (const item of scored) {
      if (items.length >= window) break;
      if (items.includes(item)) continue;
      const folder = dirOf(item.relPath);
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
    items: items.slice(offset),
    fresh: items.slice(offset).filter((i) => !i.repeat).length,
    /** More ranked items exist beyond this page. */
    hasMore: scored.length > window,
    total: scored.length,
    threads: groupItems(findThreads(scored.slice(0, 40)), items.slice(offset)),
    synthesised: false,
  };
}

/**
 * Attach the shown rows to the thread they belong to.
 *
 * A thread with one visible row is not a thread — it is a row with a label — so
 * those are dropped and their items fall through to the ungrouped list. Nothing
 * is duplicated: a row appears under a thread or on its own, never both.
 */
function groupItems(
  threads: { subject: string; pages: string[]; titles: string[] }[],
  items: BriefItem[],
): Brief["threads"] {
  const claimed = new Set<string>();
  const out: Brief["threads"] = [];

  for (const thread of threads) {
    const belonging = items.filter(
      (item) => thread.pages.includes(item.pageId) && !claimed.has(item.pageId),
    );
    if (belonging.length < 2) continue;
    for (const item of belonging) claimed.add(item.pageId);
    out.push({ ...thread, items: belonging });
  }
  return out;
}

/** Items not claimed by any thread, in their original ranked order. */
export function ungrouped(brief: Brief): BriefItem[] {
  const claimed = new Set(
    brief.threads.flatMap((t) => (t.items ?? []).map((i) => i.pageId)),
  );
  return brief.items.filter((item) => !claimed.has(item.pageId));
}

/** Rough cost of briefing, so the caller can keep the model call bounded. */
export function briefTokens(brief: Brief): number {
  return brief.items.reduce((sum, item) => sum + countTokens(item.evidence), 0);
}
