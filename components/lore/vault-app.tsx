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
import { ExploreShell } from "@/components/lore/explore-shell";
import { ConnectionsView } from "@/components/lore/connections-view";

export type View =
  | "brief"
  | "ask"
  | "wiki"
  | "review"
  | "insights"
  | "explore"
  | "connections"
  | "settings";

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
      {view === "brief" ? <BriefView onOpenPage={openPage} /> : null}
      {view === "ask" ? <AskView onOpenPage={openPage} /> : null}
      {view === "review" ? <ReviewView onOpenPage={openPage} /> : null}
      {view === "insights" ? <InsightsView onOpenPage={openPage} /> : null}
      {view === "explore" ? (
        <ExploreShell index={index} pageTitles={pageTitles} onOpenPage={openPage} />
      ) : null}
      {view === "connections" ? (
        <ConnectionsView root={index.root} installDir={installDir} />
      ) : null}
      {view === "settings" ? (
        <SettingsView index={index} onOpenPage={openPage} onChanged={refresh} />
      ) : null}
    </AppShell>
  );
}
