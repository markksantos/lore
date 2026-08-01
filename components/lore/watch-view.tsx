"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Loader2,
  Pin,
  Plus,
  RotateCcw,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import { cn, count, relativeTime } from "@/lib/utils";

/**
 * Watch — everything Lore noticed that a person has to decide about.
 *
 * These checks existed already and were scattered across four screens and two
 * APIs, which meant each was individually easy to miss and collectively easy to
 * ignore. Supervision is one job — is my wiki going wrong, and where — so it
 * gets one screen, ordered by how much a wrong answer costs:
 *
 *   1. Canon violated. You asserted a fact and a page disagrees. There is a
 *      right answer here and the wiki does not have it.
 *   2. Alerts. Something touched a folder you asked to be told about.
 *   3. Contradictions. Two pages disagree and neither is pinned, so this is a
 *      question rather than an error.
 *   4. Undo. One agent, one bad afternoon, one button.
 *   5. Archive. Pages nothing reads, links to, or edits.
 *
 * Nothing here acts on its own. Every row is a finding with the evidence
 * attached, because the person who wrote these pages is the only one who can
 * tell an obsolete note from a note about something that has not come up yet.
 */

type CanonFact = { id: string; text: string; addedAt: number };
type CanonViolation = {
  fact: CanonFact;
  canonValue: number;
  confidence: number;
  claim: { relPath: string; title: string; text: string; value: number; unit: string; line: number };
};
type Alert = {
  at: number;
  kind: string;
  relPath: string;
  agent: string | null;
  message: string;
  readAt?: number;
};
type Contradiction = {
  subject: string;
  kind: string;
  confidence: number;
  crossSubject: boolean;
  claims: { pageId: string; relPath: string; title: string; text: string; value: number; unit: string; trust: string; at: number }[];
};
type PruneCandidate = {
  id: string;
  relPath: string;
  title: string;
  words: number;
  ageDays: number;
  reason: string;
  confidence: number;
};
type UndoPlan = {
  agent: string;
  revertable: number;
  targets: { relPath: string; state: string; note?: string }[];
};

