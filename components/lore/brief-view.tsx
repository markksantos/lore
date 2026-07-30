"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { cn, count, relativeTime } from "@/lib/utils";

/**
 * The brief — the first thing you see, and on most days the only thing.
 *
 * The screen this replaced opened with "0% of 1,521 pages have ever been
 * checked by a human" above a list of things to sign off. It was a bill. This
 * is the opposite instruction to the same data: here is what your agents
 * learned, in one line each, and there is nothing for you to do about it.
 *
 * Every line is a sentence about what the page now SAYS, not what happened to
 * the file. "deploy-pipeline.md +12 −31" is a changelog entry; "the deploy
 * pipeline moved from nightly to on-push" is news. The whole product lives in
 * that difference.
 */

type Item = {
  pageId: string;
  relPath: string;
  title: string;
  line: string;
  reason: string;
  kind: "created" | "appended" | "rewritten" | "deleted";
  at: number;
  agent: string | null;
};

type Brief = {
  since: number;
  events: number;
  pagesTouched: number;
  items: Item[];
  threads: { subject: string; pages: string[]; titles: string[] }[];
  synthesised: boolean;
};

const WINDOWS = [
  { days: 1, label: "Today" },
  { days: 7, label: "This week" },
  { days: 30, label: "This month" },
];

const KIND_LABEL: Record<Item["kind"], string> = {
  created: "New",
  rewritten: "Rewritten",
  appended: "Added to",
  deleted: "Deleted",
};

export function BriefView({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const [days, setDays] = useState(1);
  const [data, setData] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    setFailed(false);
    const response = await fetch(`/api/brief?days=${window}`).catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setData(await response.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load(days);
  }, [load, days]);

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
            What your agents learned
          </h1>
          <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
            {data && !loading
              ? data.events > 0
                ? `${count(data.events, "write")} across ${count(data.pagesTouched, "page")}. These are the ones worth thirty seconds.`
                : "Nothing written in this window."
              : "Reading the journal…"}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                days === w.days
                  ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
                  : "text-[var(--lore-text-tertiary)] hover:text-[var(--lore-text-primary)]",
              )}
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => load(days)}
            aria-label="Refresh the brief"
            className="ml-1 rounded-lg p-1.5 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </header>

      {failed ? (
        <p className="rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-8 text-center text-[13px] text-[var(--lore-text-tertiary)]">
          Could not read the journal. If Lore just started, give it a moment and refresh.
        </p>
      ) : loading && !data ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-6 text-[13px] text-[var(--lore-text-tertiary)]">
          <Loader2 size={14} className="animate-spin" />
          Reading what changed and summarising it locally…
        </div>
      ) : !data?.items.length ? (
        <p className="rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-10 text-center text-[13px] leading-relaxed text-[var(--lore-text-tertiary)]">
          Nothing changed in this window. Lore only sees writes that happen while it is
          running, so a wiki you linked a minute ago starts empty here and fills as your
          agents work.
        </p>
      ) : (
        <div className="divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
          {data.items.map((item) => (
            <button
              key={item.pageId}
              type="button"
              onClick={() => onOpenPage(item.pageId)}
              className="group flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
            >
              <span className="min-w-0 flex-1">
                {/* The line is the content. Everything else on the row is
                    metadata and is styled to lose to it. */}
                <span className="block text-[14.5px] leading-[1.55] text-[var(--lore-text-primary)]">
                  {item.line}
                </span>
                <span className="t-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--lore-text-tertiary)]">
                  <span className="font-medium text-[var(--lore-text-secondary)]">
                    {KIND_LABEL[item.kind]}
                  </span>
                  <span>·</span>
                  <span className="truncate">{item.title}</span>
                  <span>·</span>
                  <span>{relativeTime(item.at)}</span>
                  {item.agent ? (
                    <>
                      <span>·</span>
                      <span>{item.agent}</span>
                    </>
                  ) : null}
                </span>
              </span>
              <ArrowRight
                size={14}
                className="mt-1 shrink-0 text-[var(--lore-text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
          ))}
        </div>
      )}

      {data?.threads.length ? (
        <p className="t-meta mt-4 text-[var(--lore-text-tertiary)]">
          Most movement in{" "}
          {data.threads.map((t, i) => (
            <span key={t.subject}>
              {i > 0 ? ", " : ""}
              <span className="text-[var(--lore-text-secondary)]">{t.subject}</span> (
              {t.pages.length})
            </span>
          ))}
          .
        </p>
      ) : null}

      {data?.items.length && !data.synthesised ? (
        <p className="t-meta mt-4 flex items-start gap-2 rounded-xl border border-[var(--lore-border)] px-4 py-3 text-[var(--lore-text-tertiary)]">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          These lines are each page&rsquo;s own first sentence. Install a local model with
          Ollama and Lore will write them properly instead — it runs on your machine and
          nothing is sent anywhere.
        </p>
      ) : null}
    </div>
  );
}
