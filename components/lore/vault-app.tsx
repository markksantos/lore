"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SearchResult, VaultIndex } from "@/lib/types";
import { Sidebar } from "@/components/lore/sidebar";
import { FolderDocument } from "@/components/lore/folder-document";
import { ConnectionsView } from "@/components/lore/connections-view";
import { SettingsView } from "@/components/lore/settings-view";

export type View = "wiki" | "connections" | "settings";

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
  const [pendingByFolder, setPendingByFolder] = useState<Record<string, number>>({});
  /** Bumped to tell the open folder document to reload itself. */
  const [revision, setRevision] = useState(0);
  /** Set when search picks a page, so the document scrolls to it. */
  const [focusPage, setFocusPage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/pages?refresh=1");
    if (response.ok) setIndex(await response.json());
    setRevision((r) => r + 1);
  }, []);

  // Pending counts per folder drive the sidebar badges. Agents propose while
  // the app sits open, so this polls; 10s is free and nothing feels lost.
  const refreshPending = useCallback(async () => {
    const response = await fetch("/api/proposals");
    if (!response.ok) return;
    const { proposals } = await response.json();
    const counts: Record<string, number> = {};
    for (const p of proposals as { status: string; relPath: string }[]) {
      if (p.status !== "pending") continue;
      const dir = p.relPath.includes("/")
        ? p.relPath.slice(0, p.relPath.lastIndexOf("/"))
        : "";
      counts[dir] = (counts[dir] ?? 0) + 1;
    }
    setPendingByFolder(counts);
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
        pendingByFolder={pendingByFolder}
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

      <main className="lore-scrollbar flex-1 overflow-y-auto">
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
