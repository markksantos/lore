"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SearchResult, VaultIndex } from "@/lib/types";
import { AppShell } from "@/components/lore/app-shell";
import { Sidebar, VIEW_LABEL } from "@/components/lore/sidebar";
import { FolderDocument } from "@/components/lore/folder-document";
import { SettingsView } from "@/components/lore/settings-view";
import { BriefView } from "@/components/lore/brief-view";
import { AskView } from "@/components/lore/ask-view";
import { ReviewView } from "@/components/lore/review-view";
import { InsightsView } from "@/components/lore/insights-view";
import { WatchView } from "@/components/lore/watch-view";
import { Palette } from "@/components/lore/palette";
import { TimelineDesktopView } from "@/components/lore/timeline-desktop-view";
import { ExploreShell } from "@/components/lore/explore-shell";
import { ConnectionsView } from "@/components/lore/connections-view";
import { desktopBridge } from "@/lib/desktop";
import { NeedsTheApp, OBSERVER_BLURB } from "@/components/lore/needs-the-app";
import { isBrowserVault } from "@/lib/browser-api";
import { GhostView } from "@/components/lore/ghost-view";
import { LedgerView } from "@/components/lore/ledger-view";
import { OracleView } from "@/components/lore/oracle-view";
import { ChorusView } from "@/components/lore/chorus-view";
import { TwinView } from "@/components/lore/twin-view";
import { UnderstudyView } from "@/components/lore/understudy-view";
import { ProphetView } from "@/components/lore/prophet-view";

export type View =
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
  /* The observers. These read this machine rather than the wiki, and each is
     off until switched on — see lib/observers.ts, which is the single place
     that decides whether any of them may run. */
  | "prophet"
  | "ghost"
  | "ledger"
  | "oracle"
  | "chorus"
  | "understudy"
  | "twin";

/**
 * Every view name, as data.
 *
 * The type alone cannot validate a string that arrived from a URL or from the
 * desktop shell, and `setView(anything as View)` would put the router into a
 * state that renders nothing at all — a blank screen with no error. This is the
 * runtime half of the same list, and the `satisfies` keeps the two in step: a
 * view added to the union and forgotten here is a compile error.
 */
export const VIEW_NAMES = [
  "brief",
  "ask",
  "wiki",
  "review",
  "watch",
  "timeline",
  "insights",
  "explore",
  "connections",
  "settings",
  "prophet",
  "ghost",
  "ledger",
  "oracle",
  "chorus",
  "understudy",
  "twin",
] as const satisfies readonly View[];

/*
 * `satisfies` proves every entry is a view. This proves every view is an entry.
 *
 * Without it the list can silently fall behind the union, and the symptom is a
 * deep link or a hotkey that does nothing for exactly one screen — which is
 * both hard to notice and hard to attribute. Adding a view without adding it
 * here now fails the typecheck.
 */
type MissingFromViewNames = Exclude<View, (typeof VIEW_NAMES)[number]>;
const _everyViewIsNamed: MissingFromViewNames extends never ? true : never = true;
void _everyViewIsNamed;

