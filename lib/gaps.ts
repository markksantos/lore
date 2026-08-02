import { jaccardOf } from "@/lib/utils";
import type { UsageEvent } from "@/lib/usage";

/**
 * What your agents looked for and did not find.
 *
 * The raw miss list is already collected, and on its own it is close to
 * useless: "stripe webhook", "stripe webhooks", "how do stripe webhooks work"
 * are three rows that look like three problems and are one missing page.
 *
 * Clustering turns a log into a work queue. The output is ordered by how many
 * distinct times someone hit the same wall, which is the closest thing available
 * to a measure of what the wiki most needs written next.
 */

const STOP = new Set([
  "the","a","an","of","to","in","for","on","and","or","is","are","was","were","how","what",
  "why","when","where","do","does","did","with","from","by","at","it","its","this","that",
  "i","we","you","my","our","your","me","us","can","should","would","could","about","get",
  "set","use","using","need","want","find","show","tell","any","all","some","there","here",
]);

const tokenize = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    // Crude singularisation. A stemmer would be more correct and would also
    // mean shipping one; "webhooks" and "webhook" is the case that actually
    // occurs, and this catches it.
    .map((w) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.replace(/s$/, "")));

export type GapCluster = {
  /** The clearest phrasing anyone actually used, not a synthesised label. */
  label: string;
  terms: string[];
  queries: { query: string; count: number }[];
  misses: number;
  /** Distinct agents that hit this wall. Two is a much stronger signal than one. */
  agents: string[];
  lastAsked: number;
};

/** Jaccard over the token sets. Cheap, and the sets are three or four words. */

/**
 * Single-link agglomeration at a fixed threshold.
 *
 * Chosen over k-means or anything requiring a model because the input is a few
 * hundred short strings and the whole feature has to run instantly, offline, on
 * a laptop. 0.4 was set by hand against real miss logs: lower merges unrelated
 * topics that share one common word, higher leaves obvious duplicates apart.
 */
const THRESHOLD = 0.4;

export function clusterGaps(events: UsageEvent[], limit = 20): GapCluster[] {
  const misses = events.filter(
    (e): e is Extract<UsageEvent, { t: "search" }> => e.t === "search" && e.hits === 0,
  );
  if (!misses.length) return [];

  type Seed = { query: string; terms: Set<string>; count: number; agents: Set<string>; at: number };
  const byQuery = new Map<string, Seed>();
  for (const m of misses) {
    const key = m.query.trim().toLowerCase();
    if (!key) continue;
    const seed = byQuery.get(key);
    if (seed) {
      seed.count += 1;
      seed.agents.add(m.agent);
      seed.at = Math.max(seed.at, m.at);
    } else {
      byQuery.set(key, {
        query: m.query.trim(),
        terms: new Set(tokenize(m.query)),
        count: 1,
        agents: new Set([m.agent]),
        at: m.at,
      });
    }
  }

  const seeds = [...byQuery.values()]
    .filter((s) => s.terms.size > 0)
    .sort((a, b) => b.count - a.count);

  const clusters: { seeds: Seed[]; terms: Set<string> }[] = [];
  for (const seed of seeds) {
    const hit = clusters.find((c) => jaccardOf(c.terms, seed.terms) >= THRESHOLD);
    if (hit) {
      hit.seeds.push(seed);
      for (const t of seed.terms) hit.terms.add(t);
    } else {
      clusters.push({ seeds: [seed], terms: new Set(seed.terms) });
    }
  }

  return clusters
    .map((c) => {
      const agents = new Set<string>();
      for (const s of c.seeds) for (const a of s.agents) agents.add(a);
      const queries = c.seeds
        .map((s) => ({ query: s.query, count: s.count }))
        .sort((a, b) => b.count - a.count);
      return {
        // The most-repeated phrasing is the label: it is what a human actually
        // typed, so it reads better than any tokens joined back together.
        label: queries[0].query,
        terms: [...c.terms].slice(0, 6),
        queries,
        misses: c.seeds.reduce((n, s) => n + s.count, 0),
        agents: [...agents],
        lastAsked: Math.max(...c.seeds.map((s) => s.at)),
      };
    })
    .sort((a, b) => b.misses - a.misses || b.lastAsked - a.lastAsked)
    .slice(0, limit);
}

// ------------------------------------------------------------------ scorecard

export type AgentScore = {
  agent: string;
  reads: number;
  searches: number;
  misses: number;
  /** Share of this agent's searches that found nothing. */
  missRate: number;
  pagesTouched: number;
  lastSeen: number;
};

/**
 * Per-agent behaviour.
 *
 * Two agents against the same wiki behave very differently, and until you can
 * see that you cannot tell a bad wiki from a badly-configured client. An agent
 * with a 60% miss rate is usually searching for things by the wrong name, which
 * is a fixable problem — but it looks identical to "the wiki is missing content"
 * from the aggregate report.
 */
export function scoreAgents(events: UsageEvent[]): AgentScore[] {
  const map = new Map<string, AgentScore & { pages: Set<string> }>();

  const get = (agent: string) => {
    let row = map.get(agent);
    if (!row) {
      row = {
        agent,
        reads: 0,
        searches: 0,
        misses: 0,
        missRate: 0,
        pagesTouched: 0,
        lastSeen: 0,
        pages: new Set<string>(),
      };
      map.set(agent, row);
    }
    return row;
  };

  for (const e of events) {
    const row = get(e.agent || "unknown");
    row.lastSeen = Math.max(row.lastSeen, e.at);
    if (e.t === "read") {
      row.reads += 1;
      row.pages.add(e.page);
    } else if (e.t === "search") {
      row.searches += 1;
      if (e.hits === 0) row.misses += 1;
    }
  }

  return [...map.values()]
    .map(({ pages, ...row }) => ({
      ...row,
      pagesTouched: pages.size,
      missRate: row.searches ? Math.round((row.misses / row.searches) * 100) : 0,
    }))
    .sort((a, b) => b.reads + b.searches - (a.reads + a.searches));
}
