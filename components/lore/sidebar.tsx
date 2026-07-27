"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Search,
  Plus,
  BookText,
  Plug,
  Settings,
  Sun,
  Moon,
  ShieldCheck,
  BarChart3,
  Compass,
} from "lucide-react";
import type { SearchResult, VaultIndex } from "@/lib/types";
import type { View } from "@/components/lore/vault-app";
import { BrandMark } from "@/components/marketing/brand-mark";
import { useTheme } from "@/components/lore/theme-provider";
import { colorForIndex } from "@/lib/palette";
import { ancestorsOf, buildFolderTree, visibleRows } from "@/lib/tree";
import { cn, formatCount, relativeTime } from "@/lib/utils";

const NAV: { id: View; label: string; icon: typeof BookText }[] = [
  { id: "wiki", label: "Wiki", icon: BookText },
  { id: "review", label: "Review", icon: ShieldCheck },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  index,
  view,
  onView,
  folder,
  onFolder,
  needsReview,
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
  needsReview: number;
  query: string;
  onQuery: (value: string) => void;
  results: SearchResult[] | null;
  onOpenPage: (pageId: string) => void;
  onCreated: (relPath: string) => void;
}) {
  const { theme, toggle } = useTheme();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  /* Only the top level opens by default. On a real vault the tree is 262
     folders deep in places, and expanding it all reproduces the flat list this
     replaced. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildFolderTree(index.folders), [index.folders]);

  /* Reveal the selected folder wherever it lives, so opening a page from
     search or triage does not leave the sidebar pointing somewhere else. */
  useEffect(() => {
    const ancestors = ancestorsOf(folder);
    if (!ancestors.length) return;
    setExpanded((current) => {
      if (ancestors.every((a) => current.has(a))) return current;
      return new Set([...current, ...ancestors]);
    });
  }, [folder]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return visibleRows(tree, expanded);
    /* Filtering shows matches as a flat list. Preserving the hierarchy while
       filtering means rendering parents that do not match, which reads as
       noise when you have already told us what you are looking for. */
    const flat: ReturnType<typeof visibleRows> = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.path.toLowerCase().includes(q)) flat.push({ ...n, depth: 0 });
        walk(n.children);
      }
    };
    walk(tree);
    return flat;
  }, [tree, expanded, filter]);
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

      {/* Wiki is where you read. Review and Insights are the two things only
          Lore can tell you — what your agents changed, and what they asked for.
          Explore holds the lenses. Connections and Settings are plumbing. */}
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
              {item.id === "review" && needsReview > 0 ? (
                <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--lore-accent)] px-1 text-[11px] font-semibold text-white">
                  {needsReview}
                </span>
              ) : null}
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
            <div className="mb-1.5 mt-1 flex items-center gap-2 px-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
                Folders
              </p>
              <span className="text-[10px] text-[var(--lore-text-tertiary)]">
                {index.folders.length}
              </span>
            </div>

            {index.folders.length > 12 ? (
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter folders"
                spellCheck={false}
                className="mb-1.5 w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5 text-[12px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)]"
              />
            ) : null}

            {rows.map((node, i) => {
              const hasChildren = node.children.length > 0;
              const isOpen = expanded.has(node.path);
              return (
                <div
                  key={node.path || "__root"}
                  style={colorForIndex(node.depth <= 1 ? i : node.path.length)}
                  className={cn(
                    "flex items-center rounded-lg transition-colors",
                    folder === node.path
                      ? "bg-[var(--lore-surface-selected)] text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                  )}
                  // Indentation carries the hierarchy; capped so a deep path
                  // never squeezes the name into nothing.
                >
                  {/* A leaf has nothing to expand, so it gets a marker rather
                      than a disabled control. Rendering a disabled button
                      labelled "Expand" on every leaf puts hundreds of dead
                      targets in the tab order and tells a screen reader there
                      is something to open when there is not. */}
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
                      style={{ marginLeft: `${Math.min(node.depth, 4) * 10}px` }}
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
                      style={{ marginLeft: `${Math.min(node.depth, 4) * 10}px` }}
                    >
                      <span className="pal-dot" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onFolder(node.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-left text-[13px]"
                    title={node.path || "Root"}
                  >
                    <span className={cn("truncate", folder === node.path && "font-medium")}>
                      {node.name}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-[var(--lore-text-tertiary)]">
                      {hasChildren && !isOpen ? node.total : node.count}
                    </span>
                  </button>
                </div>
              );
            })}

            {rows.length === 0 ? (
              <p className="px-2 py-4 text-center text-[12px] text-[var(--lore-text-tertiary)]">
                No folder matches.
              </p>
            ) : null}
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
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--lore-text-primary)]">
              {result.page.title}
            </span>
            {result.semantic ? (
              <span
                className="shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-[0.05em] text-[var(--lore-accent)]"
                style={{ background: "var(--lore-accent-tint)" }}
                title="Found by meaning, not by matching text"
              >
                related
              </span>
            ) : null}
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
