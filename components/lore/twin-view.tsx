"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Play, RotateCcw, Search, Sparkles, X } from "lucide-react";
import {
  Button,
  compact,
  ConsentSwitch,
  DangerButton,
  dayAndTime,
  Empty,
  ErrorNote,
  getJson,
  Panel,
  PathInput,
  postJson,
  putJson,
  Stats,
  ViewFrame,
} from "@/components/lore/observer-bits";
import { cn, relativeTime } from "@/lib/utils";

/**
 * Twin's screen.
 *
 * Proposals first, because the whole pitch is that it comes to you. Everything
 * below them is the audit trail that makes saying yes reasonable.
 *
 * The most important control on this page is the dry-run switch, and it is
 * deliberately not buried: a new automation reports what it WOULD do and moves
 * nothing until a person, having read a list of real files, decides otherwise.
 * A background process that reorganises your home directory on the strength of
 * a statistical pattern needs that gate, and needs the undo button next to it.
 */

type Proposal = {
  id: string;
  kind: string;
  count: number;
  firstAt: number | null;
  lastAt: number | null;
  sample: string | null;
  summary: string | null;
  proposal: { trigger: unknown; actions: unknown[] } | null;
};

type Automation = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  dryRun: boolean;
  createdAt: number;
  runs: number;
  acted: number;
  lastRunAt: number | null;
  lastError: string | null;
};

type Action = {
  id: number;
  automationId: string;
  at: number;
  kind: string;
  src: string;
  dst: string | null;
  ok: number;
  dryRun: number;
  error: string | null;
  undone: number;
};

type TwinState = {
  config: { watchRoots: string[]; watchApps: boolean; threshold: number; windowDays: number; dryRunByDefault: boolean };
  status: {
    events: number;
    eventsByKind: { kind: string; n: number }[];
    patterns: number;
    proposals: number;
    automations: number;
    live: number;
    watching: string[];
    acted: number;
    since: number | null;
  };
  proposals: Proposal[];
  automations: Automation[];
  actions: Action[];
  enabled: boolean;
  running: boolean;
  blockedBecause: string | null;
};