export function WatchView({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const [canon, setCanon] = useState<{ facts: CanonFact[]; violations: CanonViolation[] } | null>(
    null,
  );
  const [alerts, setAlerts] = useState<{ alerts: Alert[]; unread: number } | null>(null);
  const [contradictions, setContradictions] = useState<Contradiction[] | null>(null);
  const [prune, setPrune] = useState<{ candidates: PruneCandidate[] } | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [plan, setPlan] = useState<UndoPlan | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const get = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    const [c, a, an, p, u] = await Promise.all([
      get("/api/canon"),
      get("/api/alerts"),
      get("/api/analysis?kind=contradictions"),
      get("/api/prune"),
      get("/api/usage"),
    ]);
    setCanon(c ?? { facts: [], violations: [] });
    setAlerts(a ?? { alerts: [], unread: 0 });
    setContradictions(an?.contradictions ?? []);
    setPrune(p ?? { candidates: [] });
    setAgents(
      (u?.receipts ?? [])
        .filter((r: { human: boolean; writes: number }) => !r.human && r.writes > 0)
        .map((r: { agent: string }) => r.agent),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addFact = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await fetch("/api/canon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", text }),
    }).catch(() => null);
    load();
  };

  const removeFact = async (id: string) => {
    await fetch("/api/canon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remove", id }),
    }).catch(() => null);
    load();
  };

  const previewUndo = async (agent: string) => {
    setBusy(true);
    const result = await fetch(`/api/undo?agent=${encodeURIComponent(agent)}&days=7`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    setPlan(result);
    setBusy(false);
  };

  const runUndo = async () => {
    if (!plan) return;
    setBusy(true);
    await fetch("/api/undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: plan.agent, days: 7 }),
    }).catch(() => null);
    setPlan(null);
    setBusy(false);
    load();
  };

  const dismissAlerts = async () => {
    await fetch("/api/alerts", { method: "POST" }).catch(() => null);
    load();
  };

  if (!canon || !alerts) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const live = (contradictions ?? []).filter((c) => !c.crossSubject);

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Watch
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          What Lore noticed that needs a person. Nothing here changes anything on its own.
        </p>
      </header>

      {/* ------------------------------------------------------------- canon */}
      <section>
        <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <Pin size={16} className="text-[var(--lore-text-tertiary)]" />
          Canon
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          The few facts you state yourself. Everything else in Lore is inference and can be
          wrong; these cannot be outvoted by an agent, and they ride above every context
          pack outside the token budget.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addFact();
            }}
            placeholder="The video edit floor is $150 per finished video."
            className="min-w-0 flex-1 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3 py-2 text-[13.5px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-text-tertiary)]"
          />
          <button
            type="button"
            onClick={addFact}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            <Plus size={13} />
            Pin
          </button>
        </div>

        {canon.facts.length ? (
          <ul className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
            {canon.facts.map((f) => (
              <li key={f.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 text-[13.5px] text-[var(--lore-text-primary)]">
                  {f.text}
                </span>
                <button
                  type="button"
                  onClick={() => removeFact(f.id)}
                  aria-label="Remove this fact"
                  className="shrink-0 text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-danger)]"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {canon.violations.length ? (
          <div className="mt-3 space-y-2">
            {canon.violations.slice(0, 10).map((v, i) => (
              <button
                key={`${v.fact.id}-${i}`}
                type="button"
                onClick={() => onOpenPage(v.claim.relPath.replace(/\.mdx?$/, ""))}
                className="block w-full rounded-xl border border-[var(--lore-danger)] bg-[var(--lore-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
              >
                <p className="text-[13.5px] text-[var(--lore-text-primary)]">
                  <span className="font-medium">{v.claim.title}</span> says {v.claim.value}, canon
                  says {v.canonValue}.
                </p>
                <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
                  {v.claim.relPath}:{v.claim.line} — {v.claim.text.slice(0, 110)}
                </p>
              </button>
            ))}
          </div>
        ) : canon.facts.length ? (
          <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
            No page contradicts anything you have pinned.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------------ alerts */}
      {alerts.alerts.length ? (
        <section className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
              <AlertTriangle size={16} className="text-[var(--lore-text-tertiary)]" />
              Alerts
              {alerts.unread ? (
                <span className="rounded-full bg-[var(--lore-danger)] px-1.5 py-px text-[11px] font-semibold text-white">
                  {alerts.unread}
                </span>
              ) : null}
            </h2>
            <button
              type="button"
              onClick={dismissAlerts}
              className="t-meta text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-primary)]"
            >
              Mark all read
            </button>
          </div>
          <ul className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
            {alerts.alerts.slice(0, 12).map((a, i) => (
              <li
                key={`${a.at}-${i}`}
                className={cn("px-4 py-2.5", !a.readAt && "bg-[var(--lore-surface-raised)]")}
              >
                <p className="text-[13.5px] text-[var(--lore-text-primary)]">{a.message}</p>
                <p className="t-meta mt-0.5 text-[var(--lore-text-tertiary)]">
                  {relativeTime(a.at)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --------------------------------------------------- contradictions */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <ScrollText size={16} className="text-[var(--lore-text-tertiary)]" />
          Disagreements
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          Two pages about one subject holding different numbers. Only same-subject pairs are
          shown — across subjects, two clients with different rates look identical to a
          genuine conflict, and a false one costs more attention than a missed one.
        </p>
        {live.length ? (
          <div className="mt-3 space-y-2">
            {live.slice(0, 10).map((c, i) => (
              <div
                key={`${c.subject}-${i}`}
                className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3"
              >
                <p className="text-[13.5px] text-[var(--lore-text-primary)]">
                  <span className="font-medium">{c.subject}</span> —{" "}
                  {[...new Set(c.claims.map((x) => x.value))].join(" vs ")}
                </p>
                {/*
                  * One row per sentence, with its value.
                  *
                  * Two claims extracted from the same sentence — "$150 must be
                  * withdrawn before the $100 one" is genuinely two — rendered
                  * as two identical lines, which reads as a duplicate-row bug
                  * rather than as the disagreement it is. The value leads, so
                  * the same sentence appearing twice is legible, and exact
                  * repeats of the same page, sentence AND value are dropped.
                  */}
                <ul className="mt-1.5 space-y-1">
                  {c.claims
                    .filter(
                      (claim, j, all) =>
                        all.findIndex(
                          (other) =>
                            other.relPath === claim.relPath &&
                            other.text === claim.text &&
                            other.value === claim.value,
                        ) === j,
                    )
                    .slice(0, 5)
                    .map((claim, j) => (
                      <li key={j}>
                        <button
                          type="button"
                          onClick={() => onOpenPage(claim.pageId)}
                          className="t-meta flex w-full items-baseline gap-2 text-left text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-primary)]"
                        >
                          <span className="shrink-0 font-semibold tabular-nums text-[var(--lore-text-secondary)]">
                            {claim.value}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {claim.relPath} — {claim.text.slice(0, 90)}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
            {contradictions === null ? "Checking…" : "No page disagrees with another about a number."}
          </p>
        )}
      </section>

      {/* -------------------------------------------------------------- undo */}
      {agents.length ? (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            <RotateCcw size={16} className="text-[var(--lore-text-tertiary)]" />
            Undo an agent
          </h2>
          <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
            Revert every page one agent has written in the last week, back to what it said
            before that agent first touched it. Pages a human edited afterwards are skipped,
            and nothing is ever deleted.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {agents.map((agent) => (
              <button
                key={agent}
                type="button"
                onClick={() => previewUndo(agent)}
                className="t-meta rounded-lg border border-[var(--lore-border)] px-3 py-1.5 text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
              >
                {agent}
              </button>
            ))}
          </div>

          {plan ? (
            <div className="mt-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3">
              <p className="text-[13.5px] text-[var(--lore-text-primary)]">
                {plan.revertable
                  ? `${count(plan.revertable, "page")} would be reverted.`
                  : "Nothing can be reverted."}{" "}
                <span className="text-[var(--lore-text-secondary)]">
                  {plan.targets.length - plan.revertable} skipped.
                </span>
              </p>
              <ul className="t-meta mt-2 space-y-0.5 text-[var(--lore-text-tertiary)]">
                {plan.targets.slice(0, 10).map((t) => (
                  <li key={t.relPath}>
                    {t.state === "revertable" ? "revert" : t.state} — {t.relPath}
                    {t.note ? ` (${t.note})` : ""}
                  </li>
                ))}
              </ul>
              {plan.revertable ? (
                <button
                  type="button"
                  onClick={runUndo}
                  disabled={busy}
                  className="mt-3 rounded-lg border border-[var(--lore-danger)] px-3 py-1.5 text-[13px] text-[var(--lore-danger)] transition-colors hover:bg-[var(--lore-surface-raised)] disabled:opacity-40"
                >
                  {busy ? "Reverting…" : `Revert ${plan.revertable}`}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------ prune */}
      {prune?.candidates.length ? (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            <Archive size={16} className="text-[var(--lore-text-tertiary)]" />
            Stopped earning its place
          </h2>
          <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
            A page justifies itself by being read, being linked, or being edited. These do
            none of the three. Nothing is deleted here — this is a list, with the reason
            attached.
          </p>
          <ul className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
            {prune.candidates.slice(0, 12).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpenPage(c.id)}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
                >
                  <Trash2 size={13} className="mt-1 shrink-0 text-[var(--lore-text-tertiary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-[var(--lore-text-primary)]">
                      {c.title}
                    </span>
                    <span className="t-meta block text-[var(--lore-text-tertiary)]">
                      {c.reason}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
