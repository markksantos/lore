"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Moon, Pause, Play } from "lucide-react";
import { getJson, postJson } from "@/components/lore/observer-bits";
import { cn, relativeTime } from "@/lib/utils";

/**
 * "What is watching me right now", answered in one place.
 *
 * Each observer already has its own switch on its own screen. That is the right
 * place to turn one ON — the decision belongs next to the explanation of what it
 * reads. It is the wrong place to answer the question a person actually asks at
 * speed, which is not "is Ghost enabled" but "is anything looking at my screen,
 * and can I stop all of it now".
 *
 * So this exists, it lives in Settings where somebody goes when they are
 * worried, and the stop button is the largest thing on it. The desktop app has
 * the same control in the menu bar; this is for everybody else, and for anyone
 * who is in the app already.
 *
 * The consent log is shown rather than summarised. "You turned Ghost on eleven
 * days ago" is checkable; "your privacy is protected" is not.
 */

type Observer = {
  id: string;
  label: string;
  reads: string;
  enabled: boolean;
  enabledAt: number | null;
  blockedBecause: string | null;
  jobs: { id: string; running: boolean; runs: number; lastError: string | null }[];
};

type State = {
  observers: Observer[];
  pausedUntil: number | null;
  quietHours: { from: number; to: number } | null;
  shareWithAgents?: boolean;
  daemon: { started: boolean; jobs: number };
  log: { at: number; kind: string; observer?: string }[];
  browser?: boolean;
};

