"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, Loader2, Inbox } from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";

type Proposal = {
  id: string;
  relPath: string;
  agent: string;
  reason: string;
  kind: "create" | "append" | "replace";
  risk: "low" | "medium" | "high";
  proposed: string;
  base: string | null;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
  stats: { added: number; removed: number };
};

const RISK_STYLE: Record<Proposal["risk"], string> = {
  low: "text-[var(--lore-text-tertiary)] border-[var(--lore-border)]",
  medium: "text-[#b45309] border-[#b45309]/35 dark:text-[#fbbf24] dark:border-[#fbbf24]/30",
  high: "text-[var(--lore-danger)] border-[var(--lore-danger)]/35",
};

export function ReviewView({
  onResolved,
  onOpen,
}: {
  onResolved: () => void;
  onOpen: (relPath: string) => void;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/proposals");
    if (response.ok) setProposals((await response.json()).proposals);
    else setProposals([]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(id: string, action: "accept" | "reject") {
    setBusy(id);
    setError(null);

    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id }),
    });

    if (!response.ok) setError((await response.json()).error ?? "Could not resolve that.");

    setBusy(null);
    await load();
    onResolved();
  }

  if (!proposals) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending").slice(0, 20);

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Review
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Agents propose changes here. Nothing touches your wiki until you accept it.
        </p>
      </header>

      {error ? (
        <p className="mb-5 rounded-lg border border-[var(--lore-danger)]/30 bg-[var(--lore-danger)]/8 px-3.5 py-2.5 text-[13px] text-[var(--lore-danger)]">
          {error}
        </p>
      ) : null}

      {pending.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lore-border)] px-8 py-14 text-center">
          <Inbox size={22} className="text-[var(--lore-text-tertiary)]" />
          <p className="mt-3 text-[14px] font-medium text-[var(--lore-text-secondary)]">
            Nothing waiting
          </p>
          <p className="t-body mt-1 max-w-xs text-[var(--lore-text-tertiary)]">
            Connect an agent from the Agents tab and it will start proposing updates as it
            learns things worth keeping.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              busy={busy === proposal.id}
              onResolve={resolve}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--lore-text-tertiary)]">
            Recent
          </h2>
          <ul className="mt-3 space-y-1">
            {resolved.map((proposal) => (
              <li
                key={proposal.id}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px]"
              >
                <span
                  className={cn(
                    "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                    proposal.status === "accepted"
                      ? "bg-[var(--lore-success)]/15 text-[var(--lore-success)]"
                      : "bg-[var(--lore-text-tertiary)]/15 text-[var(--lore-text-tertiary)]",
                  )}
                >
                  {proposal.status === "accepted" ? <Check size={10} /> : <X size={10} />}
                </span>
                <span className="truncate text-[var(--lore-text-secondary)]">
                  {proposal.relPath}
                </span>
                <span className="t-meta ml-auto shrink-0 text-[var(--lore-text-tertiary)]">
                  {proposal.agent} · {relativeTime(proposal.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ProposalCard({
  proposal,
  busy,
  onResolve,
  onOpen,
}: {
  proposal: Proposal;
  busy: boolean;
  onResolve: (id: string, action: "accept" | "reject") => void;
  onOpen: (relPath: string) => void;
}) {
  const lines = diffLines(proposal.base ?? "", proposal.proposed);

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--lore-border)] px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-[var(--lore-text-primary)]">
              {proposal.agent}
            </span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                RISK_STYLE[proposal.risk],
              )}
            >
              {proposal.risk}
            </span>
            <span className="t-meta text-[var(--lore-text-tertiary)]">
              {proposal.kind} · {relativeTime(proposal.createdAt)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpen(proposal.relPath)}
            className="mt-1 block max-w-full truncate text-left text-[12px] text-[var(--lore-accent)] hover:underline"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {proposal.relPath}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="t-meta mr-1 tabular-nums text-[var(--lore-text-tertiary)]">
            <span className="text-[var(--lore-success)]">+{proposal.stats.added}</span>{" "}
            <span className="text-[var(--lore-danger)]">−{proposal.stats.removed}</span>
          </span>
          <button
            type="button"
            onClick={() => onResolve(proposal.id, "reject")}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] disabled:opacity-50"
          >
            <X size={13} />
            Reject
          </button>
          <button
            type="button"
            onClick={() => onResolve(proposal.id, "accept")}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Accept
          </button>
        </div>
      </div>

      <p className="t-body px-4 py-3 text-[var(--lore-text-secondary)]">{proposal.reason}</p>

      <div
        className="lore-scrollbar max-h-72 overflow-auto border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-4 py-3 text-[12.5px] leading-[1.65]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words px-1",
              line.type === "add" && "bg-[var(--lore-success)]/12 text-[var(--lore-success)]",
              line.type === "remove" && "bg-[var(--lore-danger)]/10 text-[var(--lore-danger)]",
              line.type === "same" && "text-[var(--lore-text-tertiary)]",
            )}
          >
            {line.type === "add" ? "+ " : line.type === "remove" ? "− " : "  "}
            {line.text || " "}
          </div>
        ))}
      </div>
    </article>
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
