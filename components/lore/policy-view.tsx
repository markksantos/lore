"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn, count } from "@/lib/utils";

/**
 * Trust policy — how long a page stays true, and what a sign-off writes down.
 *
 * The policy has been real since the trust ledger shipped, and until now it was
 * editable only by hand-editing JSON in ~/.lore or POSTing to the API. That is
 * the same failure the product exists to fix, committed by the product: data
 * that governs what you see, kept somewhere you cannot see it.
 *
 * Rules are matched in order against the page id and title, so the panel shows
 * the coverage the server computes rather than making anyone guess whether a
 * regex caught anything.
 */

type Rule = { match: string; days: number; label?: string };

type Policy = {
  rules: Rule[];
  defaultDays: number;
  decayDays: number;
  quarantined: string[];
  stampFrontmatter: boolean;
};

type PolicyResponse = {
  policy: Policy;
  coverage: { match: string; pages: number }[];
  fallbackPages: number;
  totalPages: number;
};

export function PolicyView() {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PolicyResponse | null) => {
        setData(d);
        setDraft(d?.policy ?? null);
      })
      .catch(() => setData(null));
  }, []);

  async function save(next: Policy) {
    setDraft(next);
    setSaving(true);
    setSaved(false);
    const response = await fetch("/api/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) return;
    // Re-read rather than trust the echo: the server clamps day counts and
    // drops empty rules, and showing the draft would hide that it did.
    const fresh = await fetch("/api/policy").then((r) => (r.ok ? r.json() : null));
    if (fresh) {
      setData(fresh);
      setDraft(fresh.policy);
    }
    setSaved(true);
  }

  if (!draft || !data) {
    return (
      <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-6">
        <div className="flex justify-center text-[var(--lore-text-tertiary)]">
          <Loader2 size={16} className="animate-spin" />
        </div>
      </section>
    );
  }

  const coverage = new Map(data.coverage.map((c) => [c.match, c.pages]));

  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
          Trust policy
        </p>
        {saving ? (
          <Loader2 size={12} className="animate-spin text-[var(--lore-text-tertiary)]" />
        ) : saved ? (
          <span className="t-meta text-[var(--lore-success)]">Saved</span>
        ) : null}
      </div>

      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        Nothing decays at one rate. A pricing note is wrong within a month; why you chose
        Postgres is still true in three years. The first matching rule wins.
      </p>

      <div className="mt-4 space-y-2">
        {draft.rules.map((rule, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={rule.match}
              onChange={(e) => {
                const rules = draft.rules.map((r, j) =>
                  j === i ? { ...r, match: e.target.value } : r,
                );
                setDraft({ ...draft, rules });
              }}
              onBlur={() => save(draft)}
              spellCheck={false}
              placeholder="pricing  or  /client|project/"
              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 text-[13px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            />
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                value={rule.days}
                onChange={(e) => {
                  const rules = draft.rules.map((r, j) =>
                    j === i ? { ...r, days: Number(e.target.value) } : r,
                  );
                  setDraft({ ...draft, rules });
                }}
                onBlur={() => save(draft)}
                className="h-8 w-16 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 text-right text-[13px] tabular-nums text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
              />
              <span className="t-meta w-24 text-[var(--lore-text-tertiary)]">
                days · {count(coverage.get(rule.match) ?? 0, "page")}
              </span>
              <button
                type="button"
                aria-label={`Delete the rule matching ${rule.match}`}
                onClick={() =>
                  save({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })
                }
                className="rounded-md p-1.5 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-danger)]"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setDraft({ ...draft, rules: [...draft.rules, { match: "", days: 90 }] })
        }
        className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
      >
        <Plus size={13} />
        Add a rule
      </button>

      <div className="mt-5 grid gap-3 border-t border-[var(--lore-border)] pt-4 sm:grid-cols-2">
        <DayField
          label="Everything else"
          suffix={`days · ${data.fallbackPages} pages`}
          value={draft.defaultDays}
          onChange={(defaultDays) => setDraft({ ...draft, defaultDays })}
          onCommit={() => save(draft)}
        />
        <DayField
          label="A sign-off ages after"
          suffix="days"
          value={draft.decayDays}
          onChange={(decayDays) => setDraft({ ...draft, decayDays })}
          onCommit={() => save(draft)}
        />
      </div>

      {/* The one setting here that edits the user's own files, so it says so. */}
      <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-[var(--lore-border)] pt-4">
        <input
          type="checkbox"
          checked={draft.stampFrontmatter}
          onChange={(e) => save({ ...draft, stampFrontmatter: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--lore-accent)]"
        />
        <span>
          <span className="text-[13.5px] font-medium text-[var(--lore-text-primary)]">
            Write sign-offs into the page
          </span>
          <span className="t-meta mt-1 block text-[var(--lore-text-secondary)]">
            Adds <code>lore_verified: 2026-07-28</code> to the frontmatter when you sign a
            page off, so Dataview can query it. This edits your markdown — off by default,
            because the ledger otherwise lives outside the vault and your files never change.
            Ignored while Lore is in read-only mode.
          </span>
        </span>
      </label>

      {draft.quarantined.length > 0 ? (
        <div className="mt-5 border-t border-[var(--lore-border)] pt-4">
          <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
            Withheld from agents
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {draft.quarantined.map((pageId) => (
              <button
                key={pageId}
                type="button"
                onClick={() =>
                  save({
                    ...draft,
                    quarantined: draft.quarantined.filter((q) => q !== pageId),
                  })
                }
                title="Release this page"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12.5px] text-[var(--lore-text-secondary)] transition-colors hover:border-[var(--lore-danger)]/40 hover:text-[var(--lore-danger)]"
              >
                {pageId}
                <Trash2 size={11} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DayField({
  label,
  suffix,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[13.5px] text-[var(--lore-text-secondary)]">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onBlur={onCommit}
          className={cn(
            "h-8 w-16 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2",
            "text-right text-[13px] tabular-nums text-[var(--lore-text-primary)] outline-none",
            "focus:border-[var(--lore-accent)]",
          )}
        />
        <span className="t-meta whitespace-nowrap text-[var(--lore-text-tertiary)]">
          {suffix}
        </span>
      </span>
    </label>
  );
}
