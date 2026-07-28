import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/marketing/brand-mark";
import { APP_PORT } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Offline",
  description: "Lore could not reach its local server.",
};

/**
 * The fallback the service worker serves when a page request fails.
 *
 * It deliberately promises nothing. Lore has no offline mode: the server is
 * the part that reads your markdown, so with the server gone there is no wiki
 * to show and no cached copy of one — nothing about your vault is ever stored
 * in the browser cache. This page exists to say that plainly instead of
 * leaving a dead tab.
 *
 * Kept static and dependency-free so it can be precached and rendered with no
 * server round trip.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--lore-accent)] text-white">
        <BrandMark size={22} />
      </span>

      <h1 className="t-step mt-5 text-[var(--lore-text-primary)]">Lore isn&rsquo;t running.</h1>

      <p className="t-body mt-3 max-w-md text-[var(--lore-text-secondary)]">
        This window can&rsquo;t reach the Lore server on your machine. Your wiki is read from
        disk on every request, so there is no offline copy to fall back on — and nothing
        from your vault is kept in this browser&rsquo;s cache.
      </p>

      <p className="t-meta mt-4 max-w-md text-[var(--lore-text-tertiary)]">
        Start it with <code>npm run dev</code> in the Lore folder, or open the desktop app,
        then try again. It listens on <code>127.0.0.1:{APP_PORT}</code>.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href="/vault"
          className="inline-flex h-9 items-center rounded-lg bg-[var(--lore-accent)] px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
        >
          Try again
        </Link>
        <Link
          href="/download"
          className="inline-flex h-9 items-center rounded-lg border border-[var(--lore-border-strong)] bg-[var(--lore-surface)] px-4 text-[13.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:text-[var(--lore-text-primary)]"
        >
          Install instructions
        </Link>
      </div>
    </main>
  );
}
