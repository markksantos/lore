"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Flame, HelpCircle, Gauge, Copy, Check, Users, Target } from "lucide-react";
import { paletteVars } from "@/lib/palette";
import { formatTokens } from "@/lib/tokens";
import { cn, count, formatCount, relativeTime } from "@/lib/utils";

type UsageReport = {
  totalReads: number;
  totalSearches: number;
  missRate: number;
  hot: { page: string; reads: number; lastRead: number; agents: string[] }[];
  coldCount: number;
  cold: string[];
  gaps: { query: string; misses: number; lastAsked: number; agents: string[] }[];
  daily: { day: string; reads: number; searches: number }[];
  agents: { agent: string; events: number }[];
  receipts: {
    agent: string;
    human: boolean;
    reads: number;
    searches: number;
    writes: number;
    context: number;
    briefs: number;
    tokens: number;
    lastAt: number;
  }[];
  agentEvents: number;
  lastAgentAt: number;
  agentSilentDays: number;
};

type BudgetReport = {
  totalPages: number;
  totalTokens: number;
  indexTokens: number;
  folders: {
    folder: string;
    pages: number;
    tokens: number;
    heaviest: { id: string; title: string; tokens: number }[];
  }[];
  outliers: { id: string; title: string; folder: string; tokens: number }[];
};

const WINDOW = 200_000;

/**
 * Insights — the two reports only Lore can produce, plus the one number that
 * governs how a wiki should be built for agents.
 *
 * Everything here comes from Lore sitting in the MCP path. That position is
 * useless as a gate but unique as a vantage point: nothing else sees which
 * pages your agents actually open, or which questions they asked that your
 * wiki could not answer.
 */
