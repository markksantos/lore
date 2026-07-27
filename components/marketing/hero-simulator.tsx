"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookText,
  ShieldCheck,
  BarChart3,
  Plug,
  Search,
  Shield,
  Check,
  RotateCcw,
  Copy,
  FileDown,
  Clock,
  Pencil,
  Radio,
  PenLine,
  Flame,
  HelpCircle,
} from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { BrowserChrome } from "@/components/marketing/browser-chrome";
import { paletteVars } from "@/lib/palette";
import { EASE } from "@/lib/anim";
import { cn } from "@/lib/utils";

/**
 * The hero product shot — a working replica of the app, not a picture of one.
 *
 * It demonstrates the loop the product actually runs: nothing is blocked,
 * everything lands unverified, a human signs off on what they checked, and a
 * later agent rewrite drops that sign-off. The rewrite is on a button because
 * this is a demo page with no filesystem behind it; in the app the watcher
 * fires it.
 *
 * Type is sized at roughly the app's real scale rather than shrunk to fit. A
 * miniaturised UI reads as a diagram of a product; a full-size one reads as the
 * product.
 *
 * Sample content is deliberately generic — this is a public page, and a
 * realistic screenshot is worth nothing if it leaks a real client or rate.
 */

type Trust = "verified" | "aging" | "lapsed" | "unverified";

type WriteEvent = {
  agent: string;
  kind: "created" | "appended" | "rewritten";
  added: number;
  removed: number;
  when: string;
  why: string;
  /** Ranking weight. A lapsed sign-off outranks everything else. */
  weight: number;
};

type DemoPage = {
  id: string;
  title: string;
  path: string;
  folder: string;
  slot: number;
  inbound: number;
  lines: string[];
  trust: Trust;
  event?: WriteEvent;
  /** What a simulated agent rewrite would put in place of the first line. */
  rewrite?: string;
};

const FOLDERS = ["stack", "operating", "clients", "projects"] as const;

