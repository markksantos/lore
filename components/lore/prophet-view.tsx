"use client";

import { useCallback, useEffect, useState } from "react";
import { BellOff, Check, Clock, Loader2, Sparkles, X } from "lucide-react";
import {
  Button,
  ConsentSwitch,
  DangerButton,
  dayAndTime,
  Empty,
  ErrorNote,
  getJson,
  Panel,
  postJson,
  putJson,
  Stats,
  ViewFrame,
} from "@/components/lore/observer-bits";
import { cn, relativeTime } from "@/lib/utils";

/**
 * Prophet's screen.
 *
 * A short list, or nothing at all. "Nothing at all" is the correct and most
 * common state, and this screen has to make that feel like the system working
 * rather than the system broken — so the empty state says what Prophet is
 * watching and why it has not spoken, instead of showing a spinner or an
 * apology.
 *
 * Each card carries its evidence. That is the difference between an assistant
 * and an oracle: "you have not heard from this person in 19 days" with the last
 * three exchanges attached is checkable, and a checkable claim can be trusted
 * on the day it matters.
 */

type Card = {
  id: string;
  kind: string;
  at: number;
  weight: number;
  title: string;
  body: string | null;
  evidence: { label: string; detail: string }[];
  state: number;
};

type ProphetState = {
  config: {
    bar: number;
    maxCards: number;
    meetingHorizonMinutes: number;
    kinds: Record<string, boolean>;
    notifyAbove: number;
  };
  status: {
    cards: number;
    live: number;
    dismissed: number;
    byKind: { kind: string; shown: number; dismissed: number; acted: number; multiplier: number }[];
    sources: { oracle: boolean; twin: boolean; calendar: boolean; wiki: boolean };
  };
  cards: Card[];
  enabled: boolean;
  running: boolean;
  blockedBecause: string | null;
};

const KIND_LABEL: Record<string, string> = {
  "meeting-soon": "Coming up",
  "meeting-prep": "Before this meeting",
  "silent-contact": "Gone quiet",
  "awaiting-reply": "Waiting on a reply",
  "monthly-habit": "You usually do this now",
  "twin-pattern": "Twin noticed something",
  "wiki-gap": "Your wiki could not answer this",
};

