"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookText,
  Plug,
  Settings,
  Search,
  Check,
  X,
  RotateCcw,
  FileDown,
  Copy,
  Clock,
  History,
  LockOpen,
  MoreHorizontal,
  CloudUpload,
  ChevronDown,
  Activity,
} from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { BrowserChrome } from "@/components/marketing/browser-chrome";
import { paletteVars } from "@/lib/palette";
import { EASE } from "@/lib/anim";
import { cn } from "@/lib/utils";

/**
 * The hero product shot — a working replica of the app, not a picture of one.
 *
 * Folders switch, tabs switch, proposals accept and reject, accepted lines
 * merge into the page, counters decrement, and the whole thing resets. Local
 * state only, no backend: the marketing page demonstrates the review loop
 * rather than describing it.
 *
 * Type is sized at roughly the app's real scale rather than shrunk to fit. A
 * miniaturised UI reads as a diagram of a product; a full-size one reads as the
 * product.
 *
 * Sample content is deliberately generic — this is a public page, and a
 * realistic screenshot is worth nothing if it leaks a real client or rate.
 */

type DemoProposal = {
  id: string;
  agent: string;
  risk: "low" | "medium" | "high";
  kind: "append" | "replace";
  reason: string;
  add: string[];
  /** Index of the line this would replace, if any. */
  replaces?: number;
};

type DemoPage = {
  id: string;
  title: string;
  path: string;
  lines: string[];
  proposals: DemoProposal[];
};

type DemoFolder = { name: string; pages: DemoPage[] };

const INITIAL: DemoFolder[] = [
  {
    name: "stack",
    pages: [
      {
        id: "deploy",
        title: "Deploy pipeline",
        path: "stack/deploy-pipeline.md",
        lines: [
          "Push to main deploys to production. There is no staging step.",
          "A red build blocks the deploy — never override it.",
        ],
        proposals: [
          {
            id: "p1",
            agent: "Claude Code",
            risk: "medium",
            kind: "append",
            reason: "Rollbacks came up twice this week and the answer isn't written down.",
            add: ["Rollback is a revert commit, not a dashboard button."],
          },
        ],
      },
      {
        id: "postgres",
        title: "Postgres notes",
        path: "stack/postgres-notes.md",
        lines: [
          "Running Postgres 16. Connection pooling handled at the edge.",
          "Migrations are forward-only. There is no down migration.",
        ],
        proposals: [
          {
            id: "p2",
            agent: "Codex",
            risk: "high",
            kind: "replace",
            reason: "The deploy log shows Postgres 17 in production, but this page still says 16.",
            add: ["Running Postgres 17. Connection pooling handled at the edge."],
            replaces: 0,
          },
        ],
      },
      {
        id: "auth",
        title: "Auth decisions",
        path: "stack/auth-decisions.md",
        lines: [
          "Session cookies over JWTs. Revocation was the deciding factor.",
          "Sessions live 30 days and refresh on use.",
        ],
        proposals: [],
      },
    ],
  },
  {
    name: "operating",
    pages: [
      {
        id: "rhythm",
        title: "Weekly rhythm",
        path: "operating/weekly-rhythm.md",
        lines: [
          "Deep work 7–11am, no meetings before noon.",
          "Ship Monday through Thursday only.",
          "Friday afternoon is for review, not for shipping.",
        ],
        proposals: [],
      },
      {
        id: "review",
        title: "Review checklist",
        path: "operating/review-checklist.md",
        lines: ["Read the diff before the description."],
        proposals: [
          {
            id: "p3",
            agent: "Cursor",
            risk: "low",
            kind: "append",
            reason: "You have asked for this check on the last four reviews.",
            add: ["Confirm the test actually fails without the fix."],
          },
        ],
      },
    ],
  },
  {
    name: "projects",
    pages: [
      {
        id: "atlas",
        title: "Atlas",
        path: "projects/atlas.md",
        lines: [
          "Internal mapping tool. Paused pending a decision on auth.",
          "Owner is unassigned while it is paused.",
        ],
        proposals: [],
      },
      {
        id: "beacon",
        title: "Beacon",
        path: "projects/beacon.md",
        lines: ["Status page. Ships behind a flag until the incident feed is real."],
        proposals: [],
      },
    ],
  },
];

