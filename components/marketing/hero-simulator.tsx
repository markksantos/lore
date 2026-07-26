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
  Activity,
} from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { paletteVars } from "@/lib/palette";
import { EASE } from "@/lib/anim";
import { cn } from "@/lib/utils";

/**
 * The hero product shot — a working replica of the app, not a picture of one.
 *
 * Folders switch, proposals accept and reject, accepted lines actually merge
 * into the page, the counter decrements, and the whole thing resets. It runs on
 * local state with no backend, so the marketing page can demonstrate the review
 * loop rather than describe it.
 *
 * Sample content is deliberately generic: this is a public page, and a
 * realistic-looking screenshot is worth nothing if it leaks a real client or a
 * real rate.
 */

type DemoProposal = {
  id: string;
  agent: string;
  risk: "low" | "medium" | "high";
  kind: "append" | "replace";
  reason: string;
  /** Lines the proposal would add. */
  add: string[];
  /** Line index in the page this would replace, if any. */
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
        lines: ["Running Postgres 16. Connection pooling handled at the edge."],
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
        lines: ["Session cookies over JWTs. Revocation was the deciding factor."],
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
        lines: ["Deep work 7–11am, no meetings before noon.", "Ship Monday through Thursday only."],
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
        lines: ["Internal mapping tool. Paused pending a decision on auth."],
        proposals: [],
      },
      {
        id: "beacon",
        title: "Beacon",
        path: "projects/beacon.md",
        lines: ["Status page. Ships behind a flag."],
        proposals: [],
      },
    ],
  },
];

const RISK_STYLE: Record<DemoProposal["risk"], string> = {
  low: "text-[var(--lore-text-tertiary)] border-[var(--lore-border-strong)]",
  medium: "text-[#b45309] border-[#b45309]/40 dark:text-[#fbbf24] dark:border-[#fbbf24]/35",
  high: "text-[var(--lore-danger)] border-[var(--lore-danger)]/40",
};

type Tab = "wiki" | "connections" | "settings";