export function WatchingPanel({ onOpen }: { onOpen?: (view: string) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const data = await getJson<State>("/api/observers", 15_000);
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

  /*
   * A pause expires on its own, and quiet hours begin without anyone touching
   * anything, so a panel that answers "is something watching me" has to keep
   * asking. Thirty seconds is often enough to be honest and rare enough to cost
   * nothing.
   */
  useEffect(() => {
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    await postJson("/api/observers", body, 20_000);
    setBusy(false);
    await load();
  };

  if (failed) {
    return (
      <Frame>
        <p className="t-body text-[var(--lore-text-tertiary)]">
          Could not reach the observers.{" "}
          <button type="button" onClick={() => void load()} className="underline">
            Try again
          </button>
          .
        </p>
      </Frame>
    );
  }

  if (!state) {
    return (
      <Frame>
        <p className="t-body flex items-center gap-2 text-[var(--lore-text-tertiary)]">
          <Loader2 size={13} className="animate-spin" />
          Checking.
        </p>
      </Frame>
    );
  }

  const paused = Boolean(state.pausedUntil && state.pausedUntil > Date.now());
  const on = state.observers.filter((observer) => observer.enabled);
  const live = on.filter((observer) => !observer.blockedBecause);

  return (
    <Frame>
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            live.length
              ? "bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
              : "bg-[var(--lore-surface-raised)] text-[var(--lore-text-tertiary)]",
          )}
        >
          {live.length ? <Eye size={17} /> : <EyeOff size={17} />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--lore-text-primary)]">
            {live.length
              ? `${live.length} ${live.length === 1 ? "thing is" : "things are"} watching this machine`
              : on.length
                ? "Switched on, but not running"
                : "Nothing is watching this machine"}
          </p>
          <p className="t-body mt-1 text-[var(--lore-text-secondary)]">
            {live.length ? (
              live.map((observer) => observer.label).join(", ")
            ) : on.length ? (
              (on[0].blockedBecause ?? "Paused.")
            ) : state.browser ? (
              "A browser tab cannot observe this machine, so none of these can run here."
            ) : (
              "Every observer is off. Each one has its own switch on its own screen."
            )}
          </p>
        </div>

        {!state.browser ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {paused ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act({ action: "pause", minutes: 0 })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 text-[13px] font-medium text-[var(--lore-button-primary-fg)] transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
              >
                <Play size={13} />
                Resume
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy || !on.length}
                  onClick={() => void act({ action: "pause", minutes: 60 })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-40"
                >
                  <Pause size={13} />
                  Pause for an hour
                </button>
                <button
                  type="button"
                  disabled={busy || !on.length}
                  onClick={() => void act({ action: "pause", minutes: 12 * 60 })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-40"
                >
                  Until tomorrow
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {paused ? (
        <p className="t-meta mt-3 rounded-lg bg-[var(--lore-surface-raised)] px-3 py-2 text-[var(--lore-text-secondary)]">
          Everything is paused until{" "}
          {new Date(state.pausedUntil!).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
          . The pause survives a restart — it is a deadline, not a switch.
        </p>
      ) : null}

      {/* Every observer, on or off, so the list cannot imply something is
          absent just because it is switched off. */}
      <ul className="mt-4 space-y-1.5">
        {state.observers.map((observer) => (
          <li key={observer.id} className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                observer.enabled && !observer.blockedBecause
                  ? "bg-[var(--lore-success)]"
                  : observer.enabled
                    ? "bg-[var(--lore-text-tertiary)]"
                    : "bg-[var(--lore-border-strong)]",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(observer.id)}
                    className="text-[13px] font-medium text-[var(--lore-text-primary)] underline-offset-2 hover:underline"
                  >
                    {observer.label}
                  </button>
                ) : (
                  <span className="text-[13px] font-medium text-[var(--lore-text-primary)]">
                    {observer.label}
                  </span>
                )}
                <span className="t-meta text-[var(--lore-text-tertiary)]">
                  {observer.enabled
                    ? observer.blockedBecause
                      ? "on, not running"
                      : observer.enabledAt
                        ? `on since ${relativeTime(observer.enabledAt)}`
                        : "on"
                    : "off"}
                </span>
              </span>
              <span className="t-meta block text-[var(--lore-text-tertiary)]">{observer.reads}</span>
            </span>
          </li>
        ))}
      </ul>

      {!state.browser ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--lore-border)] pt-3">
          <Moon size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
          <span className="t-meta text-[var(--lore-text-secondary)]">Nothing observes between</span>
          <HourPicker
            value={state.quietHours?.from ?? null}
            onChange={(from) =>
              void act({
                action: "quiet-hours",
                from,
                to: state.quietHours?.to ?? 7,
              })
            }
          />
          <span className="t-meta text-[var(--lore-text-secondary)]">and</span>
          <HourPicker
            value={state.quietHours?.to ?? null}
            onChange={(to) =>
              void act({
                action: "quiet-hours",
                from: state.quietHours?.from ?? 22,
                to,
              })
            }
          />
          {state.quietHours ? (
            <button
              type="button"
              onClick={() => void act({ action: "quiet-hours", from: 0, to: 0 })}
              className="t-meta text-[var(--lore-text-tertiary)] underline"
            >
              clear
            </button>
          ) : null}
        </div>
      ) : null}

      {!state.browser ? (
        <div className="mt-3 border-t border-[var(--lore-border)] pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={state.shareWithAgents === true}
            disabled={busy}
            onClick={() => void act({ action: "share", enabled: !state.shareWithAgents })}
            className="flex w-full items-start gap-2.5 text-left disabled:opacity-60"
          >
            <span
              className={cn(
                "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
                state.shareWithAgents ? "bg-[var(--lore-accent)]" : "bg-[var(--lore-border-strong)]",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  state.shareWithAgents ? "translate-x-[1.125rem]" : "translate-x-0.5",
                )}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--lore-text-primary)]">
                Let your agents ask about this over MCP
              </span>
              {/*
                * Said as bluntly as it deserves.
                *
                * Switching an observer on means a model ON THIS MACHINE looks at
                * something. This means what it saw can be handed to whatever
                * agent is connected, which is usually a frontier model on
                * hardware the reader does not own. Softening that would make
                * the switch easier to flip and the consent worthless.
                */}
              <span className="t-meta block text-[var(--lore-text-tertiary)]">
                Adds three tools to Lore&rsquo;s MCP server, so Claude Code and the rest can search
                what Ghost, Ledger and Oracle found. Unlike everything else here, that sends your
                screen, mail and messages to whichever model your agent runs on.
              </span>
            </span>
          </button>
        </div>
      ) : null}

      {state.log.length ? (
        <details className="mt-3">
          <summary className="t-meta cursor-pointer text-[var(--lore-text-tertiary)]">
            Every time this changed ({state.log.length})
          </summary>
          <ul className="mt-2 space-y-0.5">
            {state.log.slice(0, 12).map((entry, i) => (
              <li key={i} className="t-meta text-[var(--lore-text-tertiary)]">
                {relativeTime(entry.at)} — {entry.observer ? `${entry.observer} ` : ""}
                {entry.kind}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
        What is watching
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * An hour, as a select rather than a time input.
 *
 * `<input type="time">` would allow 22:37, which quiet hours cannot express —
 * the check is on whole hours. A control that accepts a value the system then
 * silently rounds is worse than one that only offers what it can honour.
 */
function HourPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (hour: number) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onChange(Number(event.target.value))}
      aria-label={value === null ? "Set quiet hours" : "Quiet hours"}
      className="rounded-md border border-[var(--lore-border)] bg-[var(--lore-background)] px-1.5 py-1 text-[12.5px] tabular-nums text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
    >
      <option value="">--</option>
      {Array.from({ length: 24 }, (_, hour) => (
        <option key={hour} value={hour}>
          {String(hour).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}
