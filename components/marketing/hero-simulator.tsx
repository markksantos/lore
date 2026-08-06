"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  BookText,
  Camera,
  ChevronRight,
  Compass,
  Eye,
  History,
  MessageCircleQuestion,
  Newspaper,
  Pause,
  PenLine,
  PanelLeft,
  Play,
  Plug,
  Plus,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Telescope,
  Wand2,
} from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { BrowserChrome } from "@/components/marketing/browser-chrome";
import {
  AskPane,
  BriefPane,
  ChangesPane,
  ChorusPane,
  ConnectionsPane,
  ExplorePane,
  GhostPane,
  InsightsPane,
  LedgerPane,
  OraclePane,
  ProphetPane,
  SettingsPane,
  TimelinePane,
  TwinPane,
  UnderstudyPane,
  WatchPane,
  WikiPane,
  type WikiPage,
} from "@/components/marketing/demo-panes";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The hero product shot — a working replica of the app, not a picture of one.
 *
 * Two rules keep it honest.
 *
 * The chrome is copied, not approximated. The sidebar below has the same two
 * groups in the same order as components/lore/sidebar.tsx, the same "This
 * machine" rule between them, the same search field, the same folder tree with
 * its disclosure arrows and counts, and the same footer. The panes are built
 * out of the application's own Panel/Stats/Button/ConsentSwitch. The previous
 * version drew its own flat list of seventeen items with no grouping and no
 * tree, which is why it read as a menu rather than as software.
 *
 * Every screen resolves to something. Thirteen of the seventeen tabs used to
 * land on a card saying the screen exists in the download — which is the
 * landing page equivalent of a locked door, on the one element whose entire job
 * is to let someone in.
 *
 * Sample content is invented on purpose. This is a public page, and a realistic
 * screenshot is worth nothing if it leaks a real client or a real rate.
 */

type Tab =
  | "brief"
  | "ask"
  | "wiki"
  | "review"
  | "watch"
  | "timeline"
  | "insights"
  | "explore"
  | "connections"
  | "settings"
  | "prophet"
  | "ghost"
  | "ledger"
  | "oracle"
  | "understudy"
  | "twin"
  | "chorus";

/** Copied from the app's VIEW_LABEL, in the app's own order. */
const LABEL: Record<Tab, string> = {
  brief: "Brief",
  ask: "Ask",
  wiki: "Wiki",
  review: "Changes",
  watch: "Watch",
  timeline: "Timeline",
  insights: "Insights",
  explore: "Explore",
  connections: "Connections",
  settings: "Settings",
  prophet: "Prophet",
  ghost: "Ghost",
  ledger: "Ledger",
  oracle: "Oracle",
  understudy: "Understudy",
  twin: "Twin",
  chorus: "Chorus",
};

const NAV: { id: Tab; icon: typeof BookText }[] = [
  { id: "brief", icon: Newspaper },
  { id: "ask", icon: MessageCircleQuestion },
  { id: "wiki", icon: BookText },
  { id: "review", icon: ShieldCheck },
  { id: "watch", icon: Eye },
  { id: "timeline", icon: Camera },
  { id: "insights", icon: BarChart3 },
  { id: "explore", icon: Compass },
  { id: "connections", icon: Plug },
  { id: "settings", icon: Settings },
];

const OBSERVER_NAV: { id: Tab; icon: typeof BookText }[] = [
  { id: "prophet", icon: Bell },
  { id: "ghost", icon: Telescope },
  { id: "ledger", icon: History },
  { id: "oracle", icon: Search },
  { id: "understudy", icon: PenLine },
  { id: "twin", icon: Wand2 },
  { id: "chorus", icon: Scale },
];

/** The observers with a green dot in this shot — the ones the panes show as on. */
const RUNNING: Tab[] = ["prophet", "ghost", "ledger", "oracle", "understudy", "twin"];

// ------------------------------------------------------------------- folders

type FolderNode = { path: string; name: string; depth: number; count: number; children: string[] };

/*
 * The counts have to add up.
 *
 * They briefly did not: five folders totalling fourteen pages under a footer
 * that said "1,412 pages". Anybody who bothered to add them up found the shot
 * lying about the only thing it was measuring, which is a bad trade for a
 * bigger-sounding number. These sum to TOTAL_PAGES below, and the wiki pane
 * says it is showing a slice rather than the whole folder.
 */