const INITIAL: DemoPage[] = [
  {
    id: "deploy",
    title: "Deploy pipeline",
    path: "stack/deploy-pipeline.md",
    folder: "stack",
    slot: 0,
    inbound: 14,
    trust: "unverified",
    lines: [
      "Push to main deploys to production. There is no staging step.",
      "A red build blocks the deploy — never override it.",
    ],
    rewrite: "Push to main deploys to production behind a five-minute canary.",
    event: {
      agent: "Claude Code",
      kind: "rewritten",
      added: 12,
      removed: 31,
      when: "2h ago",
      why: "Rewritten in place. Thirty-one lines of prose are gone and fourteen pages link here.",
      weight: 96,
    },
  },
  {
    id: "postgres",
    title: "Postgres notes",
    path: "stack/postgres-notes.md",
    folder: "stack",
    slot: 0,
    inbound: 6,
    trust: "unverified",
    lines: [
      "Running Postgres 17. Connection pooling handled at the edge.",
      "Migrations are forward-only. There is no down migration.",
    ],
    rewrite: "Running Postgres 18. Pooling moved into the application layer.",
    event: {
      agent: "Codex",
      kind: "rewritten",
      added: 4,
      removed: 18,
      when: "5h ago",
      why: "The version line moved. No other page in the vault agrees with it yet.",
      weight: 71,
    },
  },
  {
    id: "auth",
    title: "Auth decisions",
    path: "stack/auth-decisions.md",
    folder: "stack",
    slot: 0,
    inbound: 9,
    trust: "aging",
    lines: [
      "Session cookies over JWTs. Revocation was the deciding factor.",
      "Sessions live 30 days and refresh on use.",
    ],
  },
  {
    id: "glossary",
    title: "Glossary",
    path: "stack/glossary.md",
    folder: "stack",
    slot: 0,
    inbound: 11,
    trust: "unverified",
    lines: ["Shared vocabulary for everything under stack."],
  },
  {
    id: "rhythm",
    title: "Weekly rhythm",
    path: "operating/weekly-rhythm.md",
    folder: "operating",
    slot: 1,
    inbound: 3,
    trust: "unverified",
    lines: [
      "Deep work 7–11am, no meetings before noon.",
      "Ship Monday through Thursday only.",
    ],
  },
  {
    id: "checklist",
    title: "Review checklist",
    path: "operating/review-checklist.md",
    folder: "operating",
    slot: 1,
    inbound: 5,
    trust: "unverified",
    lines: ["Read the diff before the description."],
    rewrite: "Read the description first, then skim the diff.",
    event: {
      agent: "Cursor",
      kind: "appended",
      added: 6,
      removed: 0,
      when: "yesterday",
      why: "Appended, nothing removed. Cheap to read and hard to get wrong.",
      weight: 34,
    },
  },
  {
    id: "postmortems",
    title: "Postmortems",
    path: "operating/postmortems.md",
    folder: "operating",
    slot: 1,
    inbound: 2,
    trust: "unverified",
    lines: ["One page per incident. No blame, no summary paragraph."],
  },
  {
    id: "pricing",
    title: "Pricing policy",
    path: "clients/pricing.md",
    folder: "clients",
    slot: 2,
    inbound: 21,
    trust: "verified",
    lines: [
      "Retainers bill on the first. Project work bills half up front.",
      "A discount attaches to the subscription, never to a single job.",
    ],
    rewrite: "Retainers bill on the fifteenth. Project work bills on delivery.",
  },
  {
    id: "onboarding",
    title: "Client onboarding",
    path: "clients/onboarding.md",
    folder: "clients",
    slot: 2,
    inbound: 4,
    trust: "unverified",
    lines: ["Kickoff call, then a written scope before any work starts."],
    rewrite: "Written scope first, kickoff call once it is signed.",
    event: {
      agent: "sync script",
      kind: "created",
      added: 22,
      removed: 0,
      when: "3d ago",
      why: "A new page. Nothing links to it yet, so nothing depends on it being right.",
      weight: 18,
    },
  },
  {
    id: "vendors",
    title: "Vendors",
    path: "clients/vendors.md",
    folder: "clients",
    slot: 2,
    inbound: 3,
    trust: "unverified",
    lines: ["Who we buy from, on what terms, and who owns the relationship."],
  },
  {
    id: "atlas",
    title: "Atlas",
    path: "projects/atlas.md",
    folder: "projects",
    slot: 3,
    inbound: 2,
    trust: "unverified",
    lines: ["Internal mapping tool. Paused pending a decision on auth."],
  },
  {
    id: "beacon",
    title: "Beacon",
    path: "projects/beacon.md",
    folder: "projects",
    slot: 3,
    inbound: 1,
    trust: "unverified",
    lines: ["Status page. Ships behind a flag until the incident feed is real."],
  },
];

const INITIAL_WRITES = 41;

const TRUST_LABEL: Record<Trust, string> = {
  verified: "Verified",
  lapsed: "Lapsed",
  aging: "Aging",
  unverified: "Unverified",
};

/**
 * Aging borrows the amber plate ink rather than a one-off hex, so the badge
 * survives the light/dark flip with the rest of the palette.
 */
const TRUST_TONE: Record<Trust, string> = {
  verified: "text-[var(--lore-success)] border-[var(--lore-success)]/45",
  lapsed: "text-[var(--lore-danger)] border-[var(--lore-danger)]/50",
  aging: "text-[var(--pal-7-ink)] border-[var(--pal-7-ink)]/45",
  unverified: "text-[var(--lore-text-tertiary)] border-[var(--lore-border-strong)]",
};

const SEGMENT_FILL: Record<Trust, string> = {
  verified: "var(--lore-success)",
  aging: "var(--pal-7)",
  lapsed: "var(--lore-danger)",
  unverified: "var(--lore-border-strong)",
};

const ORDER: Trust[] = ["verified", "aging", "lapsed", "unverified"];

type Tab = "review" | "wiki" | "insights" | "connections";

