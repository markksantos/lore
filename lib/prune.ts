import type { WikiIndex, WikiPage } from "@/lib/index-core";
import type { UsageEvent } from "@/lib/usage";
import { expiryOf } from "@/lib/page-facts";

/**
 * Which pages have stopped earning their place.
 *
 * A wiki only ever grows. Lore measures the corpus from every angle — orphans,
 * staleness, duplication, token cost — and had no principled way to say "this
 * one can go", so the honest answer to "my index is too big" was to shrug.
 *
 * The principle used here is that a page justifies itself in one of three ways:
 * something reads it, something links to it, or somebody keeps editing it. A
 * page doing none of the three, for months, is not knowledge — it is a file.
 * Usage is the strongest of the three signals and the one nothing else has, so
 * it leads.
 *
 * Nothing here deletes anything. It produces a list with a reason attached to
 * each row, because the person who wrote these pages is the only one who can
 * tell an obsolete note from a note about something that has not come up yet.
 */

export type PruneCandidate = {
  id: string;
  relPath: string;
  title: string;
  words: number;
  ageDays: number;
  reads: number;
  inbound: number;
  /** Plain-language reason this is on the list. */
  reason: string;
  /** 0-1. Higher means safer to archive. */
  confidence: number;
};

/**
 * How old a page must be before its silence means anything — measured from the
 * wiki, not from a constant.
 *
 * A flat 90 days returned nothing at all on the vault this was built against,
 * where agents write seventeen pages a day and no page is older than a season.
 * That is not "this wiki is perfectly pruned", it is a threshold calibrated for
 * somebody else's corpus. Taking the median page age means the bar is always
 * "old for THIS wiki", which is the question actually being asked, and the
 * clamps keep it sane at both extremes: never nag about a page written this
 * fortnight, never wait a year on an archive that has not moved since 2019.
 */
function ageFloor(index: WikiIndex, now: number): number {
  const ages = index.pages
    .map((p) => (now - p.mtime) / 86_400_000)
    .sort((a, b) => a - b);
  if (!ages.length) return 90;
  const median = ages[Math.floor(ages.length / 2)];
  return Math.min(90, Math.max(21, Math.round(median)));
}

export function prunable(
  index: WikiIndex,
  events: UsageEvent[],
  now = Date.now(),
  limit = 100,
): PruneCandidate[] {
  const lastRead = new Map<string, number>();
  const readCount = new Map<string, number>();
  for (const event of events) {
    if (event.t !== "read") continue;
    lastRead.set(event.page, Math.max(lastRead.get(event.page) ?? 0, event.at));
    readCount.set(event.page, (readCount.get(event.page) ?? 0) + 1);
  }

  const out: PruneCandidate[] = [];
  const floor = ageFloor(index, now);
  // Unread for as long as a page has to be old before we look at it at all.
  const unreadDays = floor;

  for (const page of index.pages) {
    const ageDays = Math.floor((now - page.mtime) / 86_400_000);
    if (ageDays < floor) continue;

    const inbound = index.backlinks[page.id]?.length ?? 0;
    const reads = readCount.get(page.id) ?? 0;
    const readAge = lastRead.has(page.id)
      ? Math.floor((now - (lastRead.get(page.id) ?? 0)) / 86_400_000)
      : Infinity;

    const reason = reasonFor(page, { ageDays, inbound, reads, readAge, now, unreadDays });
    if (!reason) continue;

    /*
     * Confidence is additive over independent signals.
     *
     * Any one of them alone is a weak argument — plenty of good pages are
     * unlinked, and a page nobody has read this quarter may be the one you
     * need next quarter. Three of them together is a page that has been
     * invisible to everything for a season.
     */
    let confidence = 0.3;
    if (inbound === 0) confidence += 0.2;
    if (reads === 0) confidence += 0.25;
    if (page.links.length === 0) confidence += 0.1;
    if (ageDays > floor * 3) confidence += 0.15;
    if (page.words < 60) confidence += 0.1;

    out.push({
      id: page.id,
      relPath: page.relPath,
      title: page.title,
      words: page.words,
      ageDays,
      reads,
      inbound,
      reason,
      confidence: Math.min(1, confidence),
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence || b.ageDays - a.ageDays).slice(0, limit);
}

function reasonFor(
  page: WikiPage,
  ctx: {
    ageDays: number;
    inbound: number;
    reads: number;
    readAge: number;
    now: number;
    unreadDays: number;
  },
): string | null {
  const expires = expiryOf(page);
  if (expires !== null && expires <= ctx.now && ctx.inbound === 0) {
    return `Past its own expiry, and nothing links to it.`;
  }
  if (ctx.inbound === 0 && ctx.reads === 0 && page.links.length === 0) {
    return `Nothing links to it, it links nowhere, and no agent has ever read it in ${ctx.ageDays} days.`;
  }
  if (ctx.inbound === 0 && ctx.readAge > ctx.unreadDays && ctx.reads > 0) {
    return `Nothing links to it and nothing has read it in ${ctx.readAge} days.`;
  }
  if (page.words < 40 && ctx.inbound === 0) {
    return `A ${page.words}-word stub nothing points at.`;
  }
  return null;
}

/**
 * What the wiki has a lot of, and what it has none of.
 *
 * "You have 40 pages on clients and none on the pricing decisions behind them"
 * is a sentence somebody can act on. A coverage percentage is not. This
 * compares folder weight against the subjects your agents actually ask about,
 * so the gap named is a gap in what gets used rather than a gap in a taxonomy
 * nobody agreed to.
 */
export type CoverageNote = {
  folder: string;
  pages: number;
  /** Searches that landed in this folder's subject area and found nothing. */
  misses: number;
  note: string;
};

export function coverageNotes(
  index: WikiIndex,
  events: UsageEvent[],
  limit = 8,
): CoverageNote[] {
  const byFolder = new Map<string, number>();
  for (const page of index.pages) {
    const folder = page.folder || "Root";
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }

  // Terms from searches that found nothing, weighted by how often they missed.
  const missTerms = new Map<string, number>();
  for (const event of events) {
    if (event.t !== "search" || event.hits > 0) continue;
    for (const term of event.query.toLowerCase().split(/[^a-z0-9]+/)) {
      if (term.length < 4) continue;
      missTerms.set(term, (missTerms.get(term) ?? 0) + 1);
    }
  }

  const out: CoverageNote[] = [];
  for (const [folder, pages] of byFolder) {
    if (pages < 5) continue;
    const folderTerms = folder.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    const misses = folderTerms.reduce((sum, t) => sum + (missTerms.get(t) ?? 0), 0);
    if (!misses) continue;
    out.push({
      folder,
      pages,
      misses,
      note: `${pages} pages in ${folder}, and ${misses} question${misses === 1 ? "" : "s"} about it that found nothing. The volume is there; the answers are not.`,
    });
  }

  return out.sort((a, b) => b.misses - a.misses).slice(0, limit);
}
