import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The usage log — the thing only Lore can produce.
 *
 * Lore sits in the MCP path between your agents and your wiki. That position is
 * worthless as a *gate* (a plain folder has a hundred other write paths), but it
 * is uniquely valuable as a *sensor*: every question an agent asks of the wiki
 * passes through here.
 *
 * Two signals matter, and neither exists anywhere else:
 *
 *   READS  — which pages actually get opened. On a 1,400-page wiki most pages
 *            are never read again after they are written. Knowing which ones
 *            carry the weight tells you what to keep sharp.
 *   MISSES — searches that returned nothing useful. Each one is a question your
 *            wiki could not answer, which is a page you should write. A to-do
 *            list generated from real demand instead of guesswork.
 *
 * Append-only JSONL outside the vault, so it never shows up in a `git diff` of
 * the user's notes and a corrupt line can never take the log with it.
 */

const DIR = path.join(os.homedir(), ".lore");
const FILE = path.join(DIR, "usage.jsonl");

/** Keep the log bounded; a year of heavy use stays well under this. */
const MAX_EVENTS = 50_000;

export type UsageEvent =
  | { t: "read"; at: number; agent: string; vault: string; page: string }
  | { t: "search"; at: number; agent: string; vault: string; query: string; hits: number }
  | { t: "index"; at: number; agent: string; vault: string; pages: number; tokens: number }
  | { t: "health"; at: number; agent: string; vault: string };

export async function record(event: UsageEvent): Promise<void> {
  try {
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    await fs.appendFile(FILE, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // Telemetry must never break the request it is observing. If the log can't
    // be written the tool call still has to succeed.
  }
}

export async function readEvents(vault?: string): Promise<UsageEvent[]> {
  const raw = await fs.readFile(FILE, "utf8").catch(() => "");
  if (!raw) return [];

  const events: UsageEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as UsageEvent;
      if (!vault || parsed.vault === vault) events.push(parsed);
    } catch {
      // A half-written final line is expected if the process died mid-append.
      // Skipping it is correct; failing the whole read is not.
    }
  }

  if (events.length > MAX_EVENTS) {
    const trimmed = events.slice(-MAX_EVENTS);
    await fs
      .writeFile(FILE, trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8")
      .catch(() => {});
    return trimmed;
  }
  return events;
}

// ------------------------------------------------------------------- reports

export type PageUsage = {
  page: string;
  reads: number;
  lastRead: number;
  agents: string[];
};

export type Gap = {
  query: string;
  misses: number;
  lastAsked: number;
  agents: string[];
};

export type UsageReport = {
  since: number;
  totalReads: number;
  totalSearches: number;
  missRate: number;
  /** Most-read pages first — what your wiki is actually for. */
  hot: PageUsage[];
  /**
   * Pages in the vault that have never been read by any agent. Dead weight
   * until proven otherwise, and the first place to look when the index gets
   * too big to hand over.
   */
  coldCount: number;
  cold: string[];
  /** Searches that found nothing. Each is a page worth writing. */
  gaps: Gap[];
  /** Reads per day, oldest first, for a sparkline. */
  daily: { day: string; reads: number; searches: number }[];
  agents: { agent: string; events: number }[];
};

/**
 * A search is a "miss" when it returns nothing at all. We deliberately do not
 * count low-hit searches as misses: a one-result search that answered the
 * question is a success, and treating it as a near-miss would bury the real
 * gaps under noise.
 */
const isMiss = (e: UsageEvent) => e.t === "search" && e.hits === 0;

export function buildReport(
  events: UsageEvent[],
  allPageIds: string[],
  windowDays = 30,
): UsageReport {
  const since = Date.now() - windowDays * 86_400_000;
  const recent = events.filter((e) => e.at >= since);

  const reads = recent.filter((e): e is Extract<UsageEvent, { t: "read" }> => e.t === "read");
  const searches = recent.filter(
    (e): e is Extract<UsageEvent, { t: "search" }> => e.t === "search",
  );

  const byPage = new Map<string, PageUsage>();
  for (const e of reads) {
    const entry = byPage.get(e.page) ?? { page: e.page, reads: 0, lastRead: 0, agents: [] };
    entry.reads += 1;
    entry.lastRead = Math.max(entry.lastRead, e.at);
    if (!entry.agents.includes(e.agent)) entry.agents.push(e.agent);
    byPage.set(e.page, entry);
  }

  const byQuery = new Map<string, Gap>();
  for (const e of searches) {
    if (!isMiss(e)) continue;
    // Normalise so "Pricing" and "pricing " collapse into one gap.
    const key = e.query.trim().toLowerCase();
    if (!key) continue;
    const entry = byQuery.get(key) ?? { query: key, misses: 0, lastAsked: 0, agents: [] };
    entry.misses += 1;
    entry.lastAsked = Math.max(entry.lastAsked, e.at);
    if (!entry.agents.includes(e.agent)) entry.agents.push(e.agent);
    byQuery.set(key, entry);
  }

  const readIds = new Set(byPage.keys());
  const cold = allPageIds.filter((id) => !readIds.has(id));

  const dayMap = new Map<string, { reads: number; searches: number }>();
  for (const e of recent) {
    if (e.t !== "read" && e.t !== "search") continue;
    const day = new Date(e.at).toISOString().slice(0, 10);
    const entry = dayMap.get(day) ?? { reads: 0, searches: 0 };
    if (e.t === "read") entry.reads += 1;
    else entry.searches += 1;
    dayMap.set(day, entry);
  }

  const agentMap = new Map<string, number>();
  for (const e of recent) agentMap.set(e.agent, (agentMap.get(e.agent) ?? 0) + 1);

  return {
    since,
    totalReads: reads.length,
    totalSearches: searches.length,
    missRate: searches.length ? searches.filter(isMiss).length / searches.length : 0,
    hot: [...byPage.values()].sort((a, b) => b.reads - a.reads || b.lastRead - a.lastRead),
    coldCount: cold.length,
    cold: cold.slice(0, 200),
    gaps: [...byQuery.values()].sort((a, b) => b.misses - a.misses || b.lastAsked - a.lastAsked),
    daily: [...dayMap.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    agents: [...agentMap.entries()]
      .map(([agent, events]) => ({ agent, events }))
      .sort((a, b) => b.events - a.events),
  };
}