const TREE: FolderNode[] = [
  { path: "stack", name: "stack", depth: 0, count: 118, children: ["stack/runtime"] },
  { path: "stack/runtime", name: "runtime", depth: 1, count: 26, children: [] },
  { path: "operating", name: "operating", depth: 0, count: 74, children: [] },
  { path: "clients", name: "clients", depth: 0, count: 209, children: [] },
  { path: "projects", name: "projects", depth: 0, count: 61, children: [] },
];

/** Sum of the top-level folders, so the footer agrees with the tree. */
const TOTAL_PAGES = TREE.filter((node) => node.depth === 0).reduce((n, node) => n + node.count, 0);

const PAGES: Record<string, WikiPage[]> = {
  stack: [
    {
      id: "deploy",
      title: "Deploy pipeline",
      path: "stack/deploy-pipeline.md",
      inbound: 14,
      lines: [
        "Push to main deploys to production behind a five-minute canary.",
        "Rollback is one command and does not need a build.",
      ],
    },
    {
      id: "postgres",
      title: "Postgres notes",
      path: "stack/postgres-notes.md",
      inbound: 6,
      lines: [
        "Running Postgres 18. Pooling lives in the application layer.",
        "Migrations are forward-only. There is no down migration.",
      ],
    },
    {
      id: "auth",
      title: "Auth decisions",
      path: "stack/auth-decisions.md",
      inbound: 9,
      lines: [
        "Session cookies over JWTs. Revocation was the deciding factor.",
        "Sessions live 30 days and refresh on use.",
      ],
    },
    {
      id: "glossary",
      title: "Glossary",
      path: "stack/glossary.md",
      inbound: 11,
      lines: ["Shared vocabulary for everything under stack."],
    },
  ],
  "stack/runtime": [
    {
      id: "node",
      title: "Node version",
      path: "stack/runtime/node.md",
      inbound: 3,
      lines: ["Node 22 everywhere. The desktop build pins the same major."],
    },
    {
      id: "queues",
      title: "Queues",
      path: "stack/runtime/queues.md",
      inbound: 2,
      lines: ["One queue, at-least-once, idempotent handlers or it does not ship."],
    },
  ],
  operating: [
    {
      id: "rhythm",
      title: "Weekly rhythm",
      path: "operating/weekly-rhythm.md",
      inbound: 3,
      lines: ["Deep work 7–11am, no meetings before noon.", "Ship Monday through Wednesday."],
    },
    {
      id: "checklist",
      title: "Review checklist",
      path: "operating/review-checklist.md",
      inbound: 5,
      lines: ["Read the description first, then skim the diff."],
    },
    {
      id: "postmortems",
      title: "Postmortems",
      path: "operating/postmortems.md",
      inbound: 2,
      lines: ["One page per incident. No blame, no summary paragraph."],
    },
  ],
  clients: [
    {
      id: "pricing",
      title: "Pricing policy",
      path: "clients/pricing.md",
      inbound: 21,
      lines: [
        "Retainers bill on the fifteenth. Project work bills half up front.",
        "A discount attaches to the subscription, never to a single job.",
      ],
    },
    {
      id: "onboarding",
      title: "Client onboarding",
      path: "clients/onboarding.md",
      inbound: 4,
      lines: ["Written scope first, kickoff call once it is signed."],
    },
    {
      id: "vendors",
      title: "Vendors",
      path: "clients/vendors.md",
      inbound: 3,
      lines: ["Who we buy from, on what terms, and who owns the relationship."],
    },
  ],
  projects: [
    {
      id: "atlas",
      title: "Atlas",
      path: "projects/atlas.md",
      inbound: 2,
      lines: ["Internal mapping tool. Paused pending a decision on auth."],
    },
    {
      id: "beacon",
      title: "Beacon",
      path: "projects/beacon.md",
      inbound: 1,
      lines: ["Status page. Ships behind a flag until the incident feed is real."],
    },
  ],
};

// ---------------------------------------------------------------------- tour

/**
 * The screens the shot plays through on its own.
 *
 * Most people never click a product demo. They look at it for two seconds and
 * scroll, and a static screenshot is what they take away. The tour makes those
 * two seconds show the thing that is hardest to explain in a headline — that
 * this is seven different screens over the same folder — and stops the moment
 * anybody touches it, because an auto-advancing UI that fights the person using
 * it is worse than no motion at all.
 */
const TOUR: Tab[] = ["brief", "ghost", "oracle", "ledger", "ask", "twin", "chorus", "wiki"];
const TOUR_MS = 4600;

