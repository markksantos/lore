"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Eye, Loader2, Play, Search, Sparkles, Trash2 } from "lucide-react";
import {
  bytes,
  Button,
  CapabilityNotice,
  clockTime,
  compact,
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
 * Ghost's screen.
 *
 * Structured as an answer to the question a person actually arrives with —
 * "what was I doing" — rather than as a settings page for a screen recorder.
 * So the ask box is first, the day's account is second, and the machinery is
 * below the fold.
 *
 * The thing this screen must never do is imply Ghost saw something it did not.
 * Every frame carries its own timestamp, an undescribed frame says so rather
 * than showing an empty note, and the answer always ships with the pictures it
 * was derived from — because a recall feature that cannot be checked is a
 * recall feature that will eventually be believed when it is wrong.
 */

type Capability = { state: string; detail: string; settingsPane?: string };
type Frame = {
  id: number;
  at: number;
  app: string | null;
  title: string | null;
  summary: string | null;
  body: string | null;
  state: number;
};
type GhostState = {
  config: {
    everySeconds: number;
    keepDays: number;
    describe: boolean;
    allDisplays: boolean;
    excludedApps: string[];
    redact: boolean;
    captureWhenAppUnknown: boolean;
    maxDiskMb: number;
  };
  status: {
    frames: number;
    described: number;
    pending: number;
    failed: number;
    unchanged: number;
    oldest: number | null;
    newest: number | null;
    diskBytes: number;
    topApps: { app: string; frames: number }[];
  };
  capabilities: {
    screenCapture: Capability;
    windowTitles: Capability;
    vision: Capability & { model: string | null };
    storage: Capability;
    platform: string;
  };
  enabled: boolean;
  running: boolean;
  blockedBecause: string | null;
  model: string | null;
};

type Recall = {
  question: string;
  answer: string | null;
  needsModel: boolean;
  window: { from: number; to: number } | null;
  frames: (Frame & { file: string; score: number })[];
  pending: number;
  everEnabled: boolean;
  error?: string | null;
};

export function GhostView() {
  const [state, setState] = useState<GhostState | null>(null);
  const [failed, setFailed] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [recall, setRecall] = useState<Recall | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [digest, setDigest] = useState<{
    summary: string | null;
    frames: number;
    needsModel: boolean;
    error?: string | null;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await getJson<GhostState>("/api/ghost");
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
   * Poll, but only while there is something to watch.
   *
   * Ghost's numbers move on their own — the daemon captures and describes in
   * the background — so a static screen goes stale within a minute of being
   * opened. Polling stops when Ghost is off, because then nothing changes and a
   * timer that fires forever on an idle tab is how a local app ends up in
   * somebody's battery report.
   */
  useEffect(() => {
    if (!state?.running) return;
    const timer = setInterval(() => void load(), 8_000);
    return () => clearInterval(timer);
  }, [state?.running, load]);

  const setEnabled = async (next: boolean) => {
    await postJson("/api/observers", { action: "set", observer: "ghost", enabled: next });
    await load();
  };

  const patch = async (config: Partial<GhostState["config"]>) => {
    await putJson("/api/ghost", config);
    await load();
  };

  const act = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(action);
    setNotice(null);
    const result = await postJson<Record<string, unknown>>("/api/ghost", { action, ...extra });
    setBusy(null);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    await load();
  };

  const ask = async () => {
    const text = question.trim();
    if (!text) return;
    setAsking(true);
    setAskError(null);
    const result = await postJson<Recall>("/api/ghost/ask", { question: text });
    setAsking(false);
    if (!result.ok) {
      setAskError(result.error);
      return;
    }
    setRecall(result.data);
  };

  const loadDigest = async () => {
    setBusy("digest");
    const data = await getJson<{
      summary: string | null;
      frames: number;
      needsModel: boolean;
      error?: string | null;
    }>("/api/ghost?view=digest&force=1", 300_000);
    setBusy(null);
    setDigest(data ?? { summary: null, frames: 0, needsModel: false });
  };

  if (failed) {
    return (
      <ViewFrame title="Ghost" lede="An AI that has been watching your screen, so you can ask it what happened.">
        <Empty>
          Ghost could not be reached. That usually means the local server is restarting.{" "}
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
      <ViewFrame title="Ghost" lede="An AI that has been watching your screen, so you can ask it what happened.">
        <div className="flex items-center gap-2 py-10 text-[var(--lore-text-tertiary)]">
          <Loader2 size={15} className="animate-spin" />
          <span className="t-body">Reading what Ghost has.</span>
        </div>
      </ViewFrame>
    );
  }

  const { config, status, capabilities } = state;

  return (
    <ViewFrame
      title="Ghost"
      lede="It takes a picture of your screen every few seconds and writes down what is happening. Then you can ask it."
      right={
        state.running ? (
          <span className="t-meta inline-flex items-center gap-1.5 rounded-full border border-[var(--lore-border)] px-2.5 py-1 text-[var(--lore-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-success)]" />
            Watching
          </span>
        ) : null
      }
    >
      <ConsentSwitch
        id="ghost"
        label="Ghost"
        reads="Takes a picture of your screen every few seconds and describes it with a model running on this machine."
        enabled={state.enabled}
        blockedBecause={state.blockedBecause}
        onChange={setEnabled}
      />

      <CapabilityNotice
        capability={capabilities.screenCapture}
        what="Screen capture:"
        onRecheck={async () => {
          await postJson("/api/observers", { action: "recheck" });
          await load();
        }}
      />
      <CapabilityNotice capability={capabilities.storage} what="Local index:" />
      {config.describe ? (
        <CapabilityNotice capability={capabilities.vision} what="Reading the screen:" />
      ) : null}
      <CapabilityNotice capability={capabilities.windowTitles} what="Window titles:" />

      {/* ------------------------------------------------------------ ask */}
      <Panel
        title="Ask what you were doing"
        hint="Name a time if you can — “twenty minutes ago”, “this morning”, “yesterday”."
      >
        <div className="flex flex-wrap gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) void ask();
            }}
            aria-label="Ask Ghost what you were doing"
            placeholder="What was that error I got 20 minutes ago?"
            className="min-w-0 flex-1 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5 text-[16px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:text-[14px]"
          />
          <Button variant="primary" busy={asking} onClick={() => void ask()}>
            <Search size={13} />
            Ask
          </Button>
        </div>
        {askError ? <ErrorNote>{askError}</ErrorNote> : null}

        {recall ? (
          <div className="mt-4">
            {recall.window ? (
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                Looked between {dayAndTime(recall.window.from)} and {dayAndTime(recall.window.to)}.
              </p>
            ) : null}

            {recall.answer ? (
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--lore-text-primary)]">
                {recall.answer}
              </p>
            ) : recall.error ? (
              <ErrorNote>
                Ghost found the moments but the local model failed on the way to an answer:{" "}
                {recall.error}
              </ErrorNote>
            ) : recall.needsModel ? (
              <ErrorNote>
                Ghost found the moments but has no local model to read them back to you. Install
                Ollama and pull a model, and this becomes a sentence instead of a filmstrip.
              </ErrorNote>
            ) : !recall.frames.length ? (
              <Empty>
                {recall.everEnabled
                  ? "Nothing Ghost captured matches that. It only knows about the time it was switched on."
                  : "Ghost has never been switched on, so there is nothing to remember yet."}
              </Empty>
            ) : null}

            {recall.pending > 0 ? (
              <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
                {recall.pending} of these frames have not been read by the model yet — the pictures
                are there, the notes are not.
              </p>
            ) : null}

            {recall.frames.length ? <FrameStrip frames={recall.frames} /> : null}
          </div>
        ) : null}
      </Panel>

      {/* --------------------------------------------------------- digest */}
      <Panel
        title="What you did today"
        right={
          <Button busy={busy === "digest"} onClick={() => void loadDigest()}>
            <Sparkles size={12} />
            {digest ? "Redo" : "Write it"}
          </Button>
        }
      >
        {digest?.summary ? (
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--lore-text-secondary)]">
            {digest.summary}
          </div>
        ) : digest?.needsModel ? (
          <ErrorNote>No local model is running, so there is nothing to write the account with.</ErrorNote>
        ) : digest?.error ? (
          /* A model that failed is not an empty day, and saying "nothing was
             captured" about a day with two thousand frames in it is the kind of
             wrong answer that makes people stop believing the rest. */
          <ErrorNote>
            {digest.frames} frame{digest.frames === 1 ? "" : "s"} were captured today, but the model
            could not read them back: {digest.error}
          </ErrorNote>
        ) : digest ? (
          <Empty>Nothing was captured today.</Empty>
        ) : (
          <p className="t-body text-[var(--lore-text-tertiary)]">
            Built from today&rsquo;s frames, grouped by what you were doing rather than by the clock.
          </p>
        )}
      </Panel>

      {/* ---------------------------------------------------------- state */}
      <div className="mt-4">
        <Stats
          items={[
            { label: "frames kept", value: compact(status.frames) },
            {
              label: "read by the model",
              value: compact(status.described),
              hint: `${status.pending} waiting, ${status.unchanged} unchanged, ${status.failed} failed`,
            },
            { label: "on disk", value: bytes(status.diskBytes) },
            {
              label: "oldest",
              value: status.oldest ? relativeTime(status.oldest) : "—",
              hint: `Kept for ${config.keepDays} days`,
            },
          ]}
        />
      </div>

      {status.topApps.length ? (
        <Panel title="Where the week went" hint="Frames captured per app in the last seven days.">
          <div className="space-y-1.5">
            {status.topApps.map((row) => {
              const share = row.frames / Math.max(1, status.topApps[0].frames);
              return (
                <div key={row.app} className="flex min-w-0 items-center gap-2">
                  <span className="w-32 shrink-0 truncate text-[12.5px] text-[var(--lore-text-secondary)]">
                    {row.app}
                  </span>
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
                    <span
                      className="block h-full rounded-full bg-[var(--lore-accent)]"
                      style={{ width: `${Math.max(3, share * 100)}%` }}
                    />
                  </span>
                  <span className="t-meta w-12 shrink-0 text-right text-[var(--lore-text-tertiary)]">
                    {compact(row.frames)}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* ------------------------------------------------------- settings */}
      <Panel
        title="How it runs"
        right={
          <>
            <Button busy={busy === "run"} onClick={() => void act("run")}>
              <Play size={12} />
              Run one now
            </Button>
            <Button busy={busy === "describe"} onClick={() => void act("describe")}>
              <Eye size={12} />
              Read {status.pending} waiting
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="A picture every">
            <select
              value={config.everySeconds}
              onChange={(event) => void patch({ everySeconds: Number(event.target.value) })}
              className={selectClass}
            >
              {[5, 10, 15, 30, 60, 120, 300].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute${seconds > 60 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Forget after">
            <select
              value={config.keepDays}
              onChange={(event) => void patch({ keepDays: Number(event.target.value) })}
              className={selectClass}
            >
              {[1, 3, 7, 14, 30, 90].map((days) => (
                <option key={days} value={days}>
                  {days} day{days === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </Field>

          <Toggle
            label="Read the screen with a model"
            hint="Off keeps the pictures and the window titles, and skips the descriptions."
            checked={config.describe}
            onChange={(next) => void patch({ describe: next })}
          />
          <Toggle
            label="Redact secrets before storing"
            hint="Runs extracted text through the same scrubber the rest of Lore uses."
            checked={config.redact}
            onChange={(next) => void patch({ redact: next })}
          />
          <Toggle
            label="Capture every display"
            hint="Off captures the main screen only. Each screen is stored as its own frame."
            checked={config.allDisplays}
            onChange={(next) => void patch({ allDisplays: next })}
          />
          {/* Only shown when it can actually bite. Offering to weaken a guard
              on a machine where the guard is working is an invitation with no
              upside. */}
          {capabilities.windowTitles.state !== "ready" ? (
            <Toggle
              label="Capture even when the app is unknown"
              hint="macOS will not say what is in front, so the never-capture list cannot be honoured. Off means Ghost waits rather than risking it."
              checked={config.captureWhenAppUnknown}
              onChange={(next) => void patch({ captureWhenAppUnknown: next })}
            />
          ) : null}
        </div>

        <div className="mt-4">
          <p className="text-[13px] font-medium text-[var(--lore-text-primary)]">Never capture</p>
          <p className="t-meta mt-0.5 text-[var(--lore-text-tertiary)]">
            While one of these is in front, no picture is taken at all — not taken and filtered,
            not taken. If macOS will not say which app is in front, nothing is taken either.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {config.excludedApps.map((app) => (
              <span
                key={app}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--lore-border)] px-2 py-1 text-[12px] text-[var(--lore-text-secondary)]"
              >
                {app}
                <button
                  type="button"
                  aria-label={`Stop excluding ${app}`}
                  onClick={() =>
                    void patch({ excludedApps: config.excludedApps.filter((name) => name !== app) })
                  }
                  className="text-[var(--lore-text-tertiary)] hover:text-[var(--lore-danger)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <AddApp
            onAdd={(name) => void patch({ excludedApps: [...config.excludedApps, name] })}
            existing={config.excludedApps}
          />
        </div>

        {notice ? <ErrorNote>{notice}</ErrorNote> : null}
      </Panel>

      {/* --------------------------------------------------------- delete */}
      <Panel title="Forget" hint="Deletes pictures and notes from this machine. There is no copy anywhere else.">
        <div className="flex flex-wrap gap-2">
          <DangerButton
            label="Forget the last hour"
            confirmLabel="Really forget the last hour?"
            onConfirm={() =>
              act("forget-range", { from: Date.now() - 3_600_000, to: Date.now() })
            }
          />
          <DangerButton
            label="Forget everything Ghost has"
            confirmLabel="Really delete every frame?"
            onConfirm={() => act("forget-all")}
          />
          <Button onClick={() => void act("prune")} busy={busy === "prune"}>
            <Trash2 size={12} />
            Apply retention now
          </Button>
        </div>
      </Panel>
    </ViewFrame>
  );
}

const selectClass =
  "w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[13px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="t-meta block text-[var(--lore-text-tertiary)]">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[var(--lore-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
    >
      <span
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-[var(--lore-accent)]" : "bg-[var(--lore-border-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-[1.125rem]" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--lore-text-primary)]">{label}</span>
        {hint ? <span className="t-meta block text-[var(--lore-text-tertiary)]">{hint}</span> : null}
      </span>
    </button>
  );
}

function AddApp({ onAdd, existing }: { onAdd: (name: string) => void; existing: string[] }) {
  const [value, setValue] = useState("");
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const name = value.trim();
          if (!name || existing.some((app) => app.toLowerCase() === name.toLowerCase())) return;
          onAdd(name);
          setValue("");
        }}
        placeholder="Application name, exactly as macOS shows it"
        className="min-w-0 flex-1 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[16px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:text-[13px]"
      />
      <Button
        onClick={() => {
          const name = value.trim();
          if (!name || existing.some((app) => app.toLowerCase() === name.toLowerCase())) return;
          onAdd(name);
          setValue("");
        }}
      >
        Add
      </Button>
    </div>
  );
}

/**
 * The frames behind an answer.
 *
 * A horizontal strip rather than a grid, because these are moments in sequence
 * and the order carries meaning. Selecting one shows its note in full — the
 * check on whether the answer above was fair.
 */
function FrameStrip({ frames }: { frames: (Frame & { file: string })[] }) {
  const [selected, setSelected] = useState<number>(frames[0]?.id ?? 0);
  const current = frames.find((frame) => frame.id === selected) ?? frames[0];
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelected(frames[0]?.id ?? 0);
    scroller.current?.scrollTo({ left: 0 });
  }, [frames]);

  if (!frames.length) return null;

  return (
    <div className="mt-4 min-w-0">
      <div
        ref={scroller}
        className="lore-scrollbar flex min-w-0 gap-2 overflow-x-auto pb-2"
        role="listbox"
        aria-label="Captured moments"
      >
        {frames.map((frame) => (
          <button
            key={frame.id}
            type="button"
            role="option"
            aria-selected={frame.id === selected}
            onClick={() => setSelected(frame.id)}
            className={cn(
              "w-40 shrink-0 overflow-hidden rounded-lg border text-left transition-colors",
              frame.id === selected
                ? "border-[var(--lore-accent)]"
                : "border-[var(--lore-border)] hover:border-[var(--lore-border-strong)]",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- these are
                local screenshots served from the loopback API; next/image would
                proxy and cache pictures of the user's own screen. */}
            <img
              src={`/api/ghost/frame?id=${frame.id}`}
              alt=""
              loading="lazy"
              className="h-24 w-full bg-[var(--lore-surface-raised)] object-cover"
            />
            <span className="block px-2 py-1.5">
              <span className="block truncate text-[11.5px] font-medium text-[var(--lore-text-primary)]">
                {clockTime(frame.at)} · {frame.app ?? "unknown"}
              </span>
              <span className="t-meta block truncate text-[var(--lore-text-tertiary)]">
                {frame.title ?? " "}
              </span>
            </span>
          </button>
        ))}
      </div>

      {current ? (
        <div className="mt-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3">
          <p className="t-meta text-[var(--lore-text-tertiary)]">
            {dayAndTime(current.at)} · {current.app ?? "unknown app"}
            {current.title ? ` · ${current.title}` : ""}
          </p>
          {current.summary ? (
            <p className="mt-1 text-[13.5px] text-[var(--lore-text-primary)]">{current.summary}</p>
          ) : (
            <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
              {current.state === 2
                ? "The screen had not changed, so this frame was not read again."
                : current.state === 3
                  ? "The model could not read this frame."
                  : "Not read by the model yet."}
            </p>
          )}
          {current.body ? (
            <pre className="lore-scrollbar mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--lore-text-secondary)]">
              {current.body}
            </pre>
          ) : null}
          <div className="mt-2">
            <DangerButton
              label="Forget this frame"
              confirmLabel="Really delete it?"
              onConfirm={async () => {
                await postJson("/api/ghost", { action: "forget-frame", id: current.id });
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Exported for the palette and the desktop hotkey, which both open Ghost cold. */
export const GHOST_PLACEHOLDER = "What was that error I got 20 minutes ago?";
export { Camera as GhostIcon };
