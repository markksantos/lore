"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, Eye } from "lucide-react";
import type { PageMeta } from "@/lib/types";
import { renderMarkdown, stripFrontmatter, stripLeadingTitle } from "@/lib/markdown";
import { paletteVars } from "@/lib/palette";
import { MarkdownEditor } from "@/components/lore/markdown-editor";
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

  // An agent writing to the file on disk reloads the folder, so the section can
  // be handed new source while it is mounted. Re-seed the draft unless the user
  // is mid-edit — clobbering what they are typing would be worse than staleness.
  useEffect(() => {
    if (!editing) setDraft(raw);
  }, [raw, editing]);

  const palette = useMemo(() => paletteVars(index), [index]);

  const html = useMemo(
    () => renderMarkdown(stripLeadingTitle(stripFrontmatter(raw), page.title), pageTitles),
    [raw, page.title, pageTitles],
  );

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
      setError((await response.json()).error ?? "Save failed.");
      return;
    }
    setEditing(false);
    onChanged();
  }, [draft, page.relPath, onChanged]);

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
    <section id={id} style={palette} className="group mt-9 scroll-mt-8 first:mt-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="pal-bar" />
        <h2 className="pal-title text-[17px] font-semibold tracking-[-0.02em]">{page.title}</h2>

        <span className="flex-1" />

        {/* Controls stay hidden until the section is hovered or focused, so a
            long document reads as prose rather than as a wall of buttons. */}
        <span
          className={cn(
            "flex items-center gap-1 transition-opacity",
            editing ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
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
          className="lore-prose mt-2.5 text-[15px]"
          onClick={onProseClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </section>
  );
}
