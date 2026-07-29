"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, Shield, Radio } from "lucide-react";
import { ChangeDiff } from "@/components/lore/change-diff";
import { paletteVars } from "@/lib/palette";
import { cn, count, formatCount, relativeTime } from "@/lib/utils";

type Trust = "verified" | "lapsed" | "aging" | "unverified";

type TriageItem = {
  pageId: string;
  relPath: string;
  title: string;
  trust: Trust;
  inbound: number;
  linesRemoved: number;
  linesAdded: number;
  kind: "created" | "appended" | "rewritten" | "deleted";
  at: number;
  score: number;
  why: string;
};

type Review = {
  watching: boolean;
  days: number;
  events: number;
  counts: Record<Trust, number>;
  triage: TriageItem[];
  hubs: { pageId: string; title: string; inbound: number; trust: Trust }[];
};

const TRUST_LABEL: Record<Trust, string> = {
  verified: "Verified",
  lapsed: "Lapsed",
  aging: "Aging",
  unverified: "Unverified",
};

const TRUST_TONE: Record<Trust, string> = {
  verified: "text-[var(--lore-success)] border-[var(--lore-success)]/40",
  lapsed: "text-[var(--lore-danger)] border-[var(--lore-danger)]/45",
  aging: "text-[#b45309] border-[#b45309]/45 dark:text-[#fbbf24] dark:border-[#fbbf24]/40",
  unverified: "text-[var(--lore-text-tertiary)] border-[var(--lore-border-strong)]",
};

/**
 * Review — what your agents changed, ranked so you read five things instead of
 * three hundred.
 *
 * This replaced an approval queue. The queue could not work: agents write
 * through their own tools, not ours, and even a perfect gate on a vault
 * changing 300 pages a week produces a 300-item inbox that resolves to
 * "accept all" and manufactures confidence.
 *
 * So nothing is blocked. Lore watches the filesystem, ranks what happened by
 * how much it could hurt, and lets you promote what you have actually checked.
 * Verification is pinned to a content hash, so an agent rewriting a page you
 * trusted drops it straight back to the top of this list.
 */
