"use client";

import { useState } from "react";
import { Search, Plus, BookText, Plug, Settings, Sun, Moon } from "lucide-react";
import type { SearchResult, VaultIndex } from "@/lib/types";
import type { View } from "@/components/lore/vault-app";
import { BrandMark } from "@/components/marketing/brand-mark";
import { useTheme } from "@/components/lore/theme-provider";
import { colorForIndex } from "@/lib/palette";
import { cn, formatCount, relativeTime } from "@/lib/utils";

const NAV: { id: View; label: string; icon: typeof BookText }[] = [
  { id: "wiki", label: "Wiki", icon: BookText },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  index,
  view,
  onView,
  folder,
  onFolder,
  pendingByFolder,
  query,
  onQuery,
  results,
  onOpenPage,
  onCreated,
}: {
  index: VaultIndex;
  view: View;
  onView: (view: View) => void;
  folder: string;
  onFolder: (folder: string) => void;
  pendingByFolder: Record<string, number>;
  query: string;
  onQuery: (value: string) => void;
  results: SearchResult[] | null;
  onOpenPage: (pageId: string) => void;
  onCreated: (relPath: string) => void;
}) {
  const { theme, toggle } = useTheme();
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function createPage() {
    const target = newPath.trim();
    if (!target) return;
    setError(null);

    const title = target.split("/").pop()?.replace(/\.mdx?$/i, "") ?? "Untitled";
    const response = await fetch("/api/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: target, content: `# ${title}\n\n` }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Could not create that page.");
      return;
    }
    setCreating(false);
    setNewPath("");
    onCreated(data.path);
  }

  return (
    <aside className="flex w-[15.5rem] shrink-0 flex-col border-r border-[var(--lore-border)] bg-[var(--lore-surface)]">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-2 text-[var(--lore-text-primary)]">
          <BrandMark size={18} />
          <span className="truncate text-[14px] font-semibold tracking-[-0.02em]">
            {index.name}
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="rounded-md p-1.5 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      {/* Three destinations, exactly. Everything about the wiki itself lives in
          the document; Connections is how agents get in; Settings is the vault
          and its health. A fourth tab would mean the document isn't enough. */}
      <nav className="space-y-0.5 px-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors",
                view === item.id
                  ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                  : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
              )}
            >
              <Icon size={15} className="opacity-80" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-3 pb-2 pt-4">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--lore-text-tertiary)]"
          />
          <input
            id="lore-search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search"
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] py-2 pl-8 pr-10 text-[13px] text-[var(--lore-text-primary)] outline-none transition-colors placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)]"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--lore-text-tertiary)]">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="lore-scrollbar flex-1 overflow-y-auto px-3 pb-3">
        {results ? (
          <SearchResults results={results} onOpenPage={onOpenPage} />
        ) : (
          <>
            <p className="mb-1.5 mt-1 px-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
              Folders
            </p>
            {index.folders.map((entry, i) => {
              const pending = pendingByFolder[entry.folder] ?? 0;
              return (
                <button
                  key={entry.folder || "__root"}
                  type="button"
                  onClick={() => onFolder(entry.folder)}
                  style={colorForIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                    folder === entry.folder
                      ? "bg-[var(--lore-surface-selected)] font-medium text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
                  )}
                >
                  <span className="pal-dot" />
                  <span className="truncate">{entry.folder || "Root"}</span>
                  {pending > 0 ? (
                    <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--lore-accent)] px-1 text-[10px] font-semibold text-white">
                      {pending}
                    </span>
                  ) : (
                    <span className="ml-auto text-[11px] text-[var(--lore-text-tertiary)]">
                      {entry.count}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>

      <div className="border-t border-[var(--lore-border)] p-3">
        {creating ? (
          <div>
            <input
              value={newPath}
              onChange={(event) => setNewPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createPage();
                if (event.key === "Escape") {
                  setCreating(false);
                  setError(null);
                }
              }}
              placeholder={folder ? `${folder}/new-page.md` : "new-page.md"}
              autoFocus
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[12.5px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            />
            {error ? <p className="t-meta mt-1.5 text-[var(--lore-danger)]">{error}</p> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setNewPath(folder ? `${folder}/` : "");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            <Plus size={14} />
            New page
          </button>
        )}

        <p className="t-meta mt-2 px-2 text-[var(--lore-text-tertiary)]">
          {formatCount(index.pages.length)} pages · scanned {relativeTime(index.scannedAt)}
        </p>
      </div>
    </aside>
  );
}

function SearchResults({
  results,
  onOpenPage,
}: {
  results: SearchResult[];
  onOpenPage: (pageId: string) => void;
}) {
  if (results.length === 0) {
    return (
      <p className="t-meta px-2 py-6 text-center text-[var(--lore-text-tertiary)]">
        Nothing matches.
      </p>
    );
  }

  return (
    <div className="space-y-1 pt-1">
      {results.map((result) => (
        <button
          key={result.page.relPath}
          type="button"
          onClick={() => onOpenPage(result.page.id)}
          className="block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
        >
          <span className="block truncate text-[13px] font-medium text-[var(--lore-text-primary)]">
            {result.page.title}
          </span>
          {result.snippet ? (
            <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-[var(--lore-text-tertiary)]">
              {result.snippet}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
