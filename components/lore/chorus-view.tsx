"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, Scale, Split, X } from "lucide-react";
import {
  Button,
  DangerButton,
  dayAndTime,
  Empty,
  ErrorNote,
  getJson,
  Panel,
  postJson,
  putJson,
  ViewFrame,
} from "@/components/lore/observer-bits";
import { cn } from "@/lib/utils";

/**
 * Chorus's screen — the debate, rendered as it happens.
 *
 * Three columns, one per panelist, filling in simultaneously while the models
 * write. This is the one screen in Lore that is deliberately a spectacle,
 * because the argument IS the product: watching two models reach the same
 * answer by different routes, or watching one demolish another's reasoning, is
 * information you cannot get from a synthesis paragraph.
 *
 * The synthesis is last and the dissents are pulled out above it in their own
 * block. That ordering is the whole editorial position of the feature: what the
 * panel could not agree on is more useful than what it could, and burying it at
 * the bottom of a long answer would waste the only advantage of having asked
 * more than one model.
 */

type Panelist = { id: string; provider: string; model: string; label: string };
type Provider = {
  id: string;
  label: string;
  configured: boolean;
  fromEnv: boolean;
  defaultModel: string;
};
type Debate = {
  id: string;
  at: number;
  question: string;
  synthesis: string | null;
  dissents: string[];
  panel: Panelist[];
  costUsd: number;
  ms: number;
};
type ChorusState = {
  config: { panelists: Panelist[]; chair: string | null; skipCritique: boolean; maxTokens: number };
  providers: Provider[];
  localModels: string[];
  suggestion: Panelist[];
  debates: Debate[];
};

type Live = {
  round: number;
  roundName: string;
  /** panelistId → round → text as it streams. */
  text: Map<string, Map<number, string>>;
  done: Set<string>;
  errors: Map<string, string>;
  synthesis: string;
  synthesisBy: string | null;
  costUsd: number;
  finished: boolean;
  failure: string | null;
};

const emptyLive = (): Live => ({
  round: 0,
  roundName: "",
  text: new Map(),
  done: new Set(),
  errors: new Map(),
  synthesis: "",
  synthesisBy: null,
  costUsd: 0,
  finished: false,
  failure: null,
});

