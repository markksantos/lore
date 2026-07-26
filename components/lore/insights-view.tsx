"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Flame, HelpCircle, Gauge, Copy, Check } from "lucide-react";
import { paletteVars } from "@/lib/palette";
import { formatTokens } from "@/lib/tokens";
import { cn, formatCount, relativeTime } from "@/lib/utils";

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsage)
      .catch(() => setUsage(null));
    fetch("/api/budget")
      .then((r) => (r.ok ? r.json() : null))
      .then(setBudget)
      .catch(() => setBudget(null));
  }, []);

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

  if (!usage || !budget) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const windowsNeeded = Math.ceil(budget.totalTokens / WINDOW);
  const maxDaily = Math.max(1, ...usage.daily.map((d) => d.reads + d.searches));

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

      {/* ------------------------------------------------------------ budget */}
      <section>
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
                    {formatCount(f.pages)} pages
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
          {usage.gaps.length > 0 ? (
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
          {usage.totalSearches > 0
            ? ` ${Math.round(usage.missRate * 100)}% of searches missed.`
            : ""}
        </p>

        {usage.gaps.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-8 text-center text-[13px] text-[var(--lore-text-tertiary)]">
            No misses recorded yet. Connect an agent over MCP and this fills itself.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
            {usage.gaps.slice(0, 20).map((gap) => (
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
          {formatCount(usage.totalReads)} reads and {formatCount(usage.totalSearches)}{" "}
          searches in the last 30 days.{" "}
          {usage.coldCount > 0
            ? `${formatCount(usage.coldCount)} pages have never been opened by an agent — dead weight in the index until proven otherwise.`
            : ""}
        </p>

        {usage.daily.length > 1 ? (
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

        {usage.hot.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-8 text-center text-[13px] text-[var(--lore-text-tertiary)]">
            No reads recorded yet.
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