export function ReviewView({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const [data, setData] = useState<Review | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const load = useCallback(async () => {
    const response = await fetch(`/api/review?days=${days}`);
    if (response.ok) setData(await response.json());
  }, [days]);

  useEffect(() => {
    load();
    // The watcher journals continuously, so the list goes stale while you look
    // at it. Polling is the honest fix for a view whose whole job is currency.
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function setTrust(pageId: string, action: "verify" | "unverify") {
    setBusy(pageId);
    await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, pageId }),
    });
    setBusy(null);
    load();
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0) || 1;
  const checked = data.counts.verified + data.counts.aging;

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
            Review
          </h1>
          {data.watching ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--lore-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--lore-text-tertiary)]">
              <Radio size={10} className="text-[var(--lore-success)]" />
              watching
            </span>
          ) : null}
        </div>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Nothing is blocked and nothing is waiting on you. Agents write freely; this ranks
          what they changed by how much it could cost you.
        </p>
      </header>

      {/*
       * This used to open with "0% of 1,521 pages have ever been checked by a
       * human", above ten pages each carrying a Sign off button.
       *
       * That reads as a bill for 1,521 items on the day you connect, and the
       * first person to see it said so: nobody is going to sign off a corpus,
       * so a screen that opens by counting how much of it you have not signed
       * off is measuring the wrong thing and blaming you for the answer.
       *
       * Unverified is the normal, correct state of a page. It means an agent
       * wrote it and you have not personally confirmed it — which is true of
       * almost everything, forever, and is fine. The number worth leading with
       * is what CHANGED, because that is the only part anyone can act on.
       */}
      <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] font-bold leading-none tabular-nums text-[var(--lore-text-primary)]">
            {formatCount(data.triage.length)}
          </span>
          <span className="t-body text-[var(--lore-text-secondary)]">
            {data.triage.length === 1 ? "page is" : "pages are"} worth a look after{" "}
            {count(data.events, "change")} in the last {data.days} days
          </span>
        </div>

        <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
          {(["verified", "aging", "lapsed", "unverified"] as Trust[]).map((t) => {
            const pct = (data.counts[t] / total) * 100;
            if (pct <= 0) return null;
            return (
              <div
                key={t}
                style={{
                  width: `${pct}%`,
                  background:
                    t === "verified"
                      ? "var(--lore-success)"
                      : t === "aging"
                        ? "var(--pal-7)"
                        : t === "lapsed"
                          ? "var(--lore-danger)"
                          : "var(--lore-border-strong)",
                }}
                title={`${TRUST_LABEL[t]}: ${data.counts[t]}`}
              />
            );
          })}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {(["verified", "aging", "lapsed", "unverified"] as Trust[]).map((t) => (
            <span key={t} className="t-meta text-[var(--lore-text-tertiary)]">
              {TRUST_LABEL[t]} {data.counts[t].toLocaleString()}
            </span>
          ))}
        </div>

        {/* Said once, plainly, where the number that used to shame you was. */}
        {checked === 0 ? (
          <p className="t-meta mt-3 border-t border-[var(--lore-border)] pt-3 text-[var(--lore-text-tertiary)]">
            Unverified is the normal state and not a to-do list — it means an agent wrote the
            page and you have not personally confirmed it, which will be true of most of a
            wiki forever. Signing off is optional and everything else in Lore works without
            it. It exists so that when a page does matter, you can mark that you checked it
            and be told the moment an agent rewrites it.
          </p>
        ) : null}
      </section>

      <div className="mt-8 flex items-center gap-2">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          Worth your attention
        </h2>
        <span className="flex-1" />
        {[7, 30].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              days === d
                ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
                : "text-[var(--lore-text-tertiary)] hover:text-[var(--lore-text-primary)]",
            )}
          >
            {d}d
          </button>
        ))}
      </div>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
        {data.events.toLocaleString()} writes in the last {data.days} days. Ranked by lines
        deleted, how many pages link here, and whether you had signed off on it.
      </p>

      {data.triage.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-8 text-center text-[13px] text-[var(--lore-text-tertiary)]">
          {/* On a folder linked a minute ago this is the whole screen, so it
              has to explain itself rather than look like an empty inbox. */}
          {data.events === 0
            ? "Nothing has changed since Lore started watching this folder. It only sees writes that happen while it is running, so a wiki you just linked starts empty here and fills as your agents work."
            : "Nothing in this window scored high enough to be worth your attention."}
        </p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {data.triage.map((item, i) => (
            <article
              key={item.pageId}
              style={paletteVars(i)}
              className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenPage(item.pageId)}
                  className="text-[15px] font-semibold text-[var(--lore-text-primary)] hover:text-[var(--lore-accent)]"
                >
                  {item.title}
                </button>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.05em]",
                    TRUST_TONE[item.trust],
                  )}
                >
                  {TRUST_LABEL[item.trust]}
                </span>
                <span className="t-meta text-[var(--lore-text-tertiary)]">
                  {item.kind} · {relativeTime(item.at)}
                </span>
                <span className="flex-1" />
                <span
                  className="text-[12.5px] tabular-nums"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <span className="text-[var(--lore-success)]">+{item.linesAdded}</span>{" "}
                  <span className="text-[var(--lore-danger)]">−{item.linesRemoved}</span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setTrust(item.pageId, item.trust === "verified" ? "unverify" : "verify")
                  }
                  disabled={busy === item.pageId}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                    item.trust === "verified"
                      ? "border border-[var(--lore-border)] text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]"
                      : "bg-[var(--lore-accent)] text-white hover:bg-[var(--lore-accent-hover)]",
                  )}
                >
                  {busy === item.pageId ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : item.trust === "verified" ? (
                    <ShieldCheck size={12} />
                  ) : (
                    <Shield size={12} />
                  )}
                  {item.trust === "verified" ? "Signed off" : "Sign off"}
                </button>
              </div>
              <p className="t-meta mt-1.5 text-[var(--lore-text-secondary)]">{item.why}</p>
              {/* +12/−31 is a quantity, not a review. The lines themselves are
                  one click away, on the card that asks for the signature. */}
              {item.kind !== "deleted" ? <ChangeDiff relPath={item.relPath} /> : null}
            </article>
          ))}
        </div>
      )}

      {/* Hubs deserve standing attention, not only when something touches them. */}
      {data.hubs.length > 0 ? (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            <ShieldAlert size={16} className="text-[var(--lore-text-tertiary)]" />
            Blast radius
          </h2>
          <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
            The most-linked pages in the wiki — where a wrong edit propagates into every
            answer that walks the graph. Nothing here needs doing. If you ever decide to
            sign anything off, this is the short list where it buys the most.
          </p>
          <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
            {data.hubs.map((hub) => (
              <div key={hub.pageId} className="flex items-center gap-3 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => onOpenPage(hub.pageId)}
                  className="min-w-0 flex-1 truncate text-left text-[13.5px] text-[var(--lore-text-primary)] hover:text-[var(--lore-accent)]"
                >
                  {hub.title}
                </button>
                <span className="t-meta shrink-0 tabular-nums text-[var(--lore-text-tertiary)]">
                  {hub.inbound} inbound
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.05em]",
                    TRUST_TONE[hub.trust],
                  )}
                >
                  {TRUST_LABEL[hub.trust]}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