const RISK_STYLE: Record<DemoProposal["risk"], string> = {
  low: "text-[var(--lore-text-tertiary)] border-[var(--lore-border-strong)]",
  medium: "text-[#b45309] border-[#b45309]/45 dark:text-[#fbbf24] dark:border-[#fbbf24]/40",
  high: "text-[var(--lore-danger)] border-[var(--lore-danger)]/45",
};

type Tab = "wiki" | "connections" | "settings";

export function HeroSimulator() {
  const [folders, setFolders] = useState(INITIAL);
  const [active, setActive] = useState("stack");
  const [tab, setTab] = useState<Tab>("wiki");
  /** Keys of lines that just landed, so they flash rather than pop. */
  const [justAdded, setJustAdded] = useState<string[]>([]);

  const folder = folders.find((f) => f.name === active)!;

  const pendingIn = useCallback(
    (name: string) =>
      folders.find((f) => f.name === name)!.pages.reduce((n, p) => n + p.proposals.length, 0),
    [folders],
  );

  const totals = useMemo(() => {
    let count = 0;
    let added = 0;
    let removed = 0;
    for (const page of folder.pages) {
      for (const p of page.proposals) {
        count += 1;
        added += p.add.length;
        removed += p.replaces !== undefined ? 1 : 0;
      }
    }
    return { count, added, removed };
  }, [folder]);

  const totalPending = folders.reduce(
    (n, f) => n + f.pages.reduce((m, p) => m + p.proposals.length, 0),
    0,
  );

  const resolve = useCallback((pageId: string, proposalId: string, action: "accept" | "reject") => {
    setFolders((current) =>
      current.map((f) => ({
        ...f,
        pages: f.pages.map((page) => {
          if (page.id !== pageId) return page;
          const proposal = page.proposals.find((p) => p.id === proposalId);
          if (!proposal) return page;

          let lines = page.lines;
          if (action === "accept") {
            lines =
              proposal.replaces !== undefined
                ? page.lines.map((l, i) => (i === proposal.replaces ? proposal.add[0] : l))
                : [...page.lines, ...proposal.add];
          }
          return {
            ...page,
            lines,
            proposals: page.proposals.filter((p) => p.id !== proposalId),
          };
        }),
      })),
    );

    if (action === "accept") {
      const source = INITIAL.flatMap((f) => f.pages).find((p) => p.id === pageId)!;
      const keys = source
        .proposals.find((p) => p.id === proposalId)!
        .add.map((line) => `${pageId}:${line}`);
      setJustAdded((k) => [...k, ...keys]);
      window.setTimeout(() => setJustAdded((k) => k.filter((x) => !keys.includes(x))), 1800);
    }
  }, []);

  const resolveAll = useCallback(
    (action: "accept" | "reject") => {
      for (const page of folder.pages) {
        for (const proposal of [...page.proposals]) resolve(page.id, proposal.id, action);
      }
    },
    [folder, resolve],
  );

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
                { id: "wiki", label: "Wiki", icon: BookText },
                { id: "connections", label: "Connections", icon: Plug },
                { id: "settings", label: "Settings", icon: Settings },
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
            {folders.map((f, i) => {
              const pending = pendingIn(f.name);
              return (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => {
                    setActive(f.name);
                    setTab("wiki");
                  }}
                  style={paletteVars(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] transition-colors",
                    active === f.name && tab === "wiki"
                      ? "bg-[var(--lore-surface-selected)] font-medium text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                  )}
                >
                  <span className="pal-dot" />
                  <span className="truncate">{f.name}</span>
                  {pending > 0 ? (
                    <motion.span
                      layout
                      className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--lore-accent)] px-1 text-[11px] font-semibold text-white"
                    >
                      {pending}
                    </motion.span>
                  ) : (
                    <span className="ml-auto text-[12px] text-[var(--lore-text-tertiary)]">
                      {f.pages.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-auto">
            {totalPending === 0 ? (
              <button
                type="button"
                onClick={() => setFolders(INITIAL)}
                className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--lore-border)] py-2 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
              >
                <RotateCcw size={12} />
                Reset demo
              </button>
            ) : null}
            <div className="border-t border-[var(--lore-border)] pt-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--lore-accent-tint)] text-[12px] font-semibold text-[var(--lore-accent)]">
                  M
                </span>
                <span className="text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                  Mark
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ----------------------------------------------------------- main */}
        <div className="lore-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[700px] px-4 pb-10 pt-6 md:px-7">
          {tab === "connections" ? <ConnectionsPane /> : null}
          {tab === "settings" ? <SettingsPane /> : null}

          {tab === "wiki" ? (
            <>
              {/* Title row with the app's real toolbar, not just a heading. */}
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
                  {folder.name}
                </h3>
                <span className="flex-1" />
                <ToolbarButton icon={CloudUpload} label="Push" muted chevron />
                <ToolbarButton icon={History} label="Activity" />
                <ToolbarButton icon={LockOpen} label="Unlocked" />
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--lore-border)] text-[var(--lore-text-secondary)]">
                  <MoreHorizontal size={15} />
                </span>
              </div>

              <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[var(--lore-text-tertiary)]">
                <Clock size={12} />
                {folder.pages.length} pages · saved just now
              </p>

              <AnimatePresence initial={false}>
                {totals.count > 0 ? (
                  <motion.div
                    key="bar"
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] py-2 pl-4 pr-2 shadow-[0_6px_20px_-12px_rgba(15,23,42,0.3)]"
                  >
                    <span
                      className="text-[14px] font-semibold tabular-nums text-[var(--lore-success)]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      +{totals.added}
                    </span>
                    <span
                      className="text-[14px] font-semibold tabular-nums text-[var(--lore-danger)]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      −{totals.removed}
                    </span>
                    <span className="text-[13.5px] text-[var(--lore-text-tertiary)]">·</span>
                    <span className="text-[13.5px] text-[var(--lore-text-secondary)]">
                      {totals.count} {totals.count === 1 ? "proposal" : "proposals"}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => resolveAll("reject")}
                      className="rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
                    >
                      Reject all
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveAll("accept")}
                      className="rounded-lg bg-[var(--lore-accent)] px-3.5 py-1.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
                    >
                      Accept all
                    </button>
                  </motion.div>
                ) : (
                  <motion.p
                    key="clear"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 rounded-xl border border-dashed border-[var(--lore-border)] px-4 py-2.5 text-[13px] text-[var(--lore-text-tertiary)]"
                  >
                    Nothing waiting in this folder.
                  </motion.p>
                )}
              </AnimatePresence>

              {folder.pages.map((page, i) => (
                <motion.div key={page.id} layout style={paletteVars(i)} className="group mt-9">
                  <div className="flex items-center gap-2.5">
                    <span className="pal-bar" />
                    <h4 className="pal-title text-[18px] font-semibold tracking-[-0.02em]">
                      {page.title}
                    </h4>
                    {page.proposals.length > 0 ? (
                      <span className="pal-chip rounded-md px-2 py-0.5 text-[11px] font-semibold">
                        {page.proposals.length}{" "}
                        {page.proposals.length === 1 ? "proposal" : "proposals"}
                      </span>
                    ) : null}
                    <span className="flex-1" />
                    <MoreHorizontal
                      size={15}
                      className="text-[var(--lore-text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                  <p
                    className="mt-1 text-[12px] text-[var(--lore-text-tertiary)]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    {page.path}
                  </p>

                  <ul className="pal-bullets mt-3 space-y-2">
                    {page.lines.map((line) => {
                      const flash = justAdded.includes(`${page.id}:${line}`);
                      return (
                        <motion.li
                          key={line}
                          layout
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.35, ease: EASE }}
                          className={cn(
                            "rounded text-[15px] leading-[1.7] transition-colors duration-700",
                            flash
                              ? "bg-[var(--lore-success)]/14 text-[var(--lore-text-primary)]"
                              : "text-[var(--lore-text-primary)]",
                          )}
                        >
                          {line}
                        </motion.li>
                      );
                    })}
                  </ul>

                  <AnimatePresence initial={false}>
                    {page.proposals.map((proposal) => (
                      <motion.div
                        key={proposal.id}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        transition={{ duration: 0.32, ease: EASE }}
                        className="mt-3.5 overflow-hidden"
                      >
                        <div className="overflow-hidden rounded-xl border border-[var(--lore-border)]">
                          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3.5 py-2">
                            <ChevronDown size={14} className="text-[var(--lore-text-tertiary)]" />
                            <AgentGlyph name={proposal.agent} />
                            <span className="text-[13.5px] font-semibold text-[var(--lore-text-primary)]">
                              {proposal.agent}
                            </span>
                            <span className="text-[13px] text-[var(--lore-text-tertiary)]">
                              proposed {proposal.kind === "replace" ? "a rewrite" : "an update"}
                            </span>
                            <span
                              className={cn(
                                "rounded-full border px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.05em]",
                                RISK_STYLE[proposal.risk],
                              )}
                            >
                              {proposal.risk}
                            </span>
                            <span
                              className="text-[13px] tabular-nums"
                              style={{ fontFamily: "var(--font-mono), monospace" }}
                            >
                              <span className="text-[var(--lore-success)]">
                                +{proposal.add.length}
                              </span>{" "}
                              <span className="text-[var(--lore-danger)]">
                                −{proposal.replaces !== undefined ? 1 : 0}
                              </span>
                            </span>
                            <span className="flex-1" />
                            <button
                              type="button"
                              onClick={() => resolve(page.id, proposal.id, "reject")}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface)]"
                            >
                              <X size={12} />
                              Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => resolve(page.id, proposal.id, "accept")}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
                            >
                              <Check size={12} />
                              Accept
                            </button>
                          </div>

                          <p className="px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--lore-text-secondary)]">
                            {proposal.reason}
                          </p>

                          <div
                            className="border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-3.5 py-2.5 text-[12.5px] leading-[1.75]"
                            style={{ fontFamily: "var(--font-mono), monospace" }}
                          >
                            {proposal.replaces !== undefined ? (
                              <div className="rounded bg-[var(--lore-danger)]/10 px-1.5 text-[var(--lore-danger)]">
                                − {page.lines[proposal.replaces]}
                              </div>
                            ) : (
                              <div className="px-1.5 text-[var(--lore-text-tertiary)]">
                                {page.lines[page.lines.length - 1]}
                              </div>
                            )}
                            {proposal.add.map((line) => (
                              <div
                                key={line}
                                className="rounded bg-[var(--lore-success)]/12 px-1.5 text-[var(--lore-success)]"
                              >
                                + {line}
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              ))}
            </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  muted,
  chevron,
}: {
  icon: typeof History;
  label: string;
  muted?: boolean;
  chevron?: boolean;
}) {
  return (
    <span
      className={cn(
        "hidden h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[13px] font-medium md:inline-flex",
        muted ? "text-[var(--lore-text-tertiary)]" : "text-[var(--lore-text-secondary)]",
      )}
    >
      <Icon size={13} />
      {label}
      {chevron ? <ChevronDown size={12} className="opacity-60" /> : null}
    </span>
  );
}

