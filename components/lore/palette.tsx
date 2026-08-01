"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CornerDownLeft, FileText, MessageCircleQuestion, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { View } from "@/components/lore/vault-app";

/**
 * ⌘K — go anywhere, from anywhere.
 *
 * Navigating this app meant reaching for the sidebar, choosing Wiki, expanding
 * a folder tree, and finding a page — four deliberate movements to reach
 * something you could already name. On a 1,600-page vault the tree is not a
 * navigation aid; it is a filing cabinet you have to walk to.
 *
 * Two behaviours, decided by what you typed. Anything matches pages by title
 * and path. A line ending in `?` — or beginning with `ask ` — goes to Ask
 * instead, because "how do I deploy?" is a question and offering it as a
 * filename match is answering the wrong one.
 *
 * Searches titles and paths only, not page bodies. Full-text belongs in Ask and
 * in search, both of which do it properly; a palette that returned body matches
 * would be a slower, worse version of a thing one keystroke away.
 */

type PageRef = { id: string; title: string; relPath: string; folder: string };

const VIEWS: { id: View; label: string; keywords: string }[] = [
  { id: "brief", label: "Brief", keywords: "news changes learned today" },
  { id: "ask", label: "Ask", keywords: "question chat search answer" },
  { id: "wiki", label: "Wiki", keywords: "pages browse read folder" },
  { id: "review", label: "Changes", keywords: "diff review history writes" },
  { id: "watch", label: "Watch", keywords: "canon alerts contradictions undo prune" },
  { id: "timeline", label: "Timeline", keywords: "screen recording desktop what was I doing frames" },
  { id: "insights", label: "Insights", keywords: "usage agents budget retrieval receipts" },
  { id: "explore", label: "Explore", keywords: "graph duplicates coverage timeline" },
  { id: "connections", label: "Connections", keywords: "mcp install agents setup hooks" },
  { id: "settings", label: "Settings", keywords: "policy trust vault theme" },
];

type Row =
  | { kind: "ask"; label: string }
  | { kind: "view"; label: string; view: View }
  | { kind: "page"; label: string; detail: string; pageId: string };

export function Palette({
  open,
  onClose,
  onOpenPage,
  onGoTo,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  onOpenPage: (pageId: string) => void;
  onGoTo: (view: View) => void;
  onAsk: (question: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pages, setPages] = useState<PageRef[]>([]);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Focused on the next frame: the input does not exist until this render
    // commits, and focusing a node that is not in the document does nothing.
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open || pages.length) return;
    fetch("/api/pages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPages(d?.pages ?? []))
      .catch(() => setPages([]));
  }, [open, pages.length]);

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim();
    const isQuestion = trimmed.endsWith("?") || /^ask\s+/i.test(trimmed);
    const out: Row[] = [];

    if (trimmed && isQuestion) {
      out.push({ kind: "ask", label: trimmed.replace(/^ask\s+/i, "") });
    }

    const needle = trimmed.toLowerCase().replace(/^ask\s+/i, "").replace(/\?$/, "");
    if (!needle) {
      return [...out, ...VIEWS.map((v) => ({ kind: "view" as const, label: v.label, view: v.id }))];
    }

    for (const view of VIEWS) {
      if (`${view.label} ${view.keywords}`.toLowerCase().includes(needle)) {
        out.push({ kind: "view", label: view.label, view: view.id });
      }
    }

    /*
     * Title matches beat path matches, and a prefix beats a substring.
     *
     * Typing "dep" for `stack/deploy-pipeline` should not be outranked by a
     * client page that happens to contain "dep" halfway through its path.
     */
    const scored: { page: PageRef; score: number }[] = [];
    for (const page of pages) {
      const title = page.title.toLowerCase();
      const path = page.relPath.toLowerCase();
      let score = 0;
      if (title.startsWith(needle)) score = 100;
      else if (title.includes(needle)) score = 70;
      else if (path.includes(needle)) score = 40;
      if (!score) continue;
      scored.push({ page, score: score - Math.min(page.relPath.length / 20, 10) });
    }

    scored.sort((a, b) => b.score - a.score);
    for (const { page } of scored.slice(0, 12)) {
      out.push({ kind: "page", label: page.title, detail: page.relPath, pageId: page.id });
    }

    if (trimmed && !isQuestion) out.push({ kind: "ask", label: trimmed });
    return out;
  }, [query, pages]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  if (!open) return null;

  const choose = (row: Row) => {
    onClose();
    if (row.kind === "ask") onAsk(row.label);
    else if (row.kind === "view") onGoTo(row.view);
    else onOpenPage(row.pageId);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--lore-border)] px-4">
          <Search size={14} className="shrink-0 text-[var(--lore-text-tertiary)]" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") return onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => (c + 1) % Math.max(rows.length, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => (c - 1 + rows.length) % Math.max(rows.length, 1));
              } else if (e.key === "Enter" && rows[cursor]) {
                e.preventDefault();
                choose(rows[cursor]);
              }
            }}
            placeholder="Jump to a page, or end with ? to ask"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14.5px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)]"
          />
          <kbd className="t-meta shrink-0 rounded border border-[var(--lore-border)] px-1.5 py-0.5 text-[var(--lore-text-tertiary)]">
            esc
          </kbd>
        </div>

        <div className="lore-scrollbar max-h-[52vh] overflow-y-auto overscroll-contain py-1.5">
          {rows.length ? (
            rows.map((row, i) => (
              <button
                key={`${row.kind}-${row.label}-${i}`}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(row)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-4 py-2 text-left",
                  i === cursor && "bg-[var(--lore-surface-raised)]",
                )}
              >
                {row.kind === "ask" ? (
                  <MessageCircleQuestion size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
                ) : row.kind === "view" ? (
                  <ArrowRight size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
                ) : (
                  <FileText size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-[var(--lore-text-primary)]">
                    {row.kind === "ask" ? `Ask: ${row.label}` : row.label}
                  </span>
                  {row.kind === "page" ? (
                    <span className="t-meta block truncate text-[var(--lore-text-tertiary)]">
                      {row.detail}
                    </span>
                  ) : null}
                </span>
                {i === cursor ? (
                  <CornerDownLeft size={12} className="shrink-0 text-[var(--lore-text-tertiary)]" />
                ) : null}
              </button>
            ))
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-[var(--lore-text-tertiary)]">
              No page matches that. End the line with a question mark to ask instead.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
