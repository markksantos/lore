"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import { PageSection } from "@/components/lore/page-section";
import type { PageMeta } from "@/lib/types";
import type { Proposal } from "@/components/lore/page-section";

export type Section = {
  page: PageMeta;
  raw: string;
  proposals: Proposal[];
};

type FolderData = {
  folder: string;
  sections: Section[];
  /** Proposals that would create a new page here — no section to attach to. */
  incoming: Proposal[];
  totals: { count: number; added: number; removed: number };
};

/**
 * A folder rendered as one continuous document.
 *
 * This is the whole idea: you don't open files, you read a folder. Each page is
 * a coloured section in a single scroll, editable in place, and an agent's
 * proposal appears inside the section it would change rather than in a queue
 * somewhere else. Approving a change happens where you're already reading it.
 */
export function FolderDocument({
  folder,
  revision,
  pageTitles,
  focusPage,
  onOpenPage,
  onChanged,
}: {
  folder: string;
  revision: number;
  pageTitles: Map<string, string>;
  focusPage: string | null;
  onOpenPage: (pageId: string) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<FolderData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/folder?path=${encodeURIComponent(folder)}`);
    if (!response.ok) {
      setError((await response.json()).error ?? "Could not open that folder.");
      return;
    }
    setError(null);
    setData(await response.json());
  }, [folder]);

  useEffect(() => {
    load();
  }, [load, revision]);

  // Search lands you on a page, not a folder, so the document scrolls to it
  // once its section has actually rendered.
  useEffect(() => {
    if (!focusPage || !data) return;
    const el = document.getElementById(`sec-${cssId(focusPage)}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusPage, data]);

  async function resolveAll(action: "accept" | "reject") {
    if (!data) return;
    const ids = [
      ...data.sections.flatMap((s) => s.proposals.map((p) => p.id)),
      ...data.incoming.map((p) => p.id),
    ];
    if (!ids.length) return;

    setBusy(true);
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ids }),
    });
    const result = await response.json();
    setBusy(false);

    if (result.failures?.length) {
      setError(
        `${result.resolved} applied, ${result.failures.length} could not: ${result.failures[0].message}`,
      );
    }
    await load();
    onChanged();
  }

  if (error && !data) {
    return (
      <Empty title="Could not open that folder" body={error} />
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const { totals } = data;

  return (
    <div ref={scrollRef} className="mx-auto max-w-3xl px-8 py-9">
      <header>
        <h1 className="text-[27px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          {data.folder || "Root"}
        </h1>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          {data.sections.length} {data.sections.length === 1 ? "page" : "pages"}
        </p>
      </header>

      {/* One bar for the whole folder. Creed puts this above the document, not
          in a separate screen, so the state of the wiki is visible while you
          read it rather than something you have to go and check. */}
      {totals.count > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] py-2 pl-4 pr-2">
          <span
            className="text-[13px] font-semibold tabular-nums text-[var(--lore-success)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            +{totals.added}
          </span>
          <span
            className="text-[13px] font-semibold tabular-nums text-[var(--lore-danger)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            −{totals.removed}
          </span>
          <span className="t-meta text-[var(--lore-text-secondary)]">
            {totals.count} {totals.count === 1 ? "proposal" : "proposals"}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => resolveAll("reject")}
            disabled={busy}
            className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-50"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={() => resolveAll("accept")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            Accept all
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--lore-danger)]/30 px-3.5 py-2.5 text-[13px] text-[var(--lore-danger)]">
          {error}
        </p>
      ) : null}

      {data.sections.length === 0 && data.incoming.length === 0 ? (
        <Empty
          title="Nothing here yet"
          body="This folder has no markdown pages. Create one from the sidebar."
        />
      ) : null}

      <div className="mt-2">
        {data.sections.map((section, i) => (
          <PageSection
            key={section.page.relPath}
            index={i}
            id={`sec-${cssId(section.page.relPath)}`}
            section={section}
            pageTitles={pageTitles}
            onOpenPage={onOpenPage}
            onChanged={async () => {
              await load();
              onChanged();
            }}
          />
        ))}

        {data.incoming.map((proposal) => (
          <IncomingSection
            key={proposal.id}
            proposal={proposal}
            onChanged={async () => {
              await load();
              onChanged();
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A proposal to create a page that doesn't exist yet. Rendered as a ghost
 * section at the end of the document — dashed, uncoloured — so a page an agent
 * wants to add is visibly not part of the wiki until it's accepted.
 */
function IncomingSection({
  proposal,
  onChanged,
}: {
  proposal: Proposal;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function resolve(action: "accept" | "reject") {
    setBusy(true);
    await fetch("/api/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id: proposal.id }),
    });
    setBusy(false);
    onChanged();
  }

  return (
    <section className="mt-9 rounded-xl border border-dashed border-[var(--lore-border-strong)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-[var(--lore-text-secondary)]">
          {proposal.relPath.split("/").pop()?.replace(/\.mdx?$/i, "")}
        </span>
        <span className="t-meta text-[var(--lore-text-tertiary)]">
          new page · proposed by {proposal.agent}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => resolve("reject")}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] disabled:opacity-50"
        >
          <X size={13} />
          Reject
        </button>
        <button
          type="button"
          onClick={() => resolve("accept")}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-2.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Accept
        </button>
      </div>
      <p className="t-body mt-2 text-[var(--lore-text-secondary)]">{proposal.reason}</p>
      <pre
        className="lore-scrollbar mt-2.5 max-h-56 overflow-auto rounded-lg bg-[var(--lore-background)] px-3 py-2.5 text-[12px] leading-[1.65] text-[var(--lore-text-secondary)]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {proposal.proposed}
      </pre>
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-16 flex flex-col items-center px-8 text-center">
      <p className="text-[15px] font-medium text-[var(--lore-text-secondary)]">{title}</p>
      <p className="t-body mt-1.5 max-w-sm text-[var(--lore-text-tertiary)]">{body}</p>
    </div>
  );
}

/** A path is not a valid DOM id fragment; slashes and dots have to go. */
function cssId(relPath: string): string {
  return relPath.replace(/[^a-zA-Z0-9]/g, "-");
}
