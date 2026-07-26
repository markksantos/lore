"use client";

import { useMemo, useState } from "react";
import {
  Search,
  FileText,
  ChevronRight,
  Plus,
  Inbox,
  Activity,
  Plug,
  BookText,
  Sun,
  Moon,
} from "lucide-react";
import type { PageMeta, SearchResult, VaultIndex } from "@/lib/types";
import type { View } from "@/components/lore/vault-app";
import { BrandMark } from "@/components/marketing/brand-mark";
import { useTheme } from "@/components/lore/theme-provider";
import { cn, formatCount, relativeTime } from "@/lib/utils";

const NAV: { id: View; label: string; icon: typeof BookText }[] = [
  { id: "pages", label: "Pages", icon: BookText },
  { id: "review", label: "Review", icon: Inbox },
  { id: "health", label: "Health", icon: Activity },
  { id: "agents", label: "Agents", icon: Plug },
];

export function Sidebar({
  index,
  view,
  onView,
  selected,
  onSelect,
  query,
  onQuery,
  results,
  pendingCount,
  onCreated,
}: {
  index: VaultIndex;
  view: View;
  onView: (view: View) => void;
  selected: string | null;
  onSelect: (page: PageMeta) => void;
  query: string;
  onQuery: (value: string) => void;
  results: SearchResult[] | null;
  pendingCount: number;
  onCreated: (relPath: string) => void;
}) {
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, PageMeta[]>();
    for (const page of index.pages) {
      map.set(page.folder, [...(map.get(page.folder) ?? []), page]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [index.pages]);

  function toggleFolder(folder: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  async function createPage() {
    const target = newPath.trim();
    if (!target) return;
    setCreateError(null);

    const title = target.split("/").pop()?.replace(/\.mdx?$/i, "") ?? "Untitled";
    const response = await fetch("/api/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: target, content: `# ${title}\n\n` }),
    });
    const data = await response.json();

    if (!response.ok) {
      setCreateError(data.error ?? "Could not create that page.");
      return;
    }
    setCreating(false);
    setNewPath("");
    onCreated(data.path);
  }

  return (
    <aside className="flex w-[16.5rem] shrink-0 flex-col border-r border-[var(--lore-border)] bg-[var(--lore-surface)]">
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

      <nav className="flex gap-0.5 px-3 pb-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors",
                active
                  ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
                  : "text-[var(--lore-text-tertiary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-secondary)]",
              )}
            >
              <Icon size={15} />
              {item.label}
              {item.id === "review" && pendingCount > 0 ? (
                <span className="absolute right-2 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--lore-accent)] px-1 text-[10px] font-semibold text-white">
                  {pendingCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="px-3 pb-2">
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
          <SearchResults results={results} onSelect={onSelect} />
        ) : (
          grouped.map(([folder, pages]) => {
            const isCollapsed = collapsed.has(folder);
            return (
              <div key={folder || "__root"} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleFolder(folder)}
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-secondary)]"
                >
                  <ChevronRight
                    size={12}
                    className={cn("transition-transform", !isCollapsed && "rotate-90")}
                  />
                  <span className="truncate">{folder || "Root"}</span>
                  <span className="ml-auto font-normal normal-case tracking-normal">
                    {pages.length}
                  </span>
                </button>

                {isCollapsed
                  ? null
                  : pages.map((page) => (
                      <button
                        key={page.relPath}
                        type="button"
                        onClick={() => onSelect(page)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                          selected === page.relPath
                            ? "bg-[var(--lore-surface-selected)] text-[var(--lore-text-primary)]"
                            : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
                        )}
                      >
                        <FileText size={13} className="shrink-0 opacity-55" />
                        <span className="truncate">{page.title}</span>
                      </button>
                    ))}
              </div>
            );
          })
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
                  setCreateError(null);
                }
              }}
              placeholder="notes/new-page.md"
              autoFocus
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[12.5px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            />
            {createError ? (
              <p className="t-meta mt-1.5 text-[var(--lore-danger)]">{createError}</p>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
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
  onSelect,
}: {
  results: SearchResult[];
  onSelect: (page: PageMeta) => void;
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
          onClick={() => onSelect(result.page)}
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
