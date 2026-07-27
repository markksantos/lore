import type { ReactNode } from "react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";

/**
 * The shell for the text-only pages — privacy, terms, changelog.
 *
 * Narrower than the marketing sections because these are read rather than
 * scanned, and a legal page set at the width of a hero is a legal page nobody
 * finishes.
 */
export function ProsePage({
  eyebrow,
  title,
  lede,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <>
      <MarketingHeader />

      <main className="mx-auto max-w-2xl px-6 pb-24 pt-32 md:px-8">
        <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
          {eyebrow}
        </p>
        <h1 className="t-section mt-3 text-[var(--lore-text-primary)]">{title}</h1>
        <p className="t-lede mt-4 text-[var(--lore-text-secondary)]">{lede}</p>
        {updated ? (
          <p className="t-meta mt-4 text-[var(--lore-text-tertiary)]">Last updated {updated}</p>
        ) : null}

        <div className="mt-12">{children}</div>
      </main>

      <MarketingFooter />
    </>
  );
}

export function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        {title}
      </h2>
      <div className="mt-2.5 space-y-3 text-[15px] leading-[1.75] text-[var(--lore-text-secondary)]">
        {children}
      </div>
    </section>
  );
}
