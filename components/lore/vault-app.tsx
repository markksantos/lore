"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SearchResult, VaultIndex } from "@/lib/types";
import { Sidebar } from "@/components/lore/sidebar";
import { FolderDocument } from "@/components/lore/folder-document";
import { ConnectionsView } from "@/components/lore/connections-view";
import { SettingsView } from "@/components/lore/settings-view";
import { ReviewView } from "@/components/lore/review-view";
import { InsightsView } from "@/components/lore/insights-view";
import { ExploreShell } from "@/components/lore/explore-shell";

export type View = "wiki" | "review" | "insights" | "explore" | "connections" | "settings";

export function VaultApp({
  initialIndex,
  installDir,
}: {
  initialIndex: VaultIndex;
  installDir: string;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [view, setView] = useState<View>("wiki");
  const [folder, setFolder] = useState<string>(initialIndex.folders[0]?.folder ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [needsReview, setNeedsReview] = useState(0);
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
  const refreshPending = useCallback(async () => {
    const response = await fetch("/api/review?days=7");
    if (!response.ok) return;
    const data = await response.json();
    setNeedsReview(
      (data.triage as { trust: string }[]).filter((t) => t.trust !== "verified").length,
    );
  }, []);

  useEffect(() => {
    refreshPending();
    const timer = setInterval(refreshPending, 10_000);
    return () => clearInterval(timer);
  }, [refreshPending]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("wiki");
        document.getElementById("lore-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-svh overflow-hidden bg-[var(--lore-background)]">
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
        needsReview={needsReview}
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

      <main className={view === "explore" ? "min-w-0 flex-1 overflow-hidden" : "lore-scrollbar min-w-0 flex-1 overflow-y-auto"}>
        {view === "wiki" ? (
          <FolderDocument
            key={folder}
            folder={folder}
            revision={revision}
            pageTitles={pageTitles}
            focusPage={focusPage}
            onOpenPage={openPage}
            onChanged={async () => {
              await Promise.all([refresh(), refreshPending()]);
            }}
          />
        ) : null}
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
      </main>
    </div>
  );
}