export function VaultApp({
  initialIndex,
  installDir,
}: {
  initialIndex: VaultIndex;
  installDir: string;
}) {
  const [index, setIndex] = useState(initialIndex);
    /* The brief is home. Opening on the document put you inside a folder you did
     not choose, on a wiki too big to browse — the first screen has to tell you
     something rather than wait for you to go looking. */
  const [view, setView] = useState<View>("brief");
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * A question handed to Ask from somewhere else.
   *
   * The palette can send you to Ask with the line you already typed, and Ask
   * cannot receive that as a prop it re-reads — the same question asked twice
   * should ask twice. A monotonically increasing key makes each hand-off a
   * distinct event rather than a value to compare.
   */
  const [handoff, setHandoff] = useState<{ question: string; key: number } | null>(null);
  /*
   * Resolved after mount, never during render.
   *
   * The server renders this component too (the desktop half is a real Next
   * app), and there `isBrowserVault()` is false while in the browser vault it
   * is true — reading it during render is a hydration mismatch by construction.
   */
  const [browserVault, setBrowserVault] = useState(false);
  useEffect(() => setBrowserVault(isBrowserVault()), []);

  /*
   * ⌘K anywhere, except while typing into something.
   *
   * Bound at the document because the palette's whole value is that it works
   * without first clicking the right pane. Meta+K is not a browser shortcut on
   * either platform, so nothing is stolen from the user.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  /*
   * Two ways in from outside the app, both landing here.
   *
   * `?view=ghost` makes every screen linkable, which is what the desktop
   * shell's first navigation uses — the window is created pointed at /vault and
   * there is no renderer listening yet. After that the IPC channel is used
   * instead, because it does not reload the page and therefore does not throw
   * away a half-written draft.
   */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("view");
    if (wanted && (VIEW_NAMES as readonly string[]).includes(wanted)) {
      setView(wanted as View);
    }
    const bridge = desktopBridge();
    if (!bridge?.onNavigate) return;
    return bridge.onNavigate((next) => {
      if ((VIEW_NAMES as readonly string[]).includes(next)) setView(next as View);
    });
  }, []);

  const [folder, setFolder] = useState<string>(initialIndex.folders[0]?.folder ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  /** Bumped to tell the open folder document to reload itself. */
  const [revision, setRevision] = useState(0);
  /** Set when search picks a page, so the document scrolls to it. */
  const [focusPage, setFocusPage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/pages?refresh=1");
    if (response.ok) setIndex(await response.json());
    setRevision((r) => r + 1);
  }, []);

  /**
   * How many pages changed recently but nobody has signed off on. This is the
   * badge that replaced the old proposal queue: it counts what happened rather
   * than what is waiting for permission, because nothing waits for permission.
   */


  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (response.ok) setResults((await response.json()).results);
    }, 140);
    return () => clearTimeout(timer);
  }, [query]);

  const pageTitles = useMemo(
    () => new Map(index.pages.map((p) => [p.id, p.title])),
    [index.pages],
  );

  /** Open the folder a page lives in and scroll its section into view. */
  const openPage = useCallback(
    (pageId: string) => {
      const page = index.pages.find((p) => p.id === pageId);
      if (!page) return;
      setView("wiki");
      setFolder(page.folder);
      setFocusPage(page.relPath);
      setQuery("");
    },
    [index.pages],
  );

  /* The mobile top bar has one line to say where you are. On the wiki that is
     the folder you are reading — its last segment, since a nested path spends
     the whole line on ancestors and truncates the part that identifies it. */
  const title =
    view === "wiki" ? folder.split("/").pop() || "Root" : VIEW_LABEL[view];

  return (
    <AppShell
      title={title}
      titleHint={view === "wiki" ? folder || "Root" : undefined}
      onSearchShortcut={() => setView("wiki")}
      sidebar={
        <Sidebar
          index={index}
          view={view}
          onView={setView}
          folder={folder}
          onFolder={(next) => {
            setFolder(next);
            setView("wiki");
            setFocusPage(null);
          }}
              query={query}
          onQuery={setQuery}
          results={results}
          onOpenPage={openPage}
          onCreated={async (relPath) => {
            await refresh();
            const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
            setFolder(dir);
            setView("wiki");
            setFocusPage(relPath);
          }}
        />
      }
    >
      {view === "wiki" ? (
        <FolderDocument
          key={folder}
          folder={folder}
          revision={revision}
          index={index}
          pageTitles={pageTitles}
          focusPage={focusPage}
          onOpenPage={openPage}
          onChanged={async () => {
            await refresh();
          }}
        />
      ) : null}
      {view === "brief" ? <BriefView onOpenPage={openPage} onNavigate={setView} /> : null}
      {view === "ask" ? <AskView onOpenPage={openPage} handoff={handoff} /> : null}
      {view === "review" ? <ReviewView onOpenPage={openPage} /> : null}
      {view === "watch" ? <WatchView onOpenPage={openPage} /> : null}
      {view === "timeline" ? <TimelineDesktopView /> : null}

      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenPage={openPage}
        onGoTo={setView}
        onAsk={(question) => {
          setHandoff({ question, key: Date.now() });
          setView("ask");
        }}
      />
      {view === "insights" ? <InsightsView onOpenPage={openPage} /> : null}
      {view === "explore" ? (
        <ExploreShell index={index} pageTitles={pageTitles} onOpenPage={openPage} />
      ) : null}
      {view === "connections" ? (
        <ConnectionsView root={index.root} installDir={installDir} />
      ) : null}
      {view === "settings" ? (
        <SettingsView
          index={index}
          onOpenPage={openPage}
          onChanged={refresh}
          onOpenView={(next) => {
            if ((VIEW_NAMES as readonly string[]).includes(next)) setView(next as View);
          }}
        />
      ) : null}

      {/*
        * The observers.
        *
        * Each is mounted only while it is the current view. They poll their own
        * status while open — Ghost every eight seconds, Prophet every minute —
        * and keeping seven of those alive behind a hidden tab would be seven
        * timers doing nothing useful for the whole session.
        */}
      {/*
        * In a browser tab, five of the seven cannot run and should not pretend
        * to. Caught here rather than inside each view: the alternative is seven
        * copies of the same check, and the failure mode of forgetting one is a
        * screen that spins on a request the shim will never answer.
        *
        * Understudy is deliberately NOT in this list. Its measurements are pure
        * arithmetic over pages this tab already has, so it works here for real.
        */}
      {browserVault && view in OBSERVER_BLURB && view !== "understudy" ? (
        <NeedsTheApp feature={view as keyof typeof OBSERVER_BLURB} />
      ) : (
        <>
          {view === "prophet" ? <ProphetView onNavigate={(next) => setView(next as View)} /> : null}
          {view === "ghost" ? <GhostView /> : null}
          {view === "ledger" ? <LedgerView /> : null}
          {view === "oracle" ? <OracleView /> : null}
          {view === "chorus" ? <ChorusView /> : null}
          {view === "understudy" ? <UnderstudyView /> : null}
          {view === "twin" ? <TwinView /> : null}
        </>
      )}
    </AppShell>
  );
}
