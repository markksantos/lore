"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, Loader2, Lock, LockOpen, Pencil } from "lucide-react";
import type { PageMeta } from "@/lib/types";
import { renderMarkdown, stripFrontmatter, stripLeadingTitle } from "@/lib/markdown";
import { paletteVars } from "@/lib/palette";
import { MarkdownEditor } from "@/components/lore/markdown-editor";
import { useRichBlocks } from "@/components/lore/rich-blocks";
import { cn, relativeTime } from "@/lib/utils";

/**
 * One page, as a section of the folder document.
 *
 * The colour comes from position in the folder, so adjacent sections are never
 * the same colour. Reading and editing both happen here — there is nowhere else
 * to go, and no state between typing and the file on disk.
 */
export function PageSection({
  id,
  index,
  section,
  pageTitles,
  onOpenPage,
  onChanged,
}: {
  id: string;
  /** Position in the folder document — drives the section's colour. */
  index: number;
  section: { page: PageMeta; raw: string };
  pageTitles: Map<string, string>;
  onOpenPage: (pageId: string) => void;
  onChanged: () => void;
}) {
  const { page, raw } = section;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The section element, watched so its body renders just before it is seen. */
  const ref = useRef<HTMLElement | null>(null);

  // An agent writing to the file on disk reloads the folder, so the section can
  // be handed new source while it is mounted. Re-seed the draft unless the user
  // is mid-edit — clobbering what they are typing would be worse than staleness.
  useEffect(() => {
    if (!editing) setDraft(raw);
  }, [raw, editing]);

  const palette = useMemo(() => paletteVars(index), [index]);

  /*
   * Render this page's markdown only once it is near the viewport.
   *
   * A folder document renders every page in the folder, and markdown-to-HTML is
   * not cheap: the vault root here is five pages holding just over a megabyte
   * of append-only log, so opening it parsed 1MB and built the DOM for all of
   * it before anything appeared. Folders with a single 405KB transcript behaved
   * the same way.
   *
   * The observer starts 800px early, so by the time a section scrolls into
   * sight it is already drawn and the reader never sees the swap. Sections
   * already on screen at mount render immediately, because the first frame is
   * the one that has to be fast.
   */
  const [visible, setVisible] = useState(index < 3);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const html = useMemo(
    () =>
      visible
        ? renderMarkdown(stripLeadingTitle(stripFrontmatter(raw), page.title), pageTitles)
        : "",
    [visible, raw, page.title, pageTitles],
  );

  /* Set when a save is refused by the read-only gate in proxy.ts. */
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const response = await fetch("/api/page", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: page.relPath, content: draft }),
    });
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      /* The read-only lock is the product's headline promise, so hitting it is
         a normal outcome, not an error. It gets its own state with the switch
         attached rather than a red sentence the reader cannot act on. */
      if (response.status === 403 && body.readOnly) {
        setLocked(true);
        return;
      }
      setError(body.error ?? "Save failed.");
      return;
    }
    setEditing(false);
    onChanged();
  }, [draft, page.relPath, onChanged]);

  const unlockAndSave = useCallback(async () => {
    setUnlocking(true);
    const ok = await fetch("/api/safety", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readOnly: false }),
    })
      .then((r) => r.ok)
      .catch(() => false);
    setUnlocking(false);
    if (!ok) {
      setError("Could not turn off read-only mode.");
      return;
    }
    setLocked(false);
    await save();
  }, [save]);


  const proseRef = useRef<HTMLDivElement | null>(null);
  useRichBlocks(html, proseRef);

  const onProseClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a[data-page]");
      if (!anchor) return;
      event.preventDefault();
      onOpenPage(anchor.getAttribute("data-page")!);
    },
    [onOpenPage],
  );

  return (
    <section
      id={id}
      ref={ref}
      style={palette}
      className="group mt-9 scroll-mt-8 first:mt-6"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="pal-bar" />
        <h2 className="pal-title text-[17px] font-semibold tracking-[-0.02em]">{page.title}</h2>

        <span className="flex-1" />

        {/*
          * Dimmed until hover, never hidden.
          *
          * These were opacity-0, which reads as "there is no edit button" to
          * anyone who did not sweep the mouse across the heading, and to every
          * touch device it was simply absent. Sixty per cent opacity keeps a
          * long document from reading as a wall of buttons while leaving the
          * one action on the page discoverable.
          */}
        <span
          className={cn(
            "flex items-center gap-1 transition-opacity",
            editing
              ? "opacity-100"
              : "opacity-60 focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {editing ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            {editing ? <Eye size={12} /> : <Pencil size={12} />}
            {editing ? "Read" : "Edit"}
          </button>
        </span>
      </div>

      <p className="t-meta mt-0.5 text-[var(--lore-text-tertiary)]">
        <span style={{ fontFamily: "var(--font-mono), monospace" }}>{page.relPath}</span>
        {" · "}
        {page.words.toLocaleString()} words · {relativeTime(page.mtime)}
        {page.tags.length ? (
          <>
            {" · "}
            {page.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="lore-tag mr-1">
                {tag}
              </span>
            ))}
          </>
        ) : null}
      </p>

      {error ? <p className="t-meta mt-2 text-[var(--lore-danger)]">{error}</p> : null}

      {/* Refused by the read-only lock. Says which promise stopped the save and
          offers the switch, rather than reporting a number the reader would
          have to go and look up. */}
      {locked ? (
        <div className="mt-2 flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-2">
          <Lock size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
          <span className="t-meta text-[var(--lore-text-secondary)]">
            Lore is read-only, so it did not change your file.
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setLocked(false)}
            className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface)]"
          >
            Keep it on
          </button>
          <button
            type="button"
            onClick={unlockAndSave}
            disabled={unlocking}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
          >
            {unlocking ? <Loader2 size={12} className="animate-spin" /> : <LockOpen size={12} />}
            Turn off and save
          </button>
        </div>
      ) : null}

      {editing ? (
        /* CodeMirror rather than a textarea: [[wikilink]] autocomplete against
           the real page list is the difference between writing links and
           guessing at them, and on a 1,400-page wiki nobody remembers ids. */
        <div
          onKeyDown={(event) => {
            // Escape abandons the edit. CodeMirror owns Cmd-S internally, but
            // it lets Escape bubble, and losing "cancel" in the swap from a
            // textarea would be a silent regression in a destructive direction.
            if (event.key === "Escape") {
              setDraft(raw);
              setEditing(false);
            }
          }}
        >
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            onSave={save}
            pageTitles={pageTitles}
            className="mt-3"
          />
        </div>
      ) : (
        <div
          ref={proseRef}
          /* A height floor while unrendered, so the page does not collapse and
             then jolt as sections fill in — scroll position must not move under
             the reader. Roughly the height the words will occupy. */
          style={visible ? undefined : { minHeight: Math.min(page.words * 0.6 + 60, 900) }}
          className="lore-prose mt-2.5 text-[15px]"
          onClick={onProseClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </section>
  );
}
