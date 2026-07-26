"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PageMeta, SearchResult, VaultIndex } from "@/lib/types";
import { Sidebar } from "@/components/lore/sidebar";
import { PageView } from "@/components/lore/page-view";
import { ReviewView } from "@/components/lore/review-view";
import { HealthView } from "@/components/lore/health-view";
import { AgentsView } from "@/components/lore/agents-view";

export type View = "pages" | "review" | "health" | "agents";

export function VaultApp({
  initialIndex,
  installDir,
}: {
  initialIndex: VaultIndex;
  installDir: string;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [view, setView] = useState<View>("pages");
  const [selected, setSelected] = useState<string | null>(
    initialIndex.pages[0]?.relPath ?? null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshIndex = useCallback(async () => {
    const response = await fetch("/api/pages?refresh=1");
    if (response.ok) setIndex(await response.json());
  }, []);

  const refreshPending = useCallback(async () => {
    const response = await fetch("/api/proposals");
    if (!response.ok) return;
    const data = await response.json();
    setPendingCount(
      (data.proposals ?? []).filter((p: { status: string }) => p.status === "pending").length,
    );
  }, []);

  useEffect(() => {
    refreshPending();
    // Agents propose in the background while the app is open, so the queue
    // badge polls. 10s is slow enough to be free and fast enough that a
    // proposal never feels lost.
    const timer = setInterval(refreshPending, 10_000);
    return () => clearInterval(timer);
  }, [refreshPending]);

  // Debounced search. Runs against the server index rather than the client
  // page list because the body text never crosses the wire.
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

  const openPage = useCallback(
    (page: PageMeta | string) => {
      const relPath =
        typeof page === "string"
          ? (index.pages.find((p) => p.id === page)?.relPath ?? null)
          : page.relPath;
      if (!relPath) return;
      setSelected(relPath);
      setView("pages");
    },
    [index.pages],
  );

  // Cmd-K focuses search from anywhere, including mid-edit.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
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
        selected={selected}
        onSelect={openPage}
        query={query}
        onQuery={setQuery}
        results={results}
        pendingCount={pendingCount}
        onCreated={async (relPath) => {
          await refreshIndex();
          setSelected(relPath);
          setView("pages");
        }}
      />

      <main className="lore-scrollbar flex-1 overflow-y-auto">
        {view === "pages" ? (
          <PageView
            relPath={selected}
            pageTitles={pageTitles}
            index={index}
            onOpen={openPage}
            onSaved={refreshIndex}
          />
        ) : null}
        {view === "review" ? (
          <ReviewView
            onResolved={async () => {
              await Promise.all([refreshIndex(), refreshPending()]);
            }}
            onOpen={(relPath) => {
              setSelected(relPath);
              setView("pages");
            }}
          />
        ) : null}
        {view === "health" ? <HealthView onOpen={openPage} /> : null}
        {view === "agents" ? <AgentsView root={index.root} installDir={installDir} /> : null}
      </main>
    </div>
  );
}