export function HeroSimulator({ fullHeight = false }: { fullHeight?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>("brief");
  const [folder, setFolder] = useState("stack");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["stack"]));
  /* null once the visitor takes over — the tour never restarts itself. */
  const [tourStep, setTourStep] = useState<number | null>(0);
  const [paused, setPaused] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const take = useCallback((next: Tab) => {
    setTourStep(null);
    setTab(next);
  }, []);

  /* Reduced motion means no tour at all. Someone who has asked the operating
     system to stop moving things has not asked for an exception for adverts. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (query.matches) setTourStep(null);
  }, []);

  useEffect(() => {
    if (tourStep === null || paused) return;
    const timer = window.setTimeout(() => {
      const next = (tourStep + 1) % TOUR.length;
      setTourStep(next);
      setTab(TOUR[next]);
    }, TOUR_MS);
    return () => window.clearTimeout(timer);
  }, [tourStep, paused]);

  /* A new screen starts at its own top. Landing halfway down Ghost because the
     previous pane was long is the single most disorienting thing this can do. */
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);

  const rows = useMemo(
    () => TREE.filter((node) => node.depth === 0 || expanded.has(node.path.split("/")[0])),
    [expanded],
  );

  const pane = useMemo(() => {
    switch (tab) {
      case "brief":
        return <BriefPane />;
      case "ask":
        return <AskPane />;
      case "wiki":
        return (
          <WikiPane
            folder={folder}
            pages={PAGES[folder] ?? []}
            total={TREE.find((node) => node.path === folder)?.count ?? 0}
          />
        );
      case "review":
        return <ChangesPane />;
      case "watch":
        return <WatchPane />;
      case "timeline":
        return <TimelinePane />;
      case "insights":
        return <InsightsPane />;
      case "explore":
        return <ExplorePane />;
      case "connections":
        return <ConnectionsPane />;
      case "settings":
        return <SettingsPane />;
      case "prophet":
        return <ProphetPane />;
      case "ghost":
        return <GhostPane />;
      case "ledger":
        return <LedgerPane />;
      case "oracle":
        return <OraclePane />;
      case "understudy":
        return <UnderstudyPane />;
      case "twin":
        return <TwinPane />;
      case "chorus":
        return <ChorusPane />;
    }
  }, [tab, folder]);

  const navButton = (item: { id: Tab; icon: typeof BookText }, live?: boolean) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => take(item.id)}
        aria-current={tab === item.id ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
          tab === item.id
            ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
            : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
        )}
      >
        <Icon size={15} className="opacity-80" />
        <span className="min-w-0 flex-1 truncate text-left">{LABEL[item.id]}</span>
        {live ? (
          <span
            title="Running"
            aria-label="running"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--lore-success)]"
          />
        ) : null}
      </button>
    );
  };

  return (
    <div
      className="overflow-hidden rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] shadow-[0_40px_100px_-45px_rgba(15,23,42,0.55)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <BrowserChrome url="lore.md" />

      <div
        className={
          fullHeight
            ? "flex h-[calc(100svh-9rem)] min-h-[560px]"
            : "flex h-[620px] sm:h-[760px] lg:h-[860px]"
        }
      >
        {/* -------------------------------------------------------- sidebar */}
        <div className="hidden w-[224px] shrink-0 flex-col overflow-hidden border-r border-[var(--lore-border)] bg-[var(--lore-surface)] sm:flex">
          <div className="flex shrink-0 items-center gap-1 px-4 pb-3 pt-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 pl-1 text-[var(--lore-text-primary)]">
              <BrandMark size={18} />
              <span className="truncate text-[14px] font-semibold tracking-[-0.02em]">wiki</span>
            </div>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--lore-text-tertiary)]">
              <PanelLeft size={15} />
            </span>
          </div>

          {/*
            * Everything between the brand and the footer scrolls as one column.
            *
            * Seventeen screens, a search field and a folder tree do not fit in
            * a sidebar at any laptop height, and the version that let each
            * region keep its own height simply sliced the last one in half at
            * the card's edge. The app has the same constraint and solves it the
            * same way.
            */}
          <div className="lore-scrollbar min-h-0 flex-1 overflow-y-auto">
          <nav className="space-y-0.5 px-3" aria-label="Wiki">
            {NAV.map((item) => navButton(item))}
          </nav>

          {/* The rule and the label are the most important two elements in this
              sidebar: everything below them reads this machine rather than the
              wiki, and every one is off until switched on. */}
          <div className="mt-3 border-t border-[var(--lore-border)] px-3 pt-3">
            <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
              This machine
            </p>
            <nav className="space-y-0.5" aria-label="This machine">
              {OBSERVER_NAV.map((item) => navButton(item, RUNNING.includes(item.id)))}
            </nav>
          </div>

          <div className="px-3 pb-2 pt-4">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--lore-text-tertiary)]"
              />
              <div className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] py-2 pl-8 pr-10 text-[13px] text-[var(--lore-text-tertiary)]">
                Search
              </div>
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--lore-text-tertiary)]">
                /
              </kbd>
            </div>
          </div>

          <div className="px-3 pb-3">
            <div className="mb-1.5 mt-1 flex items-center gap-2 px-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
                Folders
              </p>
              <span className="text-[10px] text-[var(--lore-text-tertiary)]">{TREE.length}</span>
            </div>

            {rows.map((node, i) => {
              const hasChildren = node.children.length > 0;
              const isOpen = expanded.has(node.path);
              return (
                <div
                  key={node.path}
                  style={paletteVars(i)}
                  className={cn(
                    "flex items-center rounded-lg transition-colors",
                    folder === node.path && tab === "wiki"
                      ? "bg-[var(--lore-surface-selected)] text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                  )}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}`}
                      aria-expanded={isOpen}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(node.path)) next.delete(node.path);
                          else next.add(node.path);
                          return next;
                        })
                      }
                      className="flex h-7 w-5 shrink-0 items-center justify-center"
                      style={{ marginLeft: `${node.depth * 10}px` }}
                    >
                      <ChevronRight
                        size={12}
                        className={cn(
                          "text-[var(--lore-text-tertiary)] transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                    </button>
                  ) : (
                    <span
                      aria-hidden
                      className="flex h-7 w-5 shrink-0 items-center justify-center"
                      style={{ marginLeft: `${node.depth * 10}px` }}
                    >
                      <span className="pal-dot" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setFolder(node.path);
                      take("wiki");
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-left text-[13px]"
                  >
                    <span className={cn("truncate", folder === node.path && "font-medium")}>
                      {node.name}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-[var(--lore-text-tertiary)]">
                      {node.count}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          </div>

          <div className="shrink-0 border-t border-[var(--lore-border)] p-3">
            <span className="flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--lore-text-secondary)]">
              <Plus size={14} />
              New page
            </span>
            <p className="t-meta mt-2 px-2 text-[var(--lore-text-tertiary)]">
              {TOTAL_PAGES.toLocaleString()} pages · scanned just now
            </p>
          </div>
        </div>

        {/* ----------------------------------------------------------- main */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* On a phone the sidebar is gone, so the screens need their own way
              of being reachable — the same reason the app has a top bar there. */}
          <div className="lore-scrollbar flex gap-1 overflow-x-auto border-b border-[var(--lore-border)] px-3 py-2 sm:hidden">
            {[...NAV, ...OBSERVER_NAV].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => take(item.id)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[12.5px] transition-colors",
                  tab === item.id
                    ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                    : "text-[var(--lore-text-secondary)]",
                )}
              >
                {LABEL[item.id]}
              </button>
            ))}
          </div>

          <div ref={scroller} className="lore-scrollbar min-h-0 flex-1 overflow-y-auto">
            {pane}
          </div>

          {tourStep !== null ? <TourBar step={tourStep} paused={paused} onStop={() => setTourStep(null)} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The tour's own controls.
 *
 * Anything that moves on its own needs a stop button within reach of the thing
 * that is moving — WCAG asks for it, and a demo that cannot be held still is a
 * demo nobody can read.
 */
function TourBar({
  step,
  paused,
  onStop,
}: {
  step: number;
  paused: boolean;
  onStop: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--lore-border)] bg-[var(--lore-surface)]/95 py-1.5 pl-3 pr-1.5 shadow-[0_8px_28px_-12px_rgba(15,23,42,0.45)] backdrop-blur">
        <span className="t-meta whitespace-nowrap text-[var(--lore-text-tertiary)]">
          {paused ? "Paused — click any screen" : "Touring the app"}
        </span>
        <span className="flex items-center gap-1">
          {TOUR.map((id, i) => (
            <span
              key={id}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === step ? "w-4 bg-[var(--lore-accent)]" : "w-1.5 bg-[var(--lore-border-strong)]",
              )}
            />
          ))}
        </span>
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop the tour"
          title="Stop the tour"
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      </div>
    </div>
  );
}