export function HeroSimulator() {
  const [folders, setFolders] = useState(INITIAL);
  const [active, setActive] = useState("stack");
  const [tab, setTab] = useState<Tab>("wiki");
  /** Line ids that just landed, so they can flash in rather than pop. */
  const [justAdded, setJustAdded] = useState<string[]>([]);

  const folder = folders.find((f) => f.name === active)!;

  const pendingIn = useCallback(
    (name: string) =>
      folders
        .find((f) => f.name === name)!
        .pages.reduce((n, p) => n + p.proposals.length, 0),
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

  const resolve = useCallback(
    (pageId: string, proposalId: string, action: "accept" | "reject") => {
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
        const keys = INITIAL.flatMap((f) => f.pages)
          .find((p) => p.id === pageId)!
          .proposals.find((p) => p.id === proposalId)!
          .add.map((line) => `${pageId}:${line}`);
        setJustAdded((k) => [...k, ...keys]);
        window.setTimeout(
          () => setJustAdded((k) => k.filter((x) => !keys.includes(x))),
          1600,
        );
      }
    },
    [],
  );

  const resolveAll = useCallback(
    (action: "accept" | "reject") => {
      for (const page of folder.pages) {
        for (const proposal of [...page.proposals]) {
          resolve(page.id, proposal.id, action);
        }
      }
    },
    [folder, resolve],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] shadow-[0_40px_90px_-45px_rgba(15,23,42,0.5)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="ml-3 text-[11.5px] text-[var(--lore-text-tertiary)]">
          localhost:4646 — ~/Documents/wiki
        </span>
        <span className="ml-auto hidden items-center gap-1.5 text-[10.5px] font-medium text-[var(--lore-text-tertiary)] sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-success)]" />
          live — try it
        </span>
      </div>

      <div className="flex h-[29rem] md:h-[32rem]">
        {/* -------------------------------------------------------- sidebar */}
        <div className="hidden w-[13.5rem] shrink-0 flex-col border-r border-[var(--lore-border)] sm:flex">
          <div className="flex items-center gap-2 px-3.5 pb-3 pt-3.5 text-[var(--lore-text-primary)]">
            <BrandMark size={16} />
            <span className="text-[13px] font-semibold tracking-[-0.02em]">wiki</span>
          </div>

          <div className="space-y-0.5 px-2.5">
            {([
              { id: "wiki", label: "Wiki", icon: BookText },
              { id: "connections", label: "Connections", icon: Plug },
              { id: "settings", label: "Settings", icon: Settings },
            ] as const).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors",
                    tab === item.id
                      ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                  )}
                >
                  <Icon size={13} className="opacity-80" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="px-2.5 pb-2 pt-3.5">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5">
              <Search size={12} className="text-[var(--lore-text-tertiary)]" />
              <span className="text-[12px] text-[var(--lore-text-tertiary)]">Search</span>
              <kbd className="ml-auto rounded border border-[var(--lore-border)] px-1 text-[9px] text-[var(--lore-text-tertiary)]">
                ⌘K
              </kbd>
            </div>
          </div>

          <p className="px-4 pb-1 pt-1 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
            Folders
          </p>
          <div className="px-2.5">
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
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors",
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
                      className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--lore-accent)] px-1 text-[10px] font-semibold text-white"
                    >
                      {pending}
                    </motion.span>
                  ) : (
                    <span className="ml-auto text-[10.5px] text-[var(--lore-text-tertiary)]">
                      {f.pages.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {totalPending === 0 ? (
            <button
              type="button"
              onClick={() => setFolders(INITIAL)}
              className="mx-2.5 mb-3 mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-[var(--lore-border)] py-1.5 text-[11.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              <RotateCcw size={11} />
              Reset demo
            </button>
          ) : null}
        </div>

        {/* ----------------------------------------------------------- main */}
        <div className="lore-scrollbar flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-6">
          {tab === "connections" ? <ConnectionsPane /> : null}
          {tab === "settings" ? <SettingsPane /> : null}

          {tab === "wiki" ? (
            <>
              <h3 className="text-[19px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)] md:text-[22px]">
                {folder.name}
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--lore-text-tertiary)]">
                {folder.pages.length} pages
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
                    className="mt-3.5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--lore-border)] py-1.5 pl-3.5 pr-1.5"
                  >
                    <span
                      className="text-[12px] font-semibold tabular-nums text-[var(--lore-success)]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      +{totals.added}
                    </span>
                    <span
                      className="text-[12px] font-semibold tabular-nums text-[var(--lore-danger)]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      −{totals.removed}
                    </span>
                    <span className="text-[11.5px] text-[var(--lore-text-secondary)]">
                      {totals.count} {totals.count === 1 ? "proposal" : "proposals"}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => resolveAll("reject")}
                      className="rounded-lg px-2 py-1 text-[11.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)]"
                    >
                      Reject all
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveAll("accept")}
                      className="rounded-lg bg-[var(--lore-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
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
                    className="mt-3.5 rounded-xl border border-dashed border-[var(--lore-border)] px-3.5 py-2 text-[11.5px] text-[var(--lore-text-tertiary)]"
                  >
                    Nothing waiting in this folder.
                  </motion.p>
                )}
              </AnimatePresence>

              {folder.pages.map((page, i) => (
                <motion.div
                  key={page.id}
                  layout
                  style={paletteVars(i)}
                  className="pal-rule mt-5"
                >
                  <div className="flex items-center gap-2">
                    <h4 className="pal-title text-[14.5px] font-semibold tracking-[-0.02em]">
                      {page.title}
                    </h4>
                    {page.proposals.length > 0 ? (
                      <span className="pal-chip rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold">
                        {page.proposals.length}{" "}
                        {page.proposals.length === 1 ? "proposal" : "proposals"}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className="mt-0.5 text-[10.5px] text-[var(--lore-text-tertiary)]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    {page.path}
                  </p>

                  <ul className="mt-1.5 space-y-1">
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
                            "rounded px-1 text-[12.5px] leading-relaxed transition-colors duration-700",
                            flash
                              ? "bg-[var(--lore-success)]/14 text-[var(--lore-text-primary)]"
                              : "text-[var(--lore-text-secondary)]",
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
                        className="mt-2.5 overflow-hidden"
                      >
                        <div className="overflow-hidden rounded-lg border border-[var(--lore-border)]">
                          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-2.5 py-1.5">
                            <span className="text-[11.5px] font-semibold text-[var(--lore-text-primary)]">
                              {proposal.agent}
                            </span>
                            <span
                              className={cn(
                                "rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em]",
                                RISK_STYLE[proposal.risk],
                              )}
                            >
                              {proposal.risk}
                            </span>
                            <span className="text-[10.5px] text-[var(--lore-text-tertiary)]">
                              {proposal.kind}
                            </span>
                            <span className="flex-1" />
                            <button
                              type="button"
                              onClick={() => resolve(page.id, proposal.id, "reject")}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface)]"
                            >
                              <X size={10} />
                              Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => resolve(page.id, proposal.id, "accept")}
                              className="inline-flex items-center gap-1 rounded-md bg-[var(--lore-accent)] px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
                            >
                              <Check size={10} />
                              Accept
                            </button>
                          </div>
                          <p className="px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[var(--lore-text-secondary)]">
                            {proposal.reason}
                          </p>
                          <div
                            className="border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5 text-[11px] leading-[1.7]"
                            style={{ fontFamily: "var(--font-mono), monospace" }}
                          >
                            {proposal.replaces !== undefined ? (
                              <div className="rounded bg-[var(--lore-danger)]/10 px-1 text-[var(--lore-danger)]">
                                − {page.lines[proposal.replaces]}
                              </div>
                            ) : (
                              <div className="text-[var(--lore-text-tertiary)]">
                                {"  "}
                                {page.lines[page.lines.length - 1]}
                              </div>
                            )}
                            {proposal.add.map((line) => (
                              <div
                                key={line}
                                className="rounded bg-[var(--lore-success)]/12 px-1 text-[var(--lore-success)]"
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
  );
}

function ConnectionsPane() {
  return (
    <div className="lore-fade-up">
      <h3 className="text-[19px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)] md:text-[22px]">
        Connections
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--lore-text-tertiary)]">
        Two ways in. Wire either one.
      </p>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-[var(--lore-border)] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--lore-accent-tint)] text-[11px] font-semibold text-[var(--lore-accent)]">
              1
            </span>
            <h4 className="text-[13px] font-semibold text-[var(--lore-text-primary)]">
              Drop an index into the vault
            </h4>
          </div>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white">
            <FileDown size={11} />
            Write AGENTS.md
          </span>
        </div>

        <div className="rounded-xl border border-[var(--lore-border)] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--lore-accent-tint)] text-[11px] font-semibold text-[var(--lore-accent)]">
              2
            </span>
            <h4 className="text-[13px] font-semibold text-[var(--lore-text-primary)]">
              Connect over MCP
            </h4>
          </div>
          <div className="mt-2.5 overflow-hidden rounded-lg border border-[var(--lore-border)]">
            <div className="flex items-center justify-between border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-2.5 py-1">
              <span className="text-[10px] text-[var(--lore-text-tertiary)]">.mcp.json</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--lore-text-secondary)]">
                <Copy size={10} />
                Copy
              </span>
            </div>
            <pre
              className="overflow-x-auto bg-[var(--lore-background)] px-2.5 py-2 text-[10.5px] leading-[1.6] text-[var(--lore-text-primary)]"
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
      <h3 className="text-[19px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)] md:text-[22px]">
        Settings
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--lore-text-tertiary)]">
        The folder Lore reads, and what an agent would trip over in it.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} style={paletteVars(s.slot)} className="plate px-3 py-2.5">
            <div className="text-[22px] font-bold leading-none tracking-[-0.04em] tabular-nums">
              {s.value}
            </div>
            <div className="plate-muted mt-1.5 text-[10.5px] font-semibold">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--lore-border)] px-3.5 py-2.5">
        <Activity size={13} className="text-[var(--lore-text-tertiary)]" />
        <span
          className="truncate text-[11.5px] text-[var(--lore-text-secondary)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          ~/Documents/wiki
        </span>
      </div>
    </div>
  );
}
