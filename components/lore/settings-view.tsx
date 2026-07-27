"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Unlink } from "lucide-react";
import type { VaultIndex } from "@/lib/types";
import { AiView } from "@/components/lore/ai-view";
import { paletteVars } from "@/lib/palette";
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

/**
 * Settings — the vault, and the health of what's in it.
 *
 * Health lives here rather than in the nav on purpose: it is something you
 * check occasionally, not a place you work. Giving it a permanent tab implied
 * the document wasn't the whole product.
 */
export function SettingsView({
  index,
  onOpenPage,
  onChanged,
}: {
  index: VaultIndex;
  onOpenPage: (pageId: string) => void;
  onChanged: () => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [rescanning, setRescanning] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [index.scannedAt]);

  async function rescan() {
    setRescanning(true);
    await fetch("/api/pages?refresh=1");
    const response = await fetch("/api/health");
    if (response.ok) setHealth(await response.json());
    setRescanning(false);
    onChanged();
  }

  async function unlink() {
    await fetch("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unlink", root: index.root }),
    });
    window.location.reload();
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Settings
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          The folder Lore is reading, and what an agent would trip over inside it.
        </p>
      </header>

      <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
        <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
          Linked folder
        </p>
        <p
          className="mt-1.5 break-all text-[13px] text-[var(--lore-text-primary)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {index.root.replace(/^\/Users\/[^/]+/, "~")}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={rescan}
            disabled={rescanning}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-60"
          >
            {rescanning ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Rescan
          </button>
          <button
            type="button"
            onClick={unlink}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:border-[var(--lore-danger)]/40 hover:text-[var(--lore-danger)]"
          >
            <Unlink size={13} />
            Unlink
          </button>
        </div>
        <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
          Unlinking forgets the path. It never touches the folder.
        </p>
      </section>

      <div className="mt-8">
        <AiView />
      </div>

      {!health ? (
        <div className="mt-10 flex justify-center text-[var(--lore-text-tertiary)]">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <>
          <h2 className="mt-10 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            Health
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <ScorePlate score={health.score} />
            <StatPlate slot={4} value={formatCount(health.pages)} label="Pages" />
            <StatPlate slot={5} value={formatCount(health.orphans.length)} label="Orphans" />
            <StatPlate
              slot={2}
              value={formatCount(health.unresolved.length)}
              label="Dead links"
            />
          </div>

          <Group
            slot={0}
            title="Orphans"
            note="Nothing links to these and they link nowhere. An agent following your links never reaches them."
            count={health.orphans.length}
            empty="Every page is connected."
          >
            {health.orphans.slice(0, 40).map((p) => (
              <Row key={p.id} label={p.title} meta={p.relPath} onClick={() => onOpenPage(p.id)} />
            ))}
          </Group>

          <Group
            slot={2}
            title="Dead links"
            note="Wikilinks pointing at pages that don't exist yet. Each one is a page you meant to write."
            count={health.unresolved.length}
            empty="Every link resolves."
          >
            {health.unresolved.slice(0, 40).map((l, i) => (
              <Row
                key={`${l.from}-${l.target}-${i}`}
                label={l.target}
                meta={`from ${l.from}`}
                onClick={() => onOpenPage(l.from)}
              />
            ))}
          </Group>

          <Group
            slot={6}
            title="Stale"
            note="Past their review window — pricing 30 days, clients 60, tooling 90, everything else 180."
            count={health.stale.length}
            empty="Nothing is overdue for a look."
          >
            {health.stale.slice(0, 40).map((p) => (
              <Row
                key={p.id}
                label={p.title}
                meta={`untouched ${p.days} days`}
                onClick={() => onOpenPage(p.id)}
              />
            ))}
          </Group>

          {health.untagged > 0 ? (
            <p className="t-body mt-7 text-[var(--lore-text-tertiary)]">
              {formatCount(health.untagged)} pages have no tags. Tags are the cheapest way to
              make a page findable by an agent that doesn&apos;t already know its title.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The score gets the one plate whose colour is driven by the value, not the slot. */
function ScorePlate({ score }: { score: number }) {
  const slot = score >= 80 ? 3 : score >= 55 ? 6 : 1;
  return (
    <div style={paletteVars(slot)} className="plate px-4 py-3.5">
      <div className="text-[30px] font-bold leading-none tracking-[-0.04em] tabular-nums">
        {score}
      </div>
      <div className="plate-muted mt-2 text-[12px] font-semibold">Health score</div>
    </div>
  );
}

function StatPlate({ slot, value, label }: { slot: number; value: string; label: string }) {
  return (
    <div style={paletteVars(slot)} className="plate px-4 py-3.5">
      <div className="text-[30px] font-bold leading-none tracking-[-0.04em] tabular-nums">
        {value}
      </div>
      <div className="plate-muted mt-2 text-[12px] font-semibold">{label}</div>
    </div>
  );
}

function Group({
  slot,
  title,
  note,
  count,
  empty,
  children,
}: {
  slot: number;
  title: string;
  note: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section style={paletteVars(slot)} className="mt-8">
      <h3 className="flex items-center gap-2.5 text-[15px] font-semibold">
        <span className="pal-bar !h-5" />
        <span className="pal-title">{title}</span>
        <span
          className={cn(
            "text-[13px] font-normal tabular-nums",
            count === 0 ? "text-[var(--lore-success)]" : "text-[var(--lore-text-tertiary)]",
          )}
        >
          {count}
        </span>
      </h3>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">{note}</p>
      {count === 0 ? (
        <p className="t-body mt-2 text-[var(--lore-text-tertiary)]">{empty}</p>
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
