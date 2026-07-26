"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Eye, Check, Loader2, Link2, ArrowUpRight } from "lucide-react";
import type { PageMeta, VaultIndex } from "@/lib/types";
import { renderMarkdown, stripFrontmatter, stripLeadingTitle } from "@/lib/markdown";
import { cn, relativeTime } from "@/lib/utils";

type Loaded = {
  page: PageMeta;
  raw: string;
  frontmatter: Record<string, unknown>;
  backlinks: PageMeta[];
  outgoing: PageMeta[];
};

export function PageView({
  relPath,
  pageTitles,
  index,
  onOpen,
  onSaved,
}: {
  relPath: string | null;
  /** Page id -> title, so resolved wikilinks render as prose, not paths. */
  pageTitles: Map<string, string>;
  index: VaultIndex;
  onOpen: (id: string) => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!relPath) return;
    let cancelled = false;
    setData(null);
    setEditing(false);
    setError(null);

    fetch(`/api/page?path=${encodeURIComponent(relPath)}`)
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error ?? "Could not open that page.");
          return;
        }
        setData(body);
        setDraft(body.raw);
      })
      .catch(() => {
        if (!cancelled) setError("Could not open that page.");
      });

    return () => {
      cancelled = true;
    };
  }, [relPath]);

  const save = useCallback(async () => {
    if (!relPath) return;
    setSaveState("saving");
    const response = await fetch("/api/page", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: relPath, content: draft }),
    });

    if (!response.ok) {
      setError((await response.json()).error ?? "Save failed.");
      setSaveState("idle");
      return;
    }

    setSaveState("saved");
    setData((current) => (current ? { ...current, raw: draft } : current));
    onSaved();
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 1600);
  }, [draft, relPath, onSaved]);

  // Cmd-S saves from the editor. The app is a local server, so the browser's
  // "save page" default is never what anyone means here.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (editing) save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, save]);

  const html = useMemo(() => {
    if (!data) return "";
    const body = stripLeadingTitle(stripFrontmatter(data.raw), data.page.title);
    return renderMarkdown(body, pageTitles);
  }, [data, pageTitles]);

  // Wikilinks render as `#page:<id>` anchors; intercept clicks so they navigate
  // inside the app instead of pushing a fragment onto the URL.
  const onProseClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a[data-page]");
      if (!anchor) return;
      event.preventDefault();
      onOpen(anchor.getAttribute("data-page")!);
    },
    [onOpen],
  );

  if (!relPath) {
    return (
      <Empty
        title="No page open"
        body={
          index.pages.length === 0
            ? "This folder has no markdown files yet. Create one from the sidebar."
            : "Pick a page from the sidebar, or press ⌘K to search."
        }
      />
    );
  }

  if (error) return <Empty title="Could not open that page" body={error} />;
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-8 py-9">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.035em] text-[var(--lore-text-primary)]">
              {data.page.title}
            </h1>
            <p
              className="mt-1.5 truncate text-[12px] text-[var(--lore-text-tertiary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {data.page.relPath}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {editing ? (
              <button
                type="button"
                onClick={save}
                disabled={saveState === "saving"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
              >
                {saveState === "saving" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : saveState === "saved" ? (
                  <Check size={13} />
                ) : null}
                {saveState === "saved" ? "Saved" : "Save"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing((current) => !current)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              {editing ? <Eye size={13} /> : <Pencil size={13} />}
              {editing ? "Read" : "Edit"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="t-meta text-[var(--lore-text-tertiary)]">
            {data.page.words.toLocaleString()} words · edited {relativeTime(data.page.mtime)}
          </span>
          {data.page.tags.map((tag) => (
            <span key={tag} className="lore-tag">
              {tag}
            </span>
          ))}
        </div>
      </header>

      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          className="lore-scrollbar min-h-[60svh] w-full resize-y rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5 text-[14px] leading-[1.75] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        />
      ) : (
        <div
          className="lore-prose"
          onClick={onProseClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {!editing && (data.backlinks.length > 0 || data.outgoing.length > 0) ? (
        <div className="mt-12 grid gap-6 border-t border-[var(--lore-border)] pt-7 sm:grid-cols-2">
          <LinkList
            title="Linked from"
            icon={<Link2 size={13} />}
            pages={data.backlinks}
            empty="Nothing links here yet."
            onOpen={onOpen}
          />
          <LinkList
            title="Links to"
            icon={<ArrowUpRight size={13} />}
            pages={data.outgoing}
            empty="This page links nowhere."
            onOpen={onOpen}
          />
        </div>
      ) : null}
    </div>
  );
}

function LinkList({
  title,
  icon,
  pages,
  empty,
  onOpen,
}: {
  title: string;
  icon: React.ReactNode;
  pages: PageMeta[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--lore-text-tertiary)]">
        {icon}
        {title}
        <span className="font-normal normal-case tracking-normal">({pages.length})</span>
      </h2>
      {pages.length === 0 ? (
        <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {pages.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => onOpen(page.id)}
                className={cn(
                  "block w-full truncate rounded-md px-2 py-1.5 text-left text-[13px]",
                  "text-[var(--lore-text-secondary)] transition-colors",
                  "hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
                )}
              >
                {page.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <p className="text-[15px] font-medium text-[var(--lore-text-secondary)]">{title}</p>
      <p className="t-body mt-1.5 max-w-sm text-[var(--lore-text-tertiary)]">{body}</p>
    </div>
  );
}
