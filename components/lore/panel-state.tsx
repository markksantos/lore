"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

/**
 * What a Settings panel shows before its data arrives, and when it never does.
 *
 * Both of these panels used to render a bare spinning circle with no heading
 * and no text, and — because a failed fetch set their state back to null — kept
 * spinning forever when the request failed. Two anonymous circles at the bottom
 * of Settings is indistinguishable from a broken app, which is exactly what the
 * first person to see it concluded.
 *
 * So a loading panel says which panel it is, and a failure says so and offers
 * the retry. Nothing here spins without a name attached.
 */
export function PanelLoading({ title, note }: { title: string; note?: string }) {
  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--lore-text-primary)]">
        <Loader2 size={13} className="animate-spin text-[var(--lore-text-tertiary)]" />
        {title}
      </p>
      {note ? (
        <p className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]">{note}</p>
      ) : null}
    </section>
  );
}

export function PanelFailed({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--lore-text-primary)]">
        <AlertTriangle size={13} className="text-[#b45309] dark:text-[#fbbf24]" />
        {title}
      </p>
      <p className="t-meta mt-1.5 max-w-xl text-[var(--lore-text-secondary)]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
      >
        <RefreshCw size={12} />
        Try again
      </button>
    </section>
  );
}