export function ChorusView() {
  const [state, setState] = useState<ChorusState | null>(null);
  const [failed, setFailed] = useState(false);
  const [question, setQuestion] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [running, setRunning] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const data = await getJson<ChorusState>("/api/chorus", 20_000);
    if (!data) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setState(data);
  }, []);

  useEffect(() => {
    void load();
    /* An in-flight debate holds three provider connections. Leaving the screen
       has to close them, or a closed tab keeps three frontier models generating
       for nobody and billing for it. */
    return () => abort.current?.abort();
  }, [load]);

  const convene = async () => {
    const text = question.trim();
    if (!text || running) return;
    setRunning(true);
    setNotice(null);
    setLive(emptyLive());

    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch("/api/chorus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setNotice(body.error ?? "Chorus could not start.");
        setRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        /* SSE frames are separated by a blank line, and a network chunk lands
           anywhere. The trailing fragment is always kept for the next read. */
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((part) => part.startsWith("data:"));
          if (!line) continue;
          try {
            apply(JSON.parse(line.slice(5).trim()));
          } catch {
            /* One unreadable frame costs one token, not the debate. */
          }
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setNotice("The connection to the debate dropped.");
      }
    } finally {
      setRunning(false);
      abort.current = null;
      void load();
    }
  };

  /**
   * Fold one event into the live view.
   *
   * A functional update on every token, and the Maps are copied rather than
   * mutated — React will not re-render a Map whose identity did not change, and
   * a debate that renders only when a round ends is a debate nobody watches.
   */
  const apply = (event: Record<string, unknown>) => {
    setLive((current) => {
      const next: Live = current ? { ...current, text: new Map(current.text) } : emptyLive();
      switch (event.type) {
        case "round":
          next.round = Number(event.round);
          next.roundName = String(event.name);
          break;
        case "token": {
          const panelist = String(event.panelist);
          const round = Number(event.round);
          const rounds = new Map(next.text.get(panelist) ?? []);
          rounds.set(round, (rounds.get(round) ?? "") + String(event.text));
          next.text.set(panelist, rounds);
          break;
        }
        case "answer": {
          const panelist = String(event.panelist);
          if (event.error) {
            next.errors = new Map(next.errors).set(panelist, String(event.error));
          } else {
            next.done = new Set(next.done).add(`${panelist}:${event.round}`);
            const rounds = new Map(next.text.get(panelist) ?? []);
            rounds.set(Number(event.round), String(event.text));
            next.text.set(panelist, rounds);
          }
          next.costUsd += Number(event.costUsd) || 0;
          break;
        }
        case "synthesis":
          next.synthesis = String(event.text);
          next.synthesisBy = String(event.by);
          break;
        case "done":
          next.finished = true;
          next.costUsd = Number(event.costUsd) || next.costUsd;
          break;
        case "error":
          next.failure = String(event.message);
          break;
      }
      return next;
    });
  };

  if (failed) {
    return (
      <ViewFrame title="Chorus" lede="Several models answer, critique each other, then agree — or say where they do not.">
        <Empty>
          Chorus could not be reached.{" "}
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
      <ViewFrame title="Chorus" lede="Several models answer, critique each other, then agree — or say where they do not.">
        <div className="flex items-center gap-2 py-10 text-[var(--lore-text-tertiary)]">
          <Loader2 size={15} className="animate-spin" />
          <span className="t-body">Seeing who is available.</span>
        </div>
      </ViewFrame>
    );
  }

  const panel = state.config.panelists;
  const soloLocal = panel.length > 1 && panel.every((p) => p.provider === "ollama");

  return (
    <ViewFrame
      title="Chorus"
      lede="One question, several models. They answer alone, read each other, then one writes the verdict — and names what the panel could not agree on."
      right={
        <Button onClick={() => setShowSetup((open) => !open)}>
          <Scale size={12} />
          {showSetup ? "Hide panel" : "The panel"}
        </Button>
      }
    >
      {!panel.length ? (
        <Panel title="There is nobody to ask">
          <p className="t-body text-[var(--lore-text-secondary)]">
            Chorus needs at least one model. Add an API key below, or install a second model in
            Ollama so two local models can argue.
          </p>
          <div className="mt-3">
            <Button variant="primary" onClick={() => setShowSetup(true)}>
              Set up the panel
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void convene();
            }}
            rows={3}
            aria-label="Question for the panel"
            placeholder="Should this service own its own database, or share one with the API?"
            className="w-full resize-y rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5 text-[16px] leading-relaxed text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:text-[14px]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="primary" busy={running} onClick={() => void convene()} disabled={!question.trim()}>
              <Play size={12} />
              Convene {panel.length} model{panel.length === 1 ? "" : "s"}
            </Button>
            {running ? (
              <Button
                onClick={() => {
                  abort.current?.abort();
                  setRunning(false);
                }}
              >
                <X size={12} />
                Stop
              </Button>
            ) : null}
            <span className="t-meta text-[var(--lore-text-tertiary)]">
              {state.config.skipCritique ? "Two rounds" : "Three rounds"} · ⌘↵ to start
            </span>
          </div>
          {soloLocal ? (
            <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
              This panel is entirely local models. They will disagree less than models from
              different labs would — the debate is real, but treat a unanimous verdict from one
              family with more caution than one from three.
            </p>
          ) : null}
          {notice ? <ErrorNote>{notice}</ErrorNote> : null}
        </Panel>
      )}

      {live ? (
        <LiveDebate live={live} panel={panel} running={running} />
      ) : state.debates.length ? (
        <Panel title="Earlier debates">
          <div className="space-y-0.5">
            {state.debates.map((debate) => (
              <button
                key={debate.id}
                type="button"
                onClick={async () => {
                  const data = await getJson<{ debate: Debate & { rounds: { round: number; panelist: string; text: string; error: string | null }[] } }>(
                    `/api/chorus?view=debate&id=${encodeURIComponent(debate.id)}`,
                  );
                  if (!data) return;
                  const replay = emptyLive();
                  replay.finished = true;
                  replay.synthesis = data.debate.synthesis ?? "";
                  replay.costUsd = data.debate.costUsd;
                  for (const round of data.debate.rounds) {
                    const rounds = new Map(replay.text.get(round.panelist) ?? []);
                    rounds.set(round.round, round.text);
                    replay.text.set(round.panelist, rounds);
                    if (round.error) replay.errors.set(round.panelist, round.error);
                  }
                  setQuestion(data.debate.question);
                  setLive(replay);
                }}
                className="flex w-full min-w-0 items-baseline gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
                  {debate.question}
                </span>
                <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                  {debate.dissents.length
                    ? `${debate.dissents.length} split${debate.dissents.length === 1 ? "" : "s"}`
                    : "agreed"}{" "}
                  · {dayAndTime(debate.at)}
                </span>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      {showSetup ? <PanelSetup state={state} onChanged={load} /> : null}
    </ViewFrame>
  );
}

function LiveDebate({
  live,
  panel,
  running,
}: {
  live: Live;
  panel: Panelist[];
  running: boolean;
}) {
  const dissents = extractDissents(live.synthesis);
  const rounds = live.round || 1;

  return (
    <>
      <Panel
        title={live.finished ? "The debate" : live.roundName || "Starting"}
        hint={
          live.finished
            ? `${live.costUsd > 0.0005 ? `About $${live.costUsd.toFixed(3)}. ` : ""}Rough estimate — providers price differently and change often.`
            : `Round ${rounds}`
        }
        right={running ? <Loader2 size={14} className="animate-spin text-[var(--lore-text-tertiary)]" /> : null}
      >
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(panel.length, 3)}, minmax(0, 1fr))` }}
        >
          {panel.map((panelist) => {
            const said = live.text.get(panelist.id);
            const error = live.errors.get(panelist.id);
            return (
              <div
                key={panelist.id}
                className="min-w-0 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3"
              >
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--lore-text-primary)]">
                  {live.done.has(`${panelist.id}:1`) ? (
                    <Check size={11} className="text-[var(--lore-success)]" />
                  ) : null}
                  <span className="min-w-0 truncate">{panelist.label}</span>
                </p>
                <p className="t-meta truncate text-[var(--lore-text-tertiary)]">{panelist.model}</p>

                {error ? (
                  <ErrorNote>{error}</ErrorNote>
                ) : (
                  <>
                    <RoundBlock label="Answer" text={said?.get(1) ?? ""} />
                    {said?.get(2) ? <RoundBlock label="Critique" text={said.get(2)!} /> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {dissents.length ? (
        <Panel
          title="Where the panel split"
          hint="The part a single model could never have told you."
          className="border-[var(--lore-accent)]"
        >
          <ul className="space-y-2">
            {dissents.map((dissent, i) => (
              <li key={i} className="flex min-w-0 gap-2">
                <Split size={13} className="mt-1 shrink-0 text-[var(--lore-accent)]" />
                <span className="min-w-0 text-[13.5px] leading-relaxed text-[var(--lore-text-primary)]">
                  {dissent}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : live.finished && live.synthesis ? (
        <Panel title="The panel agreed" hint="No unresolved disagreement was reported.">
          <p className="t-body text-[var(--lore-text-secondary)]">
            Take that as weaker evidence than it looks if the panel was small or drawn from one lab.
          </p>
        </Panel>
      ) : null}

      {live.synthesis ? (
        <Panel title="The answer">
          <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--lore-text-primary)]">
            {live.synthesis}
          </div>
        </Panel>
      ) : null}

      {live.failure ? (
        <Panel>
          <ErrorNote>{live.failure}</ErrorNote>
        </Panel>
      ) : null}
    </>
  );
}

function RoundBlock({ label, text }: { label: string; text: string }) {
  if (!text) {
    return (
      <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
        <Loader2 size={11} className="mr-1 inline animate-spin" />
        Thinking.
      </p>
    );
  }
  return (
    <div className="mt-2">
      <p className="t-meta text-[var(--lore-text-tertiary)]">{label}</p>
      <div className="lore-scrollbar mt-0.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--lore-text-secondary)]">
        {text}
      </div>
    </div>
  );
}

/**
 * Client-side dissent extraction, mirroring lib/chorus.ts.
 *
 * Duplicated deliberately: the live view has the synthesis as a stream of
 * tokens and no round-trip to ask the server what it means, and waiting for the
 * saved record before showing the most important part of the answer would
 * delay it by the length of the whole generation.
 */
function extractDissents(synthesis: string): string[] {
  if (!synthesis.trim()) return [];
  const match = synthesis.match(
    /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:\*\*|##+\s*)?WHERE THE PANEL SPLIT\b[:*\s]*\n?([\s\S]*)$/i,
  );
  if (!match) return [];
  const body = match[1].trim();
  if (!body || /^(none|the panel (?:genuinely )?agreed|no (?:substantive )?disagreement)/i.test(body)) {
    return [];
  }
  const bullets = body
    .split(/\n(?=\s*(?:[-*•]|\d+[.)])\s)/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 12);
  return bullets.length ? bullets : [body.slice(0, 2_000)];
}

function PanelSetup({ state, onChanged }: { state: ChorusState; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const panel = state.config.panelists;

  const setPanel = async (next: Panelist[]) => {
    setSaving(true);
    await putJson("/api/chorus", { panelists: next });
    setSaving(false);
    onChanged();
  };

  return (
    <Panel title="The panel" hint="Who answers, and with which model.">
      <div className="space-y-2">
        {panel.map((panelist, index) => (
          <div key={panelist.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--lore-text-primary)]">
              {panelist.label}
            </span>
            <input
              value={panelist.model}
              aria-label={`Model for ${panelist.label}`}
              onChange={(event) => {
                const next = [...panel];
                next[index] = { ...panelist, model: event.target.value };
                void setPanel(next);
              }}
              spellCheck={false}
              className="w-56 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 py-1.5 text-[12.5px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            />
            {/* An icon is not a name. Without this the control announces as
                "button" and there are three of them in a column. */}
            <Button
              title={`Remove ${panelist.label} from the panel`}
              onClick={() => void setPanel(panel.filter((p) => p.id !== panelist.id))}
            >
              <X size={12} />
              <span className="sr-only">Remove {panelist.label} from the panel</span>
            </Button>
          </div>
        ))}
        {!panel.length ? <Empty>Nobody on the panel.</Empty> : null}
      </div>

      {state.suggestion.length && state.suggestion.length !== panel.length ? (
        <div className="mt-3">
          <Button busy={saving} onClick={() => void setPanel(state.suggestion)}>
            Use every model available ({state.suggestion.length})
          </Button>
        </div>
      ) : null}

      <div className="mt-4 border-t border-[var(--lore-border)] pt-3">
        <p className="text-[13px] font-medium text-[var(--lore-text-primary)]">API keys</p>
        <p className="t-body mt-1 text-[var(--lore-text-secondary)]">
          Stored in <span style={{ fontFamily: "var(--font-mono), monospace" }}>~/.lore</span> with
          owner-only permissions, and never shown again — not even partially. Chorus is the only
          part of Lore that sends what you wrote to a model somebody else runs.
        </p>
        <div className="mt-2 space-y-2">
          {state.providers
            .filter((provider) => provider.id !== "ollama")
            .map((provider) => (
              <KeyRow key={provider.id} provider={provider} onChanged={onChanged} />
            ))}
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--lore-border)] pt-3">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={state.config.skipCritique}
            onChange={async (event) => {
              await putJson("/api/chorus", { skipCritique: event.target.checked });
              onChanged();
            }}
            className="mt-1 h-3.5 w-3.5 accent-[var(--lore-accent)]"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-[var(--lore-text-primary)]">
              Skip the critique round
            </span>
            <span className="t-meta block text-[var(--lore-text-tertiary)]">
              Faster and cheaper. Also the round where models catch each other&rsquo;s mistakes,
              which is most of why this exists.
            </span>
          </span>
        </label>
      </div>
    </Panel>
  );
}

function KeyRow({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-[13px] text-[var(--lore-text-secondary)]">
        {provider.label}
      </span>
      {provider.configured ? (
        <>
          <span className="t-meta inline-flex items-center gap-1 text-[var(--lore-success)]">
            <Check size={12} />
            {provider.fromEnv ? "set in the environment" : "stored"}
          </span>
          {!provider.fromEnv ? (
            <DangerButton
              label="Remove"
              confirmLabel="Really remove it?"
              onConfirm={async () => {
                await postJson("/api/chorus", { action: "key", provider: provider.id, key: null });
                onChanged();
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste a key"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 py-1.5 text-[12.5px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
          />
          <Button
            busy={busy}
            onClick={async () => {
              if (!value.trim()) return;
              setBusy(true);
              await postJson("/api/chorus", {
                action: "key",
                provider: provider.id,
                key: value.trim(),
              });
              /* Cleared before anything re-renders. The value is in a password
                 field, but this screen is often on a shared display. */
              setValue("");
              setBusy(false);
              onChanged();
            }}
          >
            Save
          </Button>
        </>
      )}
    </div>
  );
}
