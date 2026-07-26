"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, Loader2, Pencil, Eye } from "lucide-react";
import type { PageMeta } from "@/lib/types";
import { renderMarkdown, stripFrontmatter, stripLeadingTitle } from "@/lib/markdown";
import { paletteVars } from "@/lib/palette";
import { cn, relativeTime } from "@/lib/utils";

export type Proposal = {
  id: string;
  relPath: string;
  agent: string;
  reason: string;
  kind: "create" | "append" | "replace";
  risk: "low" | "medium" | "high";
  proposed: string;
  base: string | null;
  stats: { added: number; removed: number };
};

const RISK_STYLE: Record<Proposal["risk"], string> = {
  low: "text-[var(--lore-text-tertiary)] border-[var(--lore-border-strong)]",
  medium: "text-[#b45309] border-[#b45309]/40 dark:text-[#fbbf24] dark:border-[#fbbf24]/35",
  high: "text-[var(--lore-danger)] border-[var(--lore-danger)]/40",
};

/**
 * One page, as a section of the folder document.
 *
 * The colour comes from position in the folder, so adjacent sections are never
 * the same colour. Reading,
 * editing and reviewing all happen here — there is nowhere else to go.
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
  section: { page: PageMeta; raw: string; proposals: Proposal[] };
  pageTitles: Map<string, string>;
  onOpenPage: (pageId: string) => void;
  onChanged: () => void;
}) {
  const { page, raw, proposals } = section;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The folder reloads after every accept, so the section can be handed new
  // source while it is mounted. Re-seed the draft unless the user is mid-edit.
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

  async function resolve(proposalId: string, action: "accept" | "reject") {
    setBusyId(proposalId);
    setError(null);
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id: proposalId }),
    });
    if (!response.ok) setError((await response.json()).error ?? "Could not resolve that.");
    setBusyId(null);
    onChanged();
  }

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

        {proposals.length > 0 ? (
          <span className="pal-chip rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold">
            {proposals.length} {proposals.length === 1 ? "proposal" : "proposals"}
          </span>
        ) : null}

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
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              save();
            }
            if (event.key === "Escape") {
              setDraft(raw);
              setEditing(false);
            }
          }}
          spellCheck={false}
          autoFocus
          className="lore-scrollbar mt-3 min-h-[16rem] w-full resize-y rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4 text-[13.5px] leading-[1.75] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        />
      ) : (
        <div
          className="lore-prose mt-2.5 text-[15px]"
          onClick={onProseClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {/* Proposals live inside the section they change. */}
      {!editing &&
        proposals.map((proposal) => (
          <InlineProposal
            key={proposal.id}
            proposal={proposal}
            busy={busyId === proposal.id}
            onResolve={resolve}
          />
        ))}

    </section>
  );
}

function InlineProposal({
  proposal,
  busy,
  onResolve,
}: {
  proposal: Proposal;
  busy: boolean;
  onResolve: (id: string, action: "accept" | "reject") => void;
}) {
  const lines = useMemo(
    () => diffLines(proposal.base ?? "", proposal.proposed),
    [proposal.base, proposal.proposed],
  );

  return (
    <div className="mt-3.5 overflow-hidden rounded-xl border border-[var(--lore-border)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3.5 py-2">
        <span className="text-[12.5px] font-semibold text-[var(--lore-text-primary)]">
          {proposal.agent}
        </span>
        <span
          className={cn(
            "rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.05em]",
            RISK_STYLE[proposal.risk],
          )}
        >
          {proposal.risk}
        </span>
        <span className="t-meta text-[var(--lore-text-tertiary)]">{proposal.kind}</span>
        <span className="flex-1" />
        <span
          className="text-[12px] tabular-nums"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <span className="text-[var(--lore-success)]">+{proposal.stats.added}</span>{" "}
          <span className="text-[var(--lore-danger)]">−{proposal.stats.removed}</span>
        </span>
        <button
          type="button"
          onClick={() => onResolve(proposal.id, "reject")}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface)] disabled:opacity-50"
        >
          <X size={12} />
          Reject
        </button>
        <button
          type="button"
          onClick={() => onResolve(proposal.id, "accept")}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--lore-accent)] px-2.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Accept
        </button>
      </div>

      <p className="px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--lore-text-secondary)]">
        {proposal.reason}
      </p>

      <div
        className="lore-scrollbar max-h-64 overflow-auto border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-3.5 py-2 text-[12px] leading-[1.7]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words rounded px-1",
              line.type === "add" && "bg-[var(--lore-success)]/12 text-[var(--lore-success)]",
              line.type === "remove" && "bg-[var(--lore-danger)]/10 text-[var(--lore-danger)]",
              line.type === "same" && "text-[var(--lore-text-tertiary)]",
            )}
          >
            {line.type === "add" ? "+ " : line.type === "remove" ? "− " : "  "}
            {line.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Client-side twin of the server diff. Duplicated rather than imported because
 * lib/proposals.ts pulls in node:fs, which cannot cross into a client bundle.
 */
function diffLines(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const context = 2;
  const lines: { type: "same" | "add" | "remove"; text: string }[] = [];
  for (let i = Math.max(0, start - context); i < start; i++) {
    lines.push({ type: "same", text: a[i] });
  }
  for (let i = start; i < endA; i++) lines.push({ type: "remove", text: a[i] });
  for (let i = start; i < endB; i++) lines.push({ type: "add", text: b[i] });
  for (let i = endA; i < Math.min(a.length, endA + context); i++) {
    lines.push({ type: "same", text: a[i] });
  }

  return lines;
}