/**
 * A monogram stand-in for the proposing agent. Deliberately not an
 * approximation of a real brand mark — a near-miss reads as broken.
 */
function AgentGlyph({ name }: { name: string }) {
  const slot = name.length % 8;
  return (
    <span
      style={paletteVars(slot)}
      className="pal-chip flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
      aria-hidden
    >
      {name[0]}
    </span>
  );
}

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

function SettingsPane() {
  const stats = [
    { slot: 3, value: "88", label: "Health" },
    { slot: 4, value: "412", label: "Pages" },
    { slot: 5, value: "6", label: "Orphans" },
    { slot: 2, value: "3", label: "Dead links" },
  ];

  return (
    <div className="lore-fade-up">
      <h3 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
        Settings
      </h3>
      <p className="mt-1.5 text-[13px] text-[var(--lore-text-tertiary)]">
        The folder Lore reads, and what an agent would trip over in it.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} style={paletteVars(s.slot)} className="plate px-4 py-3.5">
            <div className="text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {s.value}
            </div>
            <div className="plate-muted mt-2 text-[12px] font-semibold">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-[var(--lore-border)] px-4 py-3">
        <Activity size={14} className="text-[var(--lore-text-tertiary)]" />
        <span
          className="truncate text-[13px] text-[var(--lore-text-secondary)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          ~/Documents/wiki
        </span>
      </div>
    </div>
  );
}
