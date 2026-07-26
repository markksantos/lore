"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn, formatCount } from "@/lib/utils";

type Health = {
  score: number;
  pages: number;
  words: number;
  orphans: { id: string; title: string; relPath: string }[];
  unresolved: { from: string; target: string }[];
  stale: { id: string; title: string; relPath: string; days: number }[];
  untagged: number;
};

export function HealthView({ onOpen }: { onOpen: (id: string) => void }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!health) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const tone =
    health.score >= 80
      ? "var(--lore-success)"
      : health.score >= 55
        ? "#d97706"
        : "var(--lore-danger)";

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Health
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          What an agent would trip over if it read this wiki today.
        </p>
      </header>

      <div className="mb-8 flex items-center gap-6 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-6 py-5">
        <div className="flex flex-col">
          <span
            className="text-[40px] font-semibold leading-none tracking-[-0.04em] tabular-nums"
            style={{ color: tone }}
          >
            {health.score}
          </span>
          <span className="t-meta mt-1 text-[var(--lore-text-tertiary)]">out of 100</span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Stat label="Pages" value={formatCount(health.pages)} />
          <Stat label="Words" value={formatCount(health.words)} />
          <Stat label="Orphans" value={formatCount(health.orphans.length)} />
          <Stat label="Dead links" value={formatCount(health.unresolved.length)} />
        </div>
      </div>

      <Section
        title="Orphans"
        note="Nothing links to these and they link nowhere. An agent following your wiki's links will never reach them."
        count={health.orphans.length}
        empty="Every page is connected."
      >
        {health.orphans.slice(0, 40).map((page) => (
          <Row key={page.id} onClick={() => onOpen(page.id)} label={page.title} meta={page.relPath} />
        ))}
      </Section>

      <Section
        title="Dead links"
        note="Wikilinks pointing at pages that don't exist yet. Each one is a page you meant to write."
        count={health.unresolved.length}
        empty="Every link resolves."
      >
        {health.unresolved.slice(0, 40).map((link, i) => (
          <Row
            key={`${link.from}-${link.target}-${i}`}
            onClick={() => onOpen(link.from)}
            label={link.target}
            meta={`from ${link.from}`}
          />
        ))}
      </Section>

      <Section
        title="Stale"
        note="Past their review window. Pricing and rates get 30 days, tooling 90, clients and projects 60, everything else 180."
        count={health.stale.length}
        empty="Nothing is overdue for a look."
      >
        {health.stale.slice(0, 40).map((page) => (
          <Row
            key={page.id}
            onClick={() => onOpen(page.id)}
            label={page.title}
            meta={`untouched ${page.days} days`}
          />
        ))}
      </Section>

      {health.untagged > 0 ? (
        <p className="t-body mt-8 text-[var(--lore-text-tertiary)]">
          {formatCount(health.untagged)} pages have no tags. Tags are the cheapest way to make
          a page findable by an agent that doesn&apos;t already know its title.
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[17px] font-semibold tabular-nums text-[var(--lore-text-primary)]">
        {value}
      </div>
      <div className="t-meta text-[var(--lore-text-tertiary)]">{label}</div>
    </div>
  );
}

function Section({
  title,
  note,
  count,
  empty,
  children,
}: {
  title: string;
  note: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold text-[var(--lore-text-primary)]">
        {title}
        <span
          className={cn(
            "text-[13px] font-normal tabular-nums",
            count === 0 ? "text-[var(--lore-success)]" : "text-[var(--lore-text-tertiary)]",
          )}
        >
          {count}
        </span>
      </h2>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">{note}</p>
      {count === 0 ? (
        <p className="t-body mt-2.5 text-[var(--lore-text-tertiary)]">{empty}</p>
      ) : (
        <div className="mt-2.5 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
          {children}
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  meta,
  onClick,
}: {
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
    >
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
        {label}
      </span>
      <span
        className="t-meta shrink-0 truncate text-[var(--lore-text-tertiary)]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {meta}
      </span>
    </button>
  );
}
