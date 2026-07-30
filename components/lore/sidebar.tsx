"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookText,
  ChevronRight,
  Compass,
  MessageCircleQuestion,
  Moon,
  Newspaper,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import type { SearchResult, VaultIndex } from "@/lib/types";
import type { View } from "@/components/lore/vault-app";
import { BrandMark } from "@/components/marketing/brand-mark";
import { useShell } from "@/components/lore/app-shell";
import { useTheme } from "@/components/lore/theme-provider";
import { colorForIndex } from "@/lib/palette";
import { ancestorsOf, buildFolderTree, visibleRows } from "@/lib/tree";
import { cn, count, formatCount, relativeTime } from "@/lib/utils";

/** Lives here because the nav owns the names; the mobile top bar borrows them
 *  so a view is called the same thing in both places. */
export const VIEW_LABEL: Record<View, string> = {
  brief: "Brief",
  ask: "Ask",
  wiki: "Wiki",
  settings: "Settings",
};

/**
 * Order is the product's opinion about what this app is for.
 *
 * Brief and Ask are first because they are the two things that give you
 * something without asking for anything. Everything below the rule is a place
 * you go deliberately, when you already know what you want — and "Changes" used
 * to be called Review and used to be first, which framed the whole app as a
 * queue of work you owed it.
 */
/*
 * Four, down from eight.
 *
 * The panel said three times that demoting is not deleting, and three times it
 * was demoted. Changes, Insights, Explore (seven sub-lenses) and Connections
 * are gone from the nav: they are lenses on a corpus, and a lens is not a
 * reason to open an app. Two of them — health and connecting an agent — moved
 * into Settings, where you go once. The rest is deleted.
 *
 * What is left is the two things that give you something (Brief, Ask), the
 * thing you came for (Wiki), and the place you configure it once.
 */
const NAV: { id: View; icon: typeof BookText }[] = [
  { id: "brief", icon: Newspaper },
  { id: "ask", icon: MessageCircleQuestion },
  { id: "wiki", icon: BookText },
  { id: "settings", icon: Settings },
];

export function Sidebar({
  index,
  view,
  onView,
  folder,
  onFolder,
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
  query: string;
  onQuery: (value: string) => void;
  results: SearchResult[] | null;
  onOpenPage: (pageId: string) => void;
  onCreated: (relPath: string) => void;
}) {
  const { theme, toggle } = useTheme();
  const { closeDrawer } = useShell();
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
    closeDrawer();
  }

  return (
    <aside
      className="flex h-full w-full min-w-0 flex-col border-r border-[var(--lore-border)] bg-[var(--lore-surface)]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-1 px-3 pb-3 pt-3 md:px-4 md:pt-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-1 text-[var(--lore-text-primary)]">
          <BrandMark size={18} />
          <span className="truncate text-[14px] font-semibold tracking-[-0.02em]">
            {index.name}
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] md:h-7 md:w-7"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        {/* The drawer's own dismiss. Escape and the backdrop do the same thing,
            but neither is discoverable with a thumb. */}
        <button
          type="button"
          onClick={closeDrawer}
          aria-label="Close menu"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--lore-text-tertiary)] transition-colors active:bg-[var(--lore-surface-raised)] md:hidden"
        >
          <X size={17} />
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
              onClick={() => {
                onView(item.id);
                closeDrawer();
              }}
              className={cn(
                "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors md:min-h-0",
                view === item.id
                  ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                  : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
              )}
            >
              <Icon size={15} className="opacity-80" />
              {VIEW_LABEL[item.id]}
              {/*
                * A quiet dot, not a count.
                *
                * This was a filled blue "12" — an unread badge, which is a
                * promise that twelve things are waiting for you and a debt that
                * grows on its own. Nothing in Changes is owed. The dot says
                * "something moved" and stops there.
                */}
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
            /* 16px below md is not a style choice: iOS Safari zooms the whole
               page when a focused field is smaller than that, and the zoom is
               what produces the horizontal scroll on a phone. */
            className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] py-2.5 pl-8 pr-3 text-[16px] text-[var(--lore-text-primary)] outline-none transition-colors placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:py-2 md:pr-10 md:text-[13px]"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--lore-text-tertiary)] md:block">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="lore-scrollbar flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {results ? (
          <SearchResults
            results={results}
            onOpenPage={(pageId) => {
              onOpenPage(pageId);
              closeDrawer();
            }}
          />
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
                className="mb-1.5 w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2.5 text-[16px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:py-1.5 md:text-[12px]"
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
                    // 44px is the smallest row a thumb reliably hits; the
                    // desktop tree stays at its original 28px density.
                    "flex min-h-11 items-center rounded-lg transition-colors md:min-h-0",
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
                      className="flex h-11 w-8 shrink-0 items-center justify-center md:h-7 md:w-5"
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
                      className="flex h-11 w-8 shrink-0 items-center justify-center md:h-7 md:w-5"
                      style={{ marginLeft: `${Math.min(node.depth, 4) * 10}px` }}
                    >
                      <span className="pal-dot" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onFolder(node.path);
                      closeDrawer();
                    }}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-left text-[13px] md:min-h-0"
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

      <div
        className="border-t border-[var(--lore-border)] p-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {creating ? (
          <div>
            <input
              value={newPath}
              onChange={(event) => setNewPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createPage();
                if (event.key === "Escape") {
                  // Escape belongs to whatever is innermost. Without this the
                  // shell also reads it and the drawer closes out from under a
                  // half-typed path.
                  event.stopPropagation();
                  setCreating(false);
                  setError(null);
                }
              }}
              placeholder={folder ? `${folder}/new-page.md` : "new-page.md"}
              autoFocus
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2.5 text-[16px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)] md:py-2 md:text-[12.5px]"
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
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] md:min-h-0"
          >
            <Plus size={14} />
            New page
          </button>
        )}

        <p className="t-meta mt-2 px-2 text-[var(--lore-text-tertiary)]">
          {count(index.pages.length, "page")} · scanned {relativeTime(index.scannedAt)}
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
          className="block min-h-11 w-full rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)] md:min-h-0 md:py-2"
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
