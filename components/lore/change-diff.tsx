"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The lines that changed, on the card where you are asked to sign off.
 *
 * The most-repeated criticism of this screen was that it showed a quantity and
 * called it a review: "you tell me Claude Code did +12/−31 on deploy-pipeline.md
 * but never show the 31 lines — quantities aren't review." Signing off on a
 * number is rubber-stamping, which is exactly the behaviour the whole product
 * exists to replace.
 *
 * Collapsed by default. A dozen expanded diffs would make Review unreadable, and
 * the point of the ranking above is that most rows do not need opening.
 */

type Line = { type: "add" | "remove" | "same"; text: string };

/**
 * Common-prefix/suffix trim, the same shape the journal uses. Not Myers: for the
 * mostly-additive edits agents make this produces the same answer, and a large
 * reordering renders as one block removed and one added — which is legible, if
 * not minimal.
 */
function diffLines(before: string, after: string, context = 2): Line[] {
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

  const out: Line[] = [];
  for (let i = Math.max(0, start - context); i < start; i++) out.push({ type: "same", text: a[i] });
  for (let i = start; i < endA; i++) out.push({ type: "remove", text: a[i] });
  for (let i = start; i < endB; i++) out.push({ type: "add", text: b[i] });
  for (let i = endA; i < Math.min(a.length, endA + context); i++) {
    out.push({ type: "same", text: a[i] });
  }
  return out;
}

export function ChangeDiff({ relPath }: { relPath: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (lines || busy) return;
    setBusy(true);
    try {
      const versions = await fetch(`/api/history?path=${encodeURIComponent(relPath)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      const previous = versions?.versions?.[0];
      if (!previous) {
        // History only accumulates while Lore is running, so a change made
        // before it started has nothing to compare against. Say that rather
        // than showing an empty box.
        setNote("No earlier copy of this page was recorded, so there is nothing to compare.");
        return;
      }

      const [before, current] = await Promise.all([
        fetch(`/api/history?path=${encodeURIComponent(relPath)}&at=${previous.at}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.text ?? null),
        fetch(`/api/page?path=${encodeURIComponent(relPath)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.raw ?? null),
      ]);

      if (before === null || current === null) {
        setNote("Could not read one of the two versions.");
        return;
      }
      const computed = diffLines(before, current);
      if (!computed.length) setNote("The text is identical — only metadata changed.");
      else setLines(computed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          void load();
        }}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[12px] text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-primary)]"
      >
        <ChevronRight
          size={12}
          className={cn("transition-transform duration-150", open && "rotate-90")}
        />
        {busy ? "Loading the diff…" : open ? "Hide what changed" : "Show what changed"}
        {busy ? <Loader2 size={11} className="animate-spin" /> : null}
      </button>

      {open && note ? (
        <p className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]">{note}</p>
      ) : null}

      {open && lines ? (
        <div
          className="lore-scrollbar mt-2 max-h-72 overflow-auto rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2 text-[12px] leading-[1.65]"
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
      ) : null}
    </div>
  );
}