export function HeroSimulator() {
  const [pages, setPages] = useState(INITIAL);
  const [writes, setWrites] = useState(INITIAL_WRITES);
  const [tab, setTab] = useState<Tab>("review");
  const [folder, setFolder] = useState<string>("stack");
  /** The page a simulated rewrite just landed on, so the row flashes. */
  const [struck, setStruck] = useState<string | null>(null);

  const counts = useMemo(() => {
    const tally: Record<Trust, number> = { verified: 0, aging: 0, lapsed: 0, unverified: 0 };
    for (const page of pages) tally[page.trust] += 1;
    return tally;
  }, [pages]);

  const triage = useMemo(
    () =>
      pages
        .filter((page): page is DemoPage & { event: WriteEvent } => page.event !== undefined)
        .sort((a, b) => b.event.weight - a.event.weight),
    [pages],
  );

  const toggleSignOff = useCallback((pageId: string) => {
    setPages((current) =>
      current.map((page) =>
        page.id === pageId
          ? { ...page, trust: page.trust === "verified" ? "unverified" : "verified" }
          : page,
      ),
    );
  }, []);

  /**
   * A rewrite goes after something you signed off on, because that is the case
   * worth showing. With nothing signed off it hits the highest-ranked page
   * instead, which is what a real agent would be editing anyway.
   */
  const simulateRewrite = useCallback(() => {
    const target =
      pages.find((page) => page.trust === "verified" && page.rewrite) ??
      pages.find((page) => page.rewrite);
    if (!target) return;

    const lapsing = target.trust === "verified";
    setPages((current) =>
      current.map((page) =>
        page.id !== target.id
          ? page
          : {
              ...page,
              trust: lapsing ? "lapsed" : page.trust,
              lines: page.rewrite ? [page.rewrite, ...page.lines.slice(1)] : page.lines,
              rewrite: undefined,
              event: {
                agent: "Claude Code",
                kind: "rewritten",
                added: 9,
                removed: 27,
                when: "just now",
                why: lapsing
                  ? "You signed this off. It has been rewritten since, so the sign-off came off."
                  : "Rewritten in place while you were reading this page.",
                weight: 999,
              },
            },
      ),
    );
    setWrites((n) => n + 1);
    setStruck(target.id);
    window.setTimeout(() => setStruck(null), 1800);
  }, [pages]);

  const reset = useCallback(() => {
    setPages(INITIAL);
    setWrites(INITIAL_WRITES);
    setStruck(null);
  }, []);

  const dirty = pages !== INITIAL;
  const folderPages = pages.filter((page) => page.folder === folder);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] shadow-[0_40px_100px_-45px_rgba(15,23,42,0.55)]">
      <BrowserChrome url="lore.md" />

      <div className="flex h-[540px] sm:h-[580px] lg:h-[620px]">
        {/* -------------------------------------------------------- sidebar */}
        <div className="hidden w-[212px] shrink-0 flex-col border-r border-[var(--lore-border)] px-5 py-5 sm:flex">
          <div className="flex items-center gap-2.5 text-[var(--lore-text-primary)]">
            <BrandMark size={20} />
            <span className="text-[16px] font-semibold tracking-[-0.025em]">Lore</span>
          </div>

          <div className="mt-4 space-y-0.5">
            {(
              [
                { id: "review", label: "Review", icon: ShieldCheck },
                { id: "wiki", label: "Wiki", icon: BookText },
                { id: "insights", label: "Insights", icon: BarChart3 },
                { id: "connections", label: "Connections", icon: Plug },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] transition-colors",
                    tab === item.id
                      ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                  )}
                >
                  <Icon size={16} className="opacity-80" />
                  {item.label}
                  {item.id === "review" && counts.lapsed > 0 ? (
                    // Accent, not danger: this is the app's own badge colour, and
                    // white on the dark-mode danger red is unreadable.
                    <motion.span
                      layout
                      className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--lore-accent)] px-1 text-[11px] font-semibold text-white"
                    >
                      {counts.lapsed}
                    </motion.span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="my-4 border-t border-[var(--lore-border)]" />

          <div className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5">
            <Search size={13} className="text-[var(--lore-text-tertiary)]" />
            <span className="text-[13px] text-[var(--lore-text-tertiary)]">Search</span>
            <kbd className="ml-auto rounded border border-[var(--lore-border)] px-1 py-px text-[10px] text-[var(--lore-text-tertiary)]">
              ⌘K
            </kbd>
          </div>

          <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
            Folders
          </p>
          <div className="space-y-0.5">
            {FOLDERS.map((name, i) => {
              const pageCount = pages.filter((page) => page.folder === name).length;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setFolder(name);
                    setTab("wiki");
                  }}
                  style={paletteVars(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] transition-colors",
                    folder === name && tab === "wiki"
                      ? "bg-[var(--lore-surface-selected)] font-medium text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                  )}
                >
                  <span className="pal-dot" />
                  <span className="truncate">{name}</span>
                  <span className="ml-auto text-[12px] text-[var(--lore-text-tertiary)]">
                    {pageCount}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-auto">
            {dirty ? (
              <button
                type="button"
                onClick={reset}
                className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--lore-border)] py-2 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
              >
                <RotateCcw size={12} />
                Reset demo
              </button>
            ) : null}
            {/* The app's real sidebar foot. No avatar, no name — Lore has no
                accounts, so a profile chip here would be inventing one. */}
            <div className="border-t border-[var(--lore-border)] pt-3">
              <p className="text-[12px] text-[var(--lore-text-tertiary)]">
                {pages.length} pages · scanned just now
              </p>
            </div>
          </div>
        </div>

        {/* ----------------------------------------------------------- main */}
        <div className="lore-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[700px] px-4 pb-10 pt-6 md:px-7">
            {tab === "review" ? (
              <ReviewPane
                counts={counts}
                triage={triage}
                writes={writes}
                struck={struck}
                onSignOff={toggleSignOff}
                onRewrite={simulateRewrite}
              />
            ) : null}
            {tab === "wiki" ? <WikiPane folder={folder} pages={folderPages} /> : null}
            {tab === "insights" ? <InsightsPane /> : null}
            {tab === "connections" ? <ConnectionsPane /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- review

function ReviewPane({
  counts,
  triage,
  writes,
  struck,
  onSignOff,
  onRewrite,
}: {
  counts: Record<Trust, number>;
  triage: (DemoPage & { event: WriteEvent })[];
  writes: number;
  struck: string | null;
  onSignOff: (pageId: string) => void;
  onRewrite: () => void;
}) {
  const total = ORDER.reduce((sum, state) => sum + counts[state], 0);
  const checked = counts.verified + counts.aging;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Review
        </h3>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--lore-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--lore-text-tertiary)]">
          <Radio size={10} className="text-[var(--lore-success)]" />
          watching
        </span>
      </div>

      <p className="mt-1.5 text-[15px] leading-[1.6] text-[var(--lore-text-secondary)]">
        Nothing is blocked. This ranks what your agents changed, and records what you
        actually checked.
      </p>

      <section className="mt-5 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
        <div className="flex items-baseline gap-2">
          <motion.span
            key={checked}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            className="text-[30px] font-bold leading-none tabular-nums text-[var(--lore-text-primary)]"
          >
            {Math.round((checked / total) * 100)}%
          </motion.span>
          <span className="text-[15px] leading-[1.6] text-[var(--lore-text-secondary)]">
            of {total} pages have ever been checked by a human
          </span>
        </div>

        <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
          {/* Width is a plain CSS transition rather than a motion value: a
              percentage target has no pixel basis to animate from on mount,
              which leaves the bar sitting at zero. */}
          {ORDER.map((state) => (
            <div
              key={state}
              className="transition-[width] duration-500 ease-out"
              style={{
                width: `${(counts[state] / total) * 100}%`,
                background: SEGMENT_FILL[state],
              }}
              title={`${TRUST_LABEL[state]}: ${counts[state]}`}
            />
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {ORDER.map((state) => (
            <span key={state} className="text-[13px] text-[var(--lore-text-tertiary)]">
              {TRUST_LABEL[state]} {counts[state]}
            </span>
          ))}
        </div>
      </section>

      <div style={paletteVars(0)} className="mt-8 flex items-center gap-2.5">
        <span className="pal-bar" />
        <h4 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          Worth your attention
        </h4>
      </div>
      <p className="mt-1 text-[13px] text-[var(--lore-text-tertiary)]">
        {writes} writes in the last 7 days. Ranked by lines deleted, how many pages link
        here, and whether you had signed it off.
      </p>

      <div className="mt-4 space-y-2.5">
        <AnimatePresence initial={false}>
          {triage.map((page, i) => (
            <motion.article
              key={page.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              style={paletteVars(i)}
              className={cn(
                "rounded-xl border bg-[var(--lore-surface)] px-4 py-3.5 transition-colors duration-700",
                struck === page.id
                  ? "border-[var(--lore-danger)]/50"
                  : "border-[var(--lore-border)]",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
                  {page.title}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.05em]",
                    TRUST_TONE[page.trust],
                  )}
                >
                  {TRUST_LABEL[page.trust]}
                </span>
                <span className="text-[13px] text-[var(--lore-text-tertiary)]">
                  {page.event.kind} · {page.event.when}
                </span>
                <span className="flex-1" />
                <span
                  className="text-[12.5px] tabular-nums"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <span className="text-[var(--lore-success)]">+{page.event.added}</span>{" "}
                  <span className="text-[var(--lore-danger)]">−{page.event.removed}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onSignOff(page.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors",
                    page.trust === "verified"
                      ? "border border-[var(--lore-border)] text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]"
                      : "bg-[var(--lore-accent)] text-white hover:bg-[var(--lore-accent-hover)]",
                  )}
                >
                  {page.trust === "verified" ? <Check size={12} /> : <Shield size={12} />}
                  {page.trust === "verified" ? "Signed off" : "Sign off"}
                </button>
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--lore-text-secondary)]">
                {page.event.why}
              </p>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={onRewrite}
        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--lore-border)] px-3 py-2 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
      >
        <PenLine size={13} />
        Simulate an agent rewrite
      </button>
      <p className="mt-2 text-[13px] leading-[1.55] text-[var(--lore-text-tertiary)]">
        Sign a page off, then run a rewrite over it. The sign-off is pinned to the content
        hash, so the page lapses and comes straight back to the top.
      </p>
    </>
  );
}

