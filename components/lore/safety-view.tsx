"use client";

import { useState } from "react";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The read-only switch, after onboarding.
 *
 * It was set once in the first-run wizard and then had no control anywhere —
 * on by default, blocking eight routes, changeable only by editing a file in
 * ~/.lore or POSTing to the API. So the promise the wizard makes ("Lore will
 * not touch your files") was real, and the way back out of it was invisible:
 * anyone who later wanted Lore to write had a feature that simply appeared
 * broken, with the reason stated once, days earlier, on a screen they cannot
 * return to.
 *
 * Living in Settings under the linked folder, because that is what it is about
 * — what this program may do to that folder — rather than under trust, which is
 * about what you believe of its contents.
 */

export type Safety = {
  readOnly: boolean;
  changedAt: number | null;
  /** Set by hosts where the lock is not ours to lift, e.g. the browser build. */
  locked?: boolean;
  blocks: { route: string; methods: string[] }[];
};

/**
 * `safety` is owned by SettingsView and shared with the trust panel below,
 * which changes what it says depending on whether Lore may write. Holding a
 * second copy here meant unlocking left that panel still warning that nothing
 * was being written — true a second earlier, and now stale and wrong.
 */
export function SafetyView({
  safety,
  onChange,
}: {
  safety: Safety | null;
  onChange: (next: Safety) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    const response = await fetch("/api/safety", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readOnly: next }),
    }).catch(() => null);

    /*
     * Re-read rather than adopt the PUT's reply.
     *
     * The two payloads are not the same shape — PUT answers with the new state
     * alone, GET adds the route list — so taking the reply as the whole truth
     * dropped `blocks` and blew the component up on the next render, one click
     * after arriving. Asking the canonical endpoint is one request and removes
     * the entire class of mistake.
     */
    if (response?.ok) {
      const fresh = await fetch("/api/safety")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (fresh) onChange(fresh as Safety);
    }
    setBusy(false);
  }

  if (!safety) return null;

  // Where the lock belongs to the platform there is nothing to offer, and a
  // disabled switch would imply this is a preference we are withholding.
  if (safety.locked) {
    return (
      <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--lore-text-primary)]">
          <Lock size={14} className="text-[var(--lore-text-tertiary)]" />
          Read-only
        </p>
        <p className="t-meta mt-1.5 text-[var(--lore-text-secondary)]">
          Your browser gave this tab read access to the folder and nothing more, so Lore
          cannot change your files here even if it tried. This is not a setting — it is what
          the browser will allow.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--lore-text-primary)]">
            {safety.readOnly ? (
              <Lock size={14} className="text-[var(--lore-success)]" />
            ) : (
              <LockOpen size={14} className="text-[#b45309] dark:text-[#fbbf24]" />
            )}
            {safety.readOnly ? "Read-only — Lore cannot change your wiki" : "Lore can write to your wiki"}
          </p>
          <p className="t-meta mt-1.5 max-w-xl text-[var(--lore-text-secondary)]">
            {safety.readOnly
              ? "Every route that could create, edit or delete a page is refused at the door. Reading, searching, and signing pages off all still work — a sign-off is a note in Lore's own ledger, not a change to your files."
              : "Editing pages in Lore, importing files, autolinking and maintenance can now change the markdown on your disk. Your agents were always able to write; this is about whether Lore is."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => toggle(!safety.readOnly)}
          disabled={busy}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-50",
            safety.readOnly
              ? "border border-[var(--lore-border-strong)] text-[var(--lore-text-primary)] hover:bg-[var(--lore-surface-raised)]"
              : "bg-[var(--lore-success)] text-white hover:opacity-90",
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {safety.readOnly ? "Let Lore write" : "Lock it back"}
        </button>
      </div>

      {/* Defensive too: a host that answers without a route list is reduced,
          not broken, and must not take the switch down with it. */}
      {safety.blocks?.length ? (
        <div className="mt-3.5 border-t border-[var(--lore-border)] pt-3">
          <button
            type="button"
            onClick={() => setShowRoutes((v) => !v)}
            aria-expanded={showRoutes}
            className="t-meta text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-primary)]"
          >
            {showRoutes ? "Hide" : "Show"} the {safety.blocks.length} routes the lock covers
          </button>
          {showRoutes ? (
            <ul
              className="mt-2 space-y-1 text-[12px] text-[var(--lore-text-tertiary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {safety.blocks.map((b) => (
                <li key={b.route}>
                  {b.methods.join(" ")} {b.route}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