const short = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export function TwinView() {
  const [state, setState] = useState<TwinState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; outcomes: { src: string; dst: string | null; ok: boolean; error: string | null }[] } | null>(null);

  const load = useCallback(async () => {
    const data = await getJson<TwinState>("/api/twin", 30_000);
    if (!data) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setState(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(action + (extra?.id ? `:${extra.id}` : ""));
    setNotice(null);
    const result = await postJson<Record<string, unknown>>("/api/twin", { action, ...extra }, 120_000);
    setBusy(null);
    if (!result.ok) {
      setNotice(result.error);
      return null;
    }
    await load();
    return result.data;
  };

  if (failed) {
    return (
      <ViewFrame title="Twin" lede="It watches what you do over and over, then offers to take it over.">
        <Empty>
          Twin could not be reached.{" "}
          <button type="button" onClick={() => void load()} className="underline">
            Try again
          </button>
          .
        </Empty>
      </ViewFrame>
    );
  }

  if (!state) {
    return (
      <ViewFrame title="Twin" lede="It watches what you do over and over, then offers to take it over.">
        <div className="flex items-center gap-2 py-10 text-[var(--lore-text-tertiary)]">
          <Loader2 size={15} className="animate-spin" />
          <span className="t-body">Reading what Twin has noticed.</span>
        </div>
      </ViewFrame>
    );
  }

  const { status, config } = state;

  return (
    <ViewFrame
      title="Twin"
      lede="It watches the folders you nominate, counts what you do repeatedly, and offers to do it for you."
      right={
        <Button busy={busy === "mine"} onClick={() => void act("mine")}>
          <Search size={12} />
          Look for patterns
        </Button>
      }
    >
      <ConsentSwitch
        id="twin"
        label="Twin"
        reads="Watches which files change in the folders you choose, and which app is in front. No keyboard, no mouse, no screen."
        enabled={state.enabled}
        blockedBecause={state.blockedBecause}
        onChange={async (next) => {
          await postJson("/api/observers", { action: "set", observer: "twin", enabled: next });
          await load();
        }}
      />

      {/* -------------------------------------------------------- proposals */}
      <Panel
        title="What Twin has noticed"
        hint={
          config.watchRoots.length
            ? `Watching ${config.watchRoots.map(short).join(", ")}.`
            : "No folders are being watched yet — add one below and Twin has nothing to notice until you do."
        }
      >
        {state.proposals.length ? (
          <div className="space-y-2">
            {state.proposals.map((proposal) => (
              <div
                key={proposal.id}
                className="min-w-0 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3"
              >
                <p className="text-[14px] leading-relaxed text-[var(--lore-text-primary)]">
                  {proposal.summary ?? "A pattern with no description."}
                </p>
                {proposal.sample ? (
                  <p
                    className="t-meta mt-1 truncate text-[var(--lore-text-tertiary)]"
                    title={proposal.sample}
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    {short(proposal.sample)}
                  </p>
                ) : null}
                <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
                  {proposal.count} time{proposal.count === 1 ? "" : "s"}
                  {proposal.firstAt ? ` since ${relativeTime(proposal.firstAt)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {proposal.proposal ? (
                    <Button
                      variant="primary"
                      busy={busy === `accept:${proposal.id}`}
                      onClick={() => void act("accept", { id: proposal.id })}
                    >
                      <Check size={12} />
                      Let Twin do this
                    </Button>
                  ) : (
                    <span className="t-meta self-center text-[var(--lore-text-tertiary)]">
                      Worth knowing, not worth automating.
                    </span>
                  )}
                  <Button onClick={() => void act("dismiss", { id: proposal.id })}>
                    <X size={12} />
                    Not interested
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty>
            {config.watchRoots.length
              ? `Nothing repeated ${config.threshold} times yet. Twin needs to see a habit before it can name one.`
              : "Add a folder below — Downloads and Desktop are where filing habits usually live."}
          </Empty>
        )}
        {notice ? <ErrorNote>{notice}</ErrorNote> : null}
      </Panel>

      {/* ------------------------------------------------------ automations */}
      {state.automations.length ? (
        <Panel title="What Twin does for you">
          <div className="space-y-2">
            {state.automations.map((automation) => (
              <div
                key={automation.id}
                className="min-w-0 rounded-lg border border-[var(--lore-border)] p-3"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                      {automation.name}
                    </p>
                    {automation.description ? (
                      <p className="t-body mt-0.5 text-[var(--lore-text-secondary)]">
                        {automation.description}
                      </p>
                    ) : null}
                    <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
                      {automation.runs} run{automation.runs === 1 ? "" : "s"} ·{" "}
                      {automation.acted} file{automation.acted === 1 ? "" : "s"} moved
                      {automation.lastRunAt ? ` · last ${relativeTime(automation.lastRunAt)}` : ""}
                    </p>
                    {automation.lastError ? <ErrorNote>{automation.lastError}</ErrorNote> : null}
                  </div>

                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      automation.dryRun
                        ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-secondary)]"
                        : "bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]",
                    )}
                  >
                    {automation.dryRun ? "Reporting only" : automation.enabled ? "Live" : "Paused"}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    busy={busy === `run:${automation.id}`}
                    onClick={async () => {
                      const data = (await act("run", { id: automation.id })) as
                        | { outcomes?: { src: string; dst: string | null; ok: boolean; error: string | null }[] }
                        | null;
                      if (data?.outcomes) setPreview({ id: automation.id, outcomes: data.outcomes });
                    }}
                  >
                    <Play size={12} />
                    {automation.dryRun ? "Show me what it would do" : "Run it now"}
                  </Button>
                  <Button
                    onClick={() =>
                      void act("set", { id: automation.id, enabled: !automation.enabled })
                    }
                  >
                    {automation.enabled ? "Pause" : "Resume"}
                  </Button>
                  {automation.dryRun ? (
                    <DangerButton
                      label="Let it actually move files"
                      confirmLabel="Yes — it moves files from now on"
                      onConfirm={() => act("set", { id: automation.id, dryRun: false })}
                    />
                  ) : (
                    <Button onClick={() => void act("set", { id: automation.id, dryRun: true })}>
                      Back to reporting only
                    </Button>
                  )}
                  <DangerButton
                    label="Delete"
                    confirmLabel="Really delete this rule?"
                    onConfirm={() => act("delete", { id: automation.id })}
                  />
                </div>

                {preview?.id === automation.id ? (
                  <div className="mt-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-2.5">
                    {preview.outcomes.length ? (
                      <>
                        <p className="t-meta text-[var(--lore-text-tertiary)]">
                          {automation.dryRun ? "It would move:" : "It moved:"}
                        </p>
                        <ul className="lore-scrollbar mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                          {preview.outcomes.map((outcome, i) => (
                            <li
                              key={i}
                              className="truncate text-[12px] text-[var(--lore-text-secondary)]"
                              style={{ fontFamily: "var(--font-mono), monospace" }}
                              title={`${outcome.src} → ${outcome.dst ?? "?"}`}
                            >
                              {outcome.ok ? "" : "✗ "}
                              {short(outcome.src).split("/").pop()} →{" "}
                              {outcome.dst ? short(outcome.dst).split("/").slice(-2).join("/") : "?"}
                              {outcome.error ? ` — ${outcome.error}` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="t-meta text-[var(--lore-text-tertiary)]">
                        Nothing currently matches this rule.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* ----------------------------------------------------------- undo */}
      {state.actions.some((action) => action.dryRun === 0 && action.ok === 1) ? (
        <Panel
          title="What Twin actually did"
          hint="Every real move, with the button that puts it back."
          right={
            <Button
              busy={busy === "undo"}
              onClick={() =>
                void act("undo", {
                  ids: state.actions
                    .filter((action) => action.dryRun === 0 && action.ok === 1 && action.undone === 0)
                    .map((action) => action.id),
                })
              }
            >
              <RotateCcw size={12} />
              Undo all of it
            </Button>
          }
        >
          <ul className="space-y-1">
            {state.actions
              .filter((action) => action.dryRun === 0)
              .slice(0, 20)
              .map((action) => (
                <li key={action.id} className="flex min-w-0 items-baseline gap-2">
                  <span
                    className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--lore-text-secondary)]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                    title={`${action.src} → ${action.dst ?? "?"}`}
                  >
                    {short(action.src).split("/").pop()} →{" "}
                    {action.dst ? short(action.dst).split("/").slice(-2).join("/") : "?"}
                  </span>
                  <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                    {action.undone ? "put back" : dayAndTime(action.at)}
                  </span>
                  {!action.undone && action.ok === 1 ? (
                    <Button onClick={() => void act("undo", { ids: [action.id] })}>Undo</Button>
                  ) : null}
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}

      <div className="mt-4">
        <Stats
          items={[
            { label: "things observed", value: compact(status.events) },
            { label: "habits found", value: String(status.patterns) },
            { label: "rules live", value: `${status.live}/${status.automations}` },
            { label: "files handled", value: compact(status.acted) },
          ]}
        />
      </div>

      {/* ------------------------------------------------------- settings */}
      <Panel title="What Twin watches">
        {config.watchRoots.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {config.watchRoots.map((root) => (
              <span
                key={root}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--lore-border)] px-2 py-1 text-[12px] text-[var(--lore-text-secondary)]"
              >
                <span className="truncate" style={{ fontFamily: "var(--font-mono), monospace" }}>
                  {short(root)}
                </span>
                <button
                  type="button"
                  aria-label={`Stop watching ${root}`}
                  onClick={() => void act("unwatch", { path: root })}
                  className="shrink-0 text-[var(--lore-text-tertiary)] hover:text-[var(--lore-danger)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <PathInput
          placeholder="~/Downloads"
          busy={busy === "watch"}
          onAdd={async (path) => {
            await act("watch", { path });
          }}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="t-meta block text-[var(--lore-text-tertiary)]">
              Repeat this many times before Twin says anything
            </span>
            <input
              type="number"
              min={2}
              max={50}
              value={config.threshold}
              onChange={async (event) => {
                await putJson("/api/twin", { threshold: Number(event.target.value) });
                await load();
              }}
              className="mt-1 w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[13px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
            />
          </label>
          <label className="flex items-start gap-2.5 self-end pb-2">
            <input
              type="checkbox"
              checked={config.watchApps}
              onChange={async (event) => {
                await putJson("/api/twin", { watchApps: event.target.checked });
                await load();
              }}
              className="mt-1 h-3.5 w-3.5 accent-[var(--lore-accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--lore-text-primary)]">
                Note which app is in front
              </span>
              <span className="t-meta block text-[var(--lore-text-tertiary)]">
                Used for routines, never automated.
              </span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="Forget" hint="Deletes what Twin observed, the habits it found, and every rule.">
        <DangerButton
          label="Forget everything Twin knows"
          confirmLabel="Really delete it all?"
          onConfirm={() => act("forget")}
        />
      </Panel>
    </ViewFrame>
  );
}