// --------------------------------------------------------------------- wiki

function WikiPane({ folder, pages }: { folder: string; pages: DemoPage[] }) {
  return (
    <div className="lore-fade-up">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          {folder}
        </h3>
      </div>

      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[var(--lore-text-tertiary)]">
        <Clock size={12} />
        {pages.length} pages · read straight off disk
      </p>

      {pages.map((page, i) => (
        <div key={page.id} style={paletteVars(i)} className="group mt-9">
          <div className="flex items-center gap-2.5">
            <span className="pal-bar" />
            <h4 className="pal-title text-[18px] font-semibold tracking-[-0.02em]">
              {page.title}
            </h4>
            <span
              className={cn(
                "rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.05em]",
                TRUST_TONE[page.trust],
              )}
            >
              {TRUST_LABEL[page.trust]}
            </span>
            <span className="flex-1" />
            {/* The one control the real page section carries on hover. */}
            <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12.5px] font-medium text-[var(--lore-text-secondary)] opacity-0 transition-opacity group-hover:opacity-100">
              <Pencil size={12} />
              Edit
            </span>
          </div>
          <p
            className="mt-1 text-[12px] text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {page.path} · {page.inbound} inbound
          </p>

          <ul className="pal-bullets mt-3 space-y-2">
            {page.lines.map((line) => (
              <motion.li
                key={line}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="text-[15px] leading-[1.7] text-[var(--lore-text-primary)]"
              >
                {line}
              </motion.li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- insights

const HOT = [
  { path: "stack/deploy-pipeline.md", reads: 148, slot: 0 },
  { path: "clients/pricing.md", reads: 96, slot: 2 },
  { path: "operating/weekly-rhythm.md", reads: 61, slot: 1 },
];

const GAPS = [
  { query: "reseller discount", asks: 4 },
  { query: "refund window", asks: 3 },
  { query: "vendor payment terms", asks: 2 },
];

function InsightsPane() {
  return (
    <div className="lore-fade-up">
      <h3 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
        Insights
      </h3>
      <p className="mt-1.5 text-[15px] leading-[1.6] text-[var(--lore-text-secondary)]">
        Your agents read the wiki through Lore, so Lore can answer two questions nothing
        else can.
      </p>

      <div style={paletteVars(3)} className="mt-7 flex items-center gap-2.5">
        <span className="pal-bar" />
        <h4 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <Flame size={15} className="text-[var(--lore-text-tertiary)]" />
          Pages your agents actually open
        </h4>
      </div>
      <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)]">
        {HOT.map((page) => (
          <div key={page.path} style={paletteVars(page.slot)} className="flex items-center gap-2.5 px-4 py-2.5">
            <span className="pal-dot" />
            <span
              className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {page.path}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-[var(--lore-text-tertiary)]">
              {page.reads} reads
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-[var(--lore-text-tertiary)]">
        Nine of these twelve pages were not opened once this month.
      </p>

      <div style={paletteVars(6)} className="mt-8 flex items-center gap-2.5">
        <span className="pal-bar" />
        <h4 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <HelpCircle size={15} className="text-[var(--lore-text-tertiary)]" />
          Searches that returned nothing
        </h4>
      </div>
      <div className="mt-3 space-y-2">
        {GAPS.map((gap) => (
          <div
            key={gap.query}
            className="flex items-center gap-2.5 rounded-xl border border-[var(--lore-border)] px-4 py-2.5"
          >
            <Search size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
            <span
              className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {gap.query}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-[var(--lore-text-tertiary)]">
              asked {gap.asks}×
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[13px] leading-[1.55] text-[var(--lore-text-tertiary)]">
        Every line here is a page your wiki was asked for and did not have.
      </p>
    </div>
  );
}

// -------------------------------------------------------------- connections

function ConnectionsPane() {
  return (
    <div className="lore-fade-up">
      <h3 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
        Connections
      </h3>
      <p className="mt-1.5 text-[13px] text-[var(--lore-text-tertiary)]">
        Two ways in. Wire either one.
      </p>

      <div className="mt-5 space-y-3.5">
        <div className="rounded-xl border border-[var(--lore-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--lore-accent-tint)] text-[12px] font-semibold text-[var(--lore-accent)]">
              1
            </span>
            <h4 className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
              Drop an index into the vault
            </h4>
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--lore-text-secondary)]">
            One page listing every note, its folder and its tags. Any agent that reads files
            finds it without being told.
          </p>
          <span className="mt-3.5 inline-flex items-center gap-2 rounded-lg bg-[var(--lore-accent)] px-3 py-1.5 text-[13px] font-semibold text-white">
            <FileDown size={13} />
            Write AGENTS.md
          </span>
        </div>

        <div className="rounded-xl border border-[var(--lore-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--lore-accent-tint)] text-[12px] font-semibold text-[var(--lore-accent)]">
              2
            </span>
            <h4 className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
              Connect over MCP
            </h4>
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--lore-text-secondary)]">
            Four tools, all of them reads: <code>wiki_index</code>, <code>wiki_search</code>,{" "}
            <code>wiki_read</code>, <code>wiki_health</code>. Your agents keep writing with
            their own file tools — Lore watches the folder for that.
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-[var(--lore-border)]">
            <div className="flex items-center justify-between border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-1.5">
              <span className="text-[11.5px] text-[var(--lore-text-tertiary)]">.mcp.json</span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--lore-text-secondary)]">
                <Copy size={11} />
                Copy
              </span>
            </div>
            <pre
              className="overflow-x-auto bg-[var(--lore-background)] px-3 py-2.5 text-[12px] leading-[1.7] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >{`{ "mcpServers": { "lore": {
    "command": "node",
    "args": ["…/lore/mcp/server.mjs"]
} } }`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
