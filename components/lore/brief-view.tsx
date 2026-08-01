"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BellOff, Eye, Loader2, RefreshCw, Sparkles } from "lucide-react";
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
  repeat: boolean;
  /** The passage the line was drawn from, shown on hover so a claim is checkable. */
  evidence?: string;
  affects?: { pageId: string; title: string }[];
};

type Brief = {
  since: number;
  events: number;
  pagesTouched: number;
  items: Item[];
  fresh: number;
  hasMore: boolean;
  total: number;
  threads: { subject: string; pages: string[]; titles: string[]; items?: Item[] }[];
  synthesised: boolean;
  muted: string[];
};

const WINDOWS = [
  { days: 1, label: "Today" },
  { days: 7, label: "This week" },
  { days: 30, label: "This month" },
  { days: 365, label: "Everything" },
];

/** How many more the "keep reading" fetch pulls each time. */
const PAGE = 8;

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

  /**
   * Two passes: show it, then improve it.
   *
   * The whole brief used to sit behind one request that waited on eight local
   * model calls — a blank spinner for twelve seconds on the app's home screen,
   * while the fallback lines were ready in under one. So the plain brief is
   * fetched first and rendered immediately, and the written version replaces it
   * when it arrives. The rows do not move; only the sentences get better.
   *
   * `run` guards against the window toggle: clicking Today, then Week, then
   * Month fired three long requests and whichever RESOLVED last won, so the
   * pill and the content could disagree indefinitely. Only the newest run is
   * allowed to write state.
   */
  const run = useRef(0);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState<Item[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const load = useCallback(async (window: number) => {
    const mine = ++run.current;
    setLoading(true);
    setFailed(false);

    // `mark=0` — the fast pass must not consume the news before it is shown.
    const plain = await fetch(`/api/brief?days=${window}&plain=1&mark=0`).catch(() => null);
    if (mine !== run.current) return;
    if (!plain?.ok) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setMore([]);
    setExhausted(false);
    setData(await plain.json());
    setLoading(false);

    const written = await fetch(`/api/brief?days=${window}`).catch(() => null);
    if (mine !== run.current || !written?.ok) return;
    setData(await written.json());
  }, []);

  useEffect(() => {
    load(days);
  }, [load, days]);

  /**
   * Mute a folder, or a page.
   *
   * A brief that keeps surfacing something you have deliberately ignored six
   * times is a brief you stop reading — and then everything else in it is lost
   * too. The prefix is the page's folder when it has one, because the thing
   * people actually want silenced is a whole noisy directory, not one file out
   * of the forty it produces a day.
   */
  const mute = useCallback(
    async (prefix: string) => {
      await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix }),
      }).catch(() => null);
      load(days);
    },
    [load, days],
  );

  /*
   * Keep reading.
   *
   * The brief showed eight items and stopped, so a week with sixty changes had
   * fifty-two you could not reach at all — the ranking decided what you were
   * allowed to see rather than what you saw first. Scrolling to the bottom pulls
   * the next page, which makes it a record you can go back through rather than
   * a snapshot that discards the rest.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || !data) return;
    setLoadingMore(true);
    const offset = data.items.length + more.length;
    const response = await fetch(
      `/api/brief?days=${days}&offset=${offset}&limit=${PAGE}&mark=0`,
    ).catch(() => null);
    setLoadingMore(false);
    if (!response?.ok) return setExhausted(true);
    const next = (await response.json()) as Brief;
    if (!next.items.length) return setExhausted(true);
    setMore((m) => [...m, ...next.items]);
    if (!next.hasMore) setExhausted(true);
  }, [data, more.length, days, loadingMore, exhausted]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  /*
   * Rows not claimed by a thread, plus everything paged in afterwards.
   *
   * "Keep reading" fetches ranked items without re-running the grouping, so
   * they always land here rather than being silently dropped for belonging to
   * no thread.
   */
  const grouped = new Set(
    (data?.threads ?? []).flatMap((t) => (t.items ?? []).map((i) => i.pageId)),
  );
  const loose = [...(data?.items ?? []), ...more].filter((i) => !grouped.has(i.pageId));

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      {/*
        * The window pills are anchored, not floated.
        *
        * This was `flex-wrap` with an unconstrained text column, so the row
        * reflowed on the CONTENT of the subtitle: "1 new item … from 560
        * writes." kept the pills on the title line, and "8 new items … from
        * 1,062 writes." pushed them onto a second row where they landed on top
        * of the sentence they had displaced. The controls appeared to move
        * every time the numbers changed.
        *
        * Now the text column shrinks (`min-w-0 flex-1`) and wraps inside
        * itself, and the controls never shrink and never wrap — so they sit in
        * the same place whatever the copy says. Below `sm` the two stack
        * deliberately rather than by accident.
        */}
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
            What your agents learned
          </h1>
          <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
            {data && !loading
              ? data.events > 0
                ? data.fresh > 0
                  ? `${count(data.fresh, "new item")} since you last looked, from ${count(data.events, "write")}.`
                  : "You are up to date — nothing new since you last looked. Older items below."
                : "Nothing written in this window."
              : "Reading the journal…"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 self-start">
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
        <div className="space-y-4">
          {/*
            * Threads first, as groups.
            *
            * These were already computed and rendered as one line of trailing
            * prose, while the rows themselves were listed flat in reverse
            * chronological order — so "eight things happened to this client
            * today" arrived as eight unrelated rows and the reader had to spot
            * the pattern. A subject that moved across several pages IS the news.
            */}
          {data.threads
            .filter((t) => (t.items?.length ?? 0) > 1)
            .map((thread) => (
              <section key={thread.subject}>
                <h2 className="t-meta mb-1.5 px-1 font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
                  {thread.subject} · {count(thread.items?.length ?? 0, "change")}
                </h2>
                <div className="divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
                  {(thread.items ?? []).map((item) => (
                    <Row
                      key={item.pageId}
                      item={item}
                      onOpenPage={onOpenPage}
                      onMute={mute}
                    />
                  ))}
                </div>
              </section>
            ))}

          {loose.length ? (
            <div className="divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
              {loose.map((item) => (
                <Row key={item.pageId} item={item} onOpenPage={onOpenPage} onMute={mute} />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {data && !exhausted ? (
        <div ref={sentinel} className="flex justify-center py-6">
          {loadingMore ? (
            <Loader2 size={15} className="animate-spin text-[var(--lore-text-tertiary)]" />
          ) : (
            <button
              type="button"
              onClick={loadMore}
              className="t-meta rounded-lg px-3 py-1.5 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              Keep reading
            </button>
          )}
        </div>
      ) : data && more.length ? (
        <p className="t-meta py-6 text-center text-[var(--lore-text-tertiary)]">
          That is everything in this window.
        </p>
      ) : null}

      {data?.muted.length ? (
        <p className="t-meta mt-4 text-[var(--lore-text-tertiary)]">
          Muted:{" "}
          {data.muted.map((prefix, i) => (
            <span key={prefix}>
              {i > 0 ? ", " : ""}
              <button
                type="button"
                onClick={() => mute(prefix)}
                className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--lore-text-primary)]"
              >
                {prefix}
              </button>
            </span>
          ))}
          . Click to unmute.
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

/**
 * One line of news.
 *
 * The sentence is the content; everything else on the row is metadata and is
 * styled to lose to it. Two affordances appear on hover and never take space
 * when they are not wanted: the evidence the line was drawn from, and a way to
 * stop hearing about this folder.
 */
function Row({
  item,
  onOpenPage,
  onMute,
}: {
  item: Item;
  onOpenPage: (pageId: string) => void;
  onMute: (prefix: string) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const folder = item.relPath.includes("/")
    ? `${item.relPath.slice(0, item.relPath.lastIndexOf("/"))}/`
    : item.relPath;

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpenPage(item.pageId)}
        className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] leading-[1.55] text-[var(--lore-text-primary)]">
            {item.line}
          </span>
          <span className="t-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--lore-text-tertiary)]">
            {/* Labelled rather than hidden. A repeat presented as news is the
                mirror; a repeat presented as a repeat is a reminder. */}
            {item.repeat ? (
              <span className="rounded bg-[var(--lore-surface-raised)] px-1.5 py-px">seen</span>
            ) : null}
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
          {/*
            * What else this changes.
            *
            * A change to a page is only half the news: it matters because
            * other pages describe things built on what it used to say. The
            * reader should not have to hold the shape of their own wiki in
            * their head to notice that.
            */}
          {item.affects?.length ? (
            <span className="t-meta mt-0.5 block text-[var(--lore-text-tertiary)]">
              Read differently now: {item.affects.map((a) => a.title).join(", ")}
            </span>
          ) : null}
        </span>
        <ArrowRight
          size={14}
          className="mt-1 shrink-0 text-[var(--lore-text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>

      <div className="absolute right-11 top-3 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {/*
          * The passage the line came from.
          *
          * Every line in the brief is a claim about what a page now says, and
          * until now checking one meant opening the page and finding the
          * changed paragraph. This is the paragraph.
          */}
        {item.evidence ? (
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            aria-label="Show what changed"
            aria-expanded={showEvidence}
            className="rounded p-1 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-border)] hover:text-[var(--lore-text-primary)]"
          >
            <Eye size={12} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onMute(folder)}
          aria-label={`Stop showing changes in ${folder}`}
          title={`Mute ${folder}`}
          className="rounded p-1 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-border)] hover:text-[var(--lore-text-primary)]"
        >
          <BellOff size={12} />
        </button>
      </div>

      {showEvidence && item.evidence ? (
        <pre className="t-meta mx-5 mb-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--lore-border)] bg-[var(--lore-bg)] px-3 py-2 text-[var(--lore-text-secondary)]">
          {item.evidence.trim()}
        </pre>
      ) : null}
    </div>
  );
}