export function InsightsView({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [budget, setBudget] = useState<BudgetReport | null>(null);
  /**
   * Whether agent telemetry exists on this host at all.
   *
   * `usage` being null meant two different things — still loading, and never
   * coming — and the render guard treated both as loading. In the browser build,
   * where the MCP server does not exist, that spun a loader forever on a screen
   * whose other half was perfectly computable. Null is now only "loading".
   */
  const [noUsage, setNoUsage] = useState(false);
  const [copied, setCopied] = useState(false);

  /*
   * The spinner guard below waits on /api/budget, and /api/budget with no
   * timeout on a starved server is how this screen spent a nine-reviewer
   * panel as a blank page. Twelve seconds, then an error card with a retry.
   */
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetch("/api/usage", { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then(setUsage)
      .catch(() => setNoUsage(true));
    fetch("/api/budget", { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then(setBudget)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The gap list as a prompt. We do not write the missing pages ourselves —
   * Claude is better at that than we would be. We hand over the evidence.
   */
  const gapPrompt = useMemo(() => {
    if (!usage?.gaps.length) return "";
    return [
      "These are questions my agents asked my wiki that returned nothing.",
      "Each one is a page I should probably write. Draft them, ask me before",
      "guessing at anything you don't know:",
      "",
      ...usage.gaps.slice(0, 20).map((g) => `- "${g.query}" (asked ${g.misses}x)`),
    ].join("\n");
  }, [usage]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-sm rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4 text-center">
          <p className="text-[14px] text-[var(--lore-text-primary)]">
            This screen could not load in time.
          </p>
          <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
            The server may be busy answering a question. It usually clears in seconds.
          </p>
          <button
            type="button"
            onClick={load}
            className="t-meta mt-3 rounded-lg border border-[var(--lore-border)] px-3 py-1.5 text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!budget || (!usage && !noUsage)) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const windowsNeeded = Math.ceil(budget.totalTokens / WINDOW);
  const maxDaily = Math.max(1, ...(usage?.daily ?? []).map((d) => d.reads + d.searches));

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Insights
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          What your agents read, what they asked for and could not find, and what it costs
          to hand any of it over.
        </p>
      </header>

      {/* ---------------------------------------------------------- receipts */}
      {usage ? <Receipts usage={usage} /> : null}

      {/* --------------------------------------------------------- retrieval */}
      <Retrieval />

      {/* ------------------------------------------------------------ budget */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <Gauge size={16} className="text-[var(--lore-text-tertiary)]" />
          Context budget
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          Measured with a real tokenizer, not a chars-over-four estimate — markdown
          tokenizes far worse than prose, and being told a folder fits when it does not is
          the one failure this exists to prevent.
        </p>

        <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
          <div style={paletteVars(0)} className="plate px-4 py-3.5">
            <div className="text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {formatTokens(budget.totalTokens)}
            </div>
            <div className="plate-muted mt-2 text-[12px] font-semibold">tokens, whole wiki</div>
          </div>
          <div style={paletteVars(2)} className="plate px-4 py-3.5">
            <div className="text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {windowsNeeded}×
            </div>
            <div className="plate-muted mt-2 text-[12px] font-semibold">
              200k windows to read it all
            </div>
          </div>
          <div style={paletteVars(3)} className="plate px-4 py-3.5">
            <div className="text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {formatTokens(budget.indexTokens)}
            </div>
            <div className="plate-muted mt-2 text-[12px] font-semibold">
              the map an agent reads first
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          {budget.folders.slice(0, 10).map((f, i) => {
            const pct = (f.tokens / budget.totalTokens) * 100;
            const fits = f.tokens <= WINDOW;
            return (
              <div key={f.folder || "__root"} style={paletteVars(i)} className="group">
                <div className="flex items-center gap-2.5">
                  <span className="pal-dot" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
                    {f.folder || "Root"}
                  </span>
                  <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                    {count(f.pages, "page")}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[12.5px] font-semibold tabular-nums",
                      fits ? "text-[var(--lore-text-secondary)]" : "text-[var(--lore-danger)]",
                    )}
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                    title={fits ? "Fits in one 200k window" : "Too large for a 200k window"}
                  >
                    {formatTokens(f.tokens)}
                  </span>
                </div>
                <div className="ml-[1.1rem] mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(1, pct)}%`, background: "var(--plate)" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* -------------------------------------------------------------- gaps */}
      <section className="mt-10">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            <HelpCircle size={16} className="text-[var(--lore-text-tertiary)]" />
            Gaps
          </h2>
          <span className="flex-1" />
          {usage && usage.gaps.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(gapPrompt);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              {copied ? <Check size={12} className="text-[var(--lore-success)]" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy as prompt"}
            </button>
          ) : null}
        </div>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          Searches that returned nothing. Each one is a question your wiki failed to
          answer — a to-write list built from real demand instead of guesswork.
          {usage && usage.totalSearches > 0
            ? ` ${Math.round(usage.missRate * 100)}% of searches missed.`
            : ""}
        </p>

        {!usage || usage.gaps.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-8 text-center text-[13px] text-[var(--lore-text-tertiary)]">
            {noUsage
              ? "What your agents searched for is recorded by the MCP server on your machine, so a browser tab cannot see it. The desktop app fills this in."
              : "No misses recorded yet. Connect an agent over MCP and this fills itself."}
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
            {(usage?.gaps ?? []).slice(0, 20).map((gap) => (
              <div key={gap.query} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
                  “{gap.query}”
                </span>
                <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                  {gap.agents.join(", ")}
                </span>
                <span className="t-meta shrink-0 tabular-nums text-[var(--lore-text-tertiary)]">
                  ×{gap.misses}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --------------------------------------------------------------- hot */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <Flame size={16} className="text-[var(--lore-text-tertiary)]" />
          What carries the weight
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          {usage
            ? `${count(usage.totalReads, "read")} and ${count(usage.totalSearches, "search", "searches")} in the last 30 days.`
            : "Which pages your agents actually open is recorded by the MCP server, which runs on your machine."}{" "}
          {usage && usage.coldCount > 0
            ? `${count(usage.coldCount, "page")} ${usage.coldCount === 1 ? "has" : "have"} never been opened by an agent — dead weight in the index until proven otherwise.`
            : ""}
        </p>

        {usage && usage.daily.length > 1 ? (
          <div className="mt-3 flex h-16 items-end gap-[3px]">
            {usage.daily.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${d.reads} reads, ${d.searches} searches`}
                className="flex-1 rounded-t bg-[var(--lore-accent)]/70"
                style={{ height: `${((d.reads + d.searches) / maxDaily) * 100}%` }}
              />
            ))}
          </div>
        ) : null}

        {!usage || usage.hot.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-8 text-center text-[13px] text-[var(--lore-text-tertiary)]">
            {noUsage
              ? "Reads are counted by the MCP server on your machine. Open your wiki in the desktop app to see which pages your agents actually use."
              : "No reads recorded yet."}
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
            {usage.hot.slice(0, 15).map((h) => (
              <button
                key={h.page}
                type="button"
                onClick={() => onOpenPage(h.page)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
                  {h.page}
                </span>
                <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                  {relativeTime(h.lastRead)}
                </span>
                <span className="t-meta shrink-0 tabular-nums text-[var(--lore-text-secondary)]">
                  {h.reads} reads
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Who is actually using this wiki.
 *
 * The number that produced this panel: over five days the usage log held 197
 * calls, 193 of them the human clicking Ask and 3 an actual agent. Lore was
 * being used as a reader by one person, and the loop it exists for had run
 * three times — a fact that required a shell script to discover, which means
 * nobody would ever have discovered it.
 *
 * So it is the first thing on the screen, and the human is held apart from the
 * agents. Counting Ask as a caller would make the only question that matters —
 * is anything other than me using this — always answer yes.
 */
function Receipts({ usage }: { usage: UsageReport }) {
  const agents = usage.receipts.filter((r) => !r.human);
  const humans = usage.receipts.filter((r) => r.human);
  const humanEvents = humans.reduce(
    (sum, r) => sum + r.reads + r.searches + r.writes + r.context + r.briefs,
    0,
  );

  return (
    <section>
      <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        <Users size={16} className="text-[var(--lore-text-tertiary)]" />
        Who is using the wiki
      </h2>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
        Every call your agents make, split by what they asked for. Reading is the
        point; writing without reading is a wiki filling up rather than being used.
      </p>

      {/*
        * The silence banner.
        *
        * A wiki nothing reads is not a wiki, and Lore is the only thing in a
        * position to notice. Stated as a fact with the fix attached, because
        * "0 agent calls" on its own reads as a broken chart rather than a
        * disconnected setup.
        */}
      {usage.agentSilentDays === -1 || usage.agentSilentDays >= 3 ? (
        <div className="mt-3.5 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5">
          <p className="text-[13.5px] leading-relaxed text-[var(--lore-text-primary)]">
            {usage.agentSilentDays === -1
              ? "No agent has ever read this wiki."
              : `No agent has read this wiki in ${count(usage.agentSilentDays, "day")}.`}{" "}
            <span className="text-[var(--lore-text-secondary)]">
              You have made {count(humanEvents, "call")} yourself in the same window.
            </span>
          </p>
          <p className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]">
            Run <code className="rounded bg-[var(--lore-surface-raised)] px-1 py-px">lore install</code>{" "}
            to wire Lore into every agent on this machine at once — MCP config, the skill,
            and the session hooks that open with the brief and close by recording what
            changed. Connections has the same buttons.
          </p>
        </div>
      ) : null}

      {agents.length ? (
        <div className="mt-3.5 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead>
              <tr className="t-meta text-[var(--lore-text-tertiary)]">
                <th className="pb-2 pr-3 font-medium">Agent</th>
                <th className="pb-2 pr-3 text-right font-medium">Context</th>
                <th className="pb-2 pr-3 text-right font-medium">Reads</th>
                <th className="pb-2 pr-3 text-right font-medium">Searches</th>
                <th className="pb-2 pr-3 text-right font-medium">Writes</th>
                <th className="pb-2 text-right font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody className="text-[13.5px] text-[var(--lore-text-primary)]">
              {[...agents, ...humans].map((r) => (
                <tr key={r.agent} className="border-t border-[var(--lore-border)]">
                  <td className="py-2 pr-3">
                    {r.agent}
                    {r.human ? (
                      <span className="t-meta ml-1.5 text-[var(--lore-text-tertiary)]">you</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.context || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.reads || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.searches || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.writes || "—"}</td>
                  <td className="t-meta py-2 text-right text-[var(--lore-text-tertiary)]">
                    {relativeTime(r.lastAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

type GoldenState = {
  cases: { id: string; question: string; pageId: string; why?: string }[];
  history: { at: number; recallAt1: number; recallAt5: number; missed: number; cases: number }[];
};

/**
 * Retrieval, measured against questions whose answers were written down first.
 *
 * Every other number in this app describes the wiki. This one describes Lore:
 * given a question a human already knows the answer to, does the ranker return
 * the right page. It is the only number that can say a change made retrieval
 * worse, and it exists because twice during this project a ranking change was
 * judged by a score that had moved for the wrong reason — the synthetic harness
 * writes fresh questions every run, so an easier set reads as a better ranker.
 */
function Retrieval() {
  const [state, setState] = useState<GoldenState | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/golden")
      .then((r) => (r.ok ? r.json() : null))
      .then(setState)
      .catch(() => setState(null));
  }, []);

  const run = async () => {
    setRunning(true);
    await fetch("/api/golden", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    }).catch(() => null);
    const fresh = await fetch("/api/golden")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (fresh) setState(fresh);
    setRunning(false);
  };

  if (!state) return null;

  const history = state.history ?? [];
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  const delta = latest && previous ? latest.recallAt1 - previous.recallAt1 : 0;

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        <Target size={16} className="text-[var(--lore-text-tertiary)]" />
        Retrieval
      </h2>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
        {state.cases.length
          ? `${count(state.cases.length, "question")} whose correct page you have already named. Re-run after any change to see whether it helped.`
          : "No questions yet. Ask something, confirm the top source was right, and save it here — that is what makes a future regression visible."}
      </p>

      {latest ? (
        <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
          <div style={paletteVars(1)} className="plate px-4 py-3.5">
            <div className="text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {Math.round(latest.recallAt1 * 100)}%
            </div>
            <div className="plate-muted mt-2 text-[12px] font-semibold">
              right page first
              {delta !== 0 ? (
                <span className={delta > 0 ? "" : " text-[var(--lore-danger)]"}>
                  {" "}
                  ({delta > 0 ? "+" : ""}
                  {Math.round(delta * 100)})
                </span>
              ) : null}
            </div>
          </div>
          <div style={paletteVars(4)} className="plate px-4 py-3.5">
            <div className="text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {Math.round(latest.recallAt5 * 100)}%
            </div>
            <div className="plate-muted mt-2 text-[12px] font-semibold">in the top five</div>
          </div>
          <div style={paletteVars(5)} className="plate px-4 py-3.5">
            <div className="text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {latest.missed}
            </div>
            <div className="plate-muted mt-2 text-[12px] font-semibold">never found at all</div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={run}
        disabled={running || !state.cases.length}
        className="t-meta mt-3 rounded-lg border border-[var(--lore-border)] px-3 py-1.5 text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-40"
      >
        {running ? "Running…" : "Run the set"}
      </button>
    </section>
  );
}