export function ProphetView({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [state, setState] = useState<ProphetState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<Record<string, string | null>>({});
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const data = await getJson<ProphetState>("/api/prophet", 30_000);
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

  /* A meeting card is only useful before the meeting, so this screen refreshes
     while Prophet is running. It stops when Prophet is off — nothing changes
     then, and a timer on an idle tab is somebody's battery. */
  useEffect(() => {
    if (!state?.running) return;
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [state?.running, load]);

  const act = async (action: string, extra?: Record<string, unknown>, timeout = 120_000) => {
    setBusy(action + (extra?.id ? `:${extra.id}` : ""));
    setNotice(null);
    const result = await postJson<Record<string, unknown>>("/api/prophet", { action, ...extra }, timeout);
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
      <ViewFrame title="Prophet" lede="It speaks first, and only when it has something worth saying.">
        <Empty>
          Prophet could not be reached.{" "}
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
      <ViewFrame title="Prophet" lede="It speaks first, and only when it has something worth saying.">
        <div className="flex items-center gap-2 py-10 text-[var(--lore-text-tertiary)]">
          <Loader2 size={15} className="animate-spin" />
          <span className="t-body">Looking.</span>
        </div>
      </ViewFrame>
    );
  }

  const { status, config } = state;
  const blind = !status.sources.oracle && !status.sources.calendar && !status.sources.twin;

  return (
    <ViewFrame
      title="Prophet"
      lede="It reads your calendar and what the other observers found, and tells you the thing you were about to need."
      right={
        <>
          <Button busy={busy === "think"} onClick={() => void act("think")}>
            <Sparkles size={12} />
            Look now
          </Button>
          <Button onClick={() => setShowSettings((open) => !open)}>
            {showSettings ? "Hide" : "Settings"}
          </Button>
        </>
      }
    >
      <ConsentSwitch
        id="prophet"
        label="Prophet"
        reads="Reads your calendar and what Oracle, Twin and your wiki already know. It collects nothing of its own."
        enabled={state.enabled}
        blockedBecause={state.blockedBecause}
        onChange={async (next) => {
          await postJson("/api/observers", { action: "set", observer: "prophet", enabled: next });
          await load();
        }}
      />

      {blind ? (
        <Panel title="Prophet cannot see anything yet">
          <p className="t-body text-[var(--lore-text-secondary)]">
            It has no sources of its own — every card comes from something else you switched on.
            Right now none of them have anything.
          </p>
          <ul className="mt-2 space-y-1">
            <SourceLine
              on={status.sources.calendar}
              label="Calendar"
              detail="Meeting reminders and the context that goes with them."
            />
            <SourceLine
              on={status.sources.oracle}
              label="Oracle"
              detail="Who has gone quiet, who has not replied, what you do every month."
              onGo={onNavigate ? () => onNavigate("oracle") : undefined}
            />
            <SourceLine
              on={status.sources.twin}
              label="Twin"
              detail="Habits worth automating."
              onGo={onNavigate ? () => onNavigate("twin") : undefined}
            />
            <SourceLine
              on={status.sources.wiki}
              label="Your wiki"
              detail="Questions it was asked and could not answer."
            />
          </ul>
        </Panel>
      ) : null}

      {/* ----------------------------------------------------------- cards */}
      {state.cards.length ? (
        <div className="mt-4 space-y-3">
          {state.cards.map((card) => (
            <article
              key={card.id}
              className="min-w-0 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4"
            >
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                {KIND_LABEL[card.kind] ?? card.kind}
              </p>
              <h2 className="mt-0.5 text-[16px] font-semibold tracking-[-0.01em] text-[var(--lore-text-primary)]">
                {card.title}
              </h2>
              {card.body ? (
                <p className="t-body mt-1 text-[var(--lore-text-secondary)]">{card.body}</p>
              ) : null}

              {card.evidence.length ? (
                <ul className="mt-2.5 space-y-1 border-l-2 border-[var(--lore-border)] pl-3">
                  {card.evidence.map((item, i) => (
                    <li key={i} className="min-w-0">
                      <span className="t-meta block text-[var(--lore-text-tertiary)]">{item.label}</span>
                      <span className="block truncate text-[12.5px] text-[var(--lore-text-secondary)]">
                        {item.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {briefs[card.id] ? (
                <div className="mt-2.5 whitespace-pre-wrap rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3 text-[13px] leading-relaxed text-[var(--lore-text-secondary)]">
                  {briefs[card.id]}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {card.evidence.length && !briefs[card.id] ? (
                  <Button
                    busy={busy === `brief:${card.id}`}
                    onClick={async () => {
                      const data = (await act("brief", { id: card.id }, 90_000)) as
                        | { brief?: string | null; needsModel?: boolean }
                        | null;
                      if (!data) return;
                      setBriefs((current) => ({
                        ...current,
                        [card.id]: data.brief ?? (data.needsModel ? "No local model is running." : "Nothing more to say."),
                      }));
                    }}
                  >
                    <Sparkles size={12} />
                    Brief me
                  </Button>
                ) : null}
                <Button onClick={() => void act("respond", { id: card.id, response: "acted" })}>
                  <Check size={12} />
                  Done
                </Button>
                <Button onClick={() => void act("respond", { id: card.id, response: "snooze", minutes: 120 })}>
                  <Clock size={12} />
                  Later
                </Button>
                <Button onClick={() => void act("respond", { id: card.id, response: "dismiss" })}>
                  <X size={12} />
                  Not useful
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : !blind ? (
        <Panel>
          <p className="t-body text-[var(--lore-text-secondary)]">
            Nothing worth saying right now. That is the normal state — Prophet is watching{" "}
            {[
              status.sources.calendar && "your calendar",
              status.sources.oracle && "who you talk to",
              status.sources.twin && "your habits",
              status.sources.wiki && "your wiki",
            ]
              .filter(Boolean)
              .join(", ")}
            , and it stays quiet until something crosses the bar.
          </p>
        </Panel>
      ) : null}

      {notice ? (
        <Panel>
          <ErrorNote>{notice}</ErrorNote>
        </Panel>
      ) : null}

      <div className="mt-4">
        <Stats
          items={[
            { label: "showing", value: String(state.cards.length) },
            { label: "raised ever", value: String(status.cards) },
            { label: "waved away", value: String(status.dismissed) },
            {
              label: "sources live",
              value: String(Object.values(status.sources).filter(Boolean).length),
            },
          ]}
        />
      </div>

      {showSettings ? (
        <Panel title="How loud it is">
          <label className="block">
            <span className="t-meta block text-[var(--lore-text-tertiary)]">
              Only speak above this confidence — higher means quieter
            </span>
            <span className="mt-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={Math.round(config.bar * 100)}
                onChange={async (event) => {
                  await putJson("/api/prophet", { bar: Number(event.target.value) / 100 });
                  await load();
                }}
                className="min-w-0 flex-1 accent-[var(--lore-accent)]"
              />
              <span className="w-10 shrink-0 text-right text-[13px] text-[var(--lore-text-primary)]">
                {Math.round(config.bar * 100)}
              </span>
            </span>
          </label>

          <div className="mt-4">
            <p className="t-meta text-[var(--lore-text-tertiary)]">What it may raise</p>
            <div className="mt-1.5 space-y-1">
              {Object.keys(KIND_LABEL).map((kind) => {
                const learned = status.byKind.find((row) => row.kind === kind);
                return (
                  <label
                    key={kind}
                    className="flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--lore-surface-raised)]"
                  >
                    <input
                      type="checkbox"
                      checked={config.kinds[kind] !== false}
                      onChange={async (event) => {
                        await putJson("/api/prophet", { kinds: { [kind]: event.target.checked } });
                        await load();
                      }}
                      className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--lore-accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-[var(--lore-text-primary)]">
                        {KIND_LABEL[kind]}
                      </span>
                      {learned && learned.multiplier < 0.95 ? (
                        <span className="t-meta block text-[var(--lore-text-tertiary)]">
                          You have waved this away {learned.dismissed} time
                          {learned.dismissed === 1 ? "" : "s"}, so Prophet has turned it down to{" "}
                          {Math.round(learned.multiplier * 100)}%.
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--lore-border)] pt-3">
            <DangerButton
              label="Forget every card and what it learned"
              confirmLabel="Really start over?"
              onConfirm={() => act("forget", undefined, 30_000)}
            />
            <span className="t-meta self-center text-[var(--lore-text-tertiary)]">
              <BellOff size={11} className="mr-1 inline" />
              Pausing all observers silences Prophet too.
            </span>
          </div>
        </Panel>
      ) : null}
    </ViewFrame>
  );
}

function SourceLine({
  on,
  label,
  detail,
  onGo,
}: {
  on: boolean;
  label: string;
  detail: string;
  onGo?: () => void;
}) {
  return (
    <li className="flex min-w-0 items-start gap-2">
      <span
        className={cn(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          on ? "bg-[var(--lore-success)]" : "bg-[var(--lore-border-strong)]",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-[var(--lore-text-primary)]">{label}</span>
        <span className="t-meta block text-[var(--lore-text-tertiary)]">{detail}</span>
      </span>
      {!on && onGo ? (
        <button
          type="button"
          onClick={onGo}
          className="t-meta shrink-0 text-[var(--lore-accent)] underline"
        >
          Set it up
        </button>
      ) : null}
    </li>
  );
}
