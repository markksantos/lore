"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, PenLine, RefreshCw, Sparkles } from "lucide-react";
import {
  bytes,
  Button,
  CapabilityNotice,
  compact,
  ConsentSwitch,
  DangerButton,
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
 * Understudy's screen.
 *
 * Two halves. Above: write something, and see how closely it matched. Below:
 * the measurements it matched against, shown in full.
 *
 * Showing the profile is not a nicety. Every other "writes in your voice"
 * product is a black box, and a black box that claims to know how you write is
 * unfalsifiable — you cannot tell whether it learned you or is flattering you.
 * The numbers here are checkable against your own sense of yourself, and if the
 * median sentence length is wrong you can see that it is wrong.
 *
 * The voice-match score does the same job in the other direction: it says how
 * far the draft drifted, and on which dimension, so "this doesn't sound like
 * me" becomes "the sentences are twice as long as yours".
 */

type Capability = { state: string; detail: string; settingsPane?: string };

type VoiceStats = {
  samples: number;
  words: number;
  sentenceMean: number;
  sentenceMedian: number;
  sentenceP90: number;
  sentenceShortShare: number;
  sentenceLongShare: number;
  paragraphMean: number;
  wordLengthMean: number;
  contractionRate: number;
  emDashRate: number;
  semicolonRate: number;
  exclamationRate: number;
  ellipsisRate: number;
  parentheticalRate: number;
  emojiRate: number;
  lowercaseOpenRate: number;
  bulletRate: number;
  openers: { phrase: string; n: number }[];
  closers: { phrase: string; n: number }[];
  signature: { word: string; n: number; lift: number }[];
};

type UnderstudyState = {
  config: { sources: Record<string, boolean>; folders: string[]; minWords: number; redact: boolean };
  status: {
    samples: number;
    words: number;
    bySource: { source: string; n: number; words: number }[];
    audiences: { audience: string; n: number }[];
    profileAt: number | null;
    diskBytes: number;
    drafts: number;
  };
  profile: { at: number; overall: VoiceStats; byAudience: { audience: string; stats: VoiceStats }[] } | null;
  brief: string | null;
  localModel: Capability & { model: string | null };
  enabled: boolean;
  running: boolean;
  blockedBecause: string | null;
};

type DraftResult = {
  text: string;
  match: number | null;
  needsModel: boolean;
  deviations: { name: string; yours: string; draft: string }[];
  exemplars: { text: string; audience: string | null }[];
};

const SOURCE_LABEL: Record<string, string> = {
  wiki: "Your wiki",
  "sent-mail": "Mail you sent",
  messages: "Messages you sent",
  folders: "Folders you choose",
};

const SOURCE_HINT: Record<string, string> = {
  wiki: "Pages in the vault Lore already has open.",
  "sent-mail": "Sent mailboxes only. Quoted replies and signatures are stripped first.",
  messages: "Only messages from you. Consecutive texts are stitched into one sample.",
  folders: "Drafts, letters, anything you have written in markdown or plain text.",
};

export function UnderstudyView() {
  const [state, setState] = useState<UnderstudyState | null>(null);
  const [failed, setFailed] = useState(false);
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const data = await getJson<UnderstudyState>("/api/understudy", 30_000);
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

  const act = async (action: string, extra?: Record<string, unknown>, timeout = 600_000) => {
    setBusy(action);
    setNotice(null);
    const response = await postJson<Record<string, unknown>>(
      "/api/understudy",
      { action, ...extra },
      timeout,
    );
    setBusy(null);
    if (!response.ok) {
      setNotice(response.error);
      return null;
    }
    await load();
    return response.data;
  };

  const write = async () => {
    const text = brief.trim();
    if (!text) return;
    setWriting(true);
    setNotice(null);
    const response = await postJson<DraftResult>(
      "/api/understudy",
      { action: "draft", brief: text, audience },
      180_000,
    );
    setWriting(false);
    if (!response.ok) {
      setNotice(response.error);
      return;
    }
    setResult(response.data);
  };

  if (failed) {
    return (
      <ViewFrame title="Understudy" lede="Drafts in your voice, measured from writing you actually did.">
        <Empty>
          Understudy could not be reached.{" "}
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
      <ViewFrame title="Understudy" lede="Drafts in your voice, measured from writing you actually did.">
        <div className="flex items-center gap-2 py-10 text-[var(--lore-text-tertiary)]">
          <Loader2 size={15} className="animate-spin" />
          <span className="t-body">Reading your voice profile.</span>
        </div>
      </ViewFrame>
    );
  }

  const { status, config, profile } = state;
  const hasVoice = Boolean(profile?.overall.samples);

  return (
    <ViewFrame
      title="Understudy"
      lede="It measures how you actually write — sentence length, contractions, the words you reach for — and drafts in that. Everything stays on this machine."
      right={
        <Button busy={busy === "learn"} onClick={() => void act("learn")}>
          <RefreshCw size={12} />
          Learn from my writing
        </Button>
      }
    >
      <ConsentSwitch
        id="understudy"
        label="Understudy"
        reads="Reads writing you have already done — the sources you tick below — to measure how you write."
        enabled={state.enabled}
        blockedBecause={state.blockedBecause}
        onChange={async (next) => {
          await postJson("/api/observers", { action: "set", observer: "understudy", enabled: next });
          await load();
        }}
      />

      <CapabilityNotice capability={state.localModel} what="Drafting:" />

      {/* ----------------------------------------------------------- draft */}
      <Panel
        title="Write something"
        hint={
          hasVoice
            ? `Measured from ${compact(status.words)} of your own words.`
            : "Nothing measured yet — tick a source below and press Learn."
        }
        right={
          profile?.byAudience.length ? (
            <select
              value={audience ?? ""}
              onChange={(event) => setAudience(event.target.value || null)}
              className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 py-1.5 text-[12.5px] text-[var(--lore-text-primary)] outline-none focus:border-[var(--lore-accent)]"
            >
              <option value="">Your usual voice</option>
              {profile.byAudience.map((entry) => (
                <option key={entry.audience} value={entry.audience}>
                  As you write to {entry.audience}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void write();
          }}
          rows={3}
          placeholder="Tell the client the revision is done and ask if they want the alternate cut."
          disabled={!hasVoice}
          className="w-full resize-y rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5 text-[16px] leading-relaxed text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] disabled:opacity-50 md:text-[14px]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={writing} onClick={() => void write()} disabled={!hasVoice || !brief.trim()}>
            <PenLine size={12} />
            Draft it
          </Button>
          <span className="t-meta text-[var(--lore-text-tertiary)]">⌘↵</span>
        </div>

        {notice ? <ErrorNote>{notice}</ErrorNote> : null}

        {result?.needsModel ? (
          <ErrorNote>
            No local model is running. Understudy will not send your writing to a cloud model to get
            around that — the corpus is your private mail and messages, and there is no code path
            here that reaches a network.
          </ErrorNote>
        ) : null}

        {result?.text ? (
          <div className="mt-4">
            <div className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3">
              <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--lore-text-primary)]">
                {result.text}
              </p>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(result.text).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1_800);
                }}
              >
                <Copy size={12} />
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button busy={writing} onClick={() => void write()}>
                <Sparkles size={12} />
                Again
              </Button>
              {result.match != null ? <VoiceMatch match={result.match} /> : null}
            </div>

            {result.deviations.length ? (
              <div className="mt-2 rounded-lg border border-[var(--lore-border)] px-3 py-2">
                <p className="t-meta text-[var(--lore-text-tertiary)]">Where it drifted from you</p>
                <ul className="mt-1 space-y-0.5">
                  {result.deviations.map((deviation) => (
                    <li key={deviation.name} className="text-[12.5px] text-[var(--lore-text-secondary)]">
                      {deviation.name}: you {deviation.yours}, this draft {deviation.draft}
                    </li>
                  ))}
                </ul>
              </div>
            ) : result.match != null && result.match > 0.85 ? (
              <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
                Every measured dimension is within range of your own writing.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <div className="mt-4">
        <Stats
          items={[
            { label: "samples", value: compact(status.samples) },
            { label: "of your words", value: compact(status.words) },
            { label: "audiences", value: String(status.audiences.length) },
            { label: "stored", value: bytes(status.diskBytes) },
          ]}
        />
      </div>

      {/* --------------------------------------------------------- profile */}
      {hasVoice && profile ? (
        <Panel
          title="How you write"
          hint={status.profileAt ? `Measured ${relativeTime(status.profileAt)}.` : undefined}
          right={
            <Button onClick={() => setShowProfile((open) => !open)}>
              {showProfile ? "Less" : "The whole profile"}
            </Button>
          }
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Measure label="Median sentence" value={`${profile.overall.sentenceMedian} words`} />
            <Measure
              label="Contractions"
              value={`${Math.round(profile.overall.contractionRate * 100)}% of the time`}
            />
            <Measure label="Paragraphs" value={`${profile.overall.paragraphMean} sentences`} />
          </div>

          {profile.overall.signature.length ? (
            <div className="mt-3">
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                Words you use far more than average
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {profile.overall.signature.slice(0, 14).map((entry) => (
                  <span
                    key={entry.word}
                    title={`${entry.n} times`}
                    className="rounded-md border border-[var(--lore-border)] px-2 py-0.5 text-[12px] text-[var(--lore-text-secondary)]"
                  >
                    {entry.word}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {showProfile && state.brief ? (
            <div className="mt-3 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3">
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                Exactly what the model is told about you — no more, no less.
              </p>
              <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-[var(--lore-text-secondary)]">
                {state.brief}
              </pre>
            </div>
          ) : null}

          {showProfile && profile.byAudience.length ? (
            <div className="mt-3">
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                You write differently to different people
              </p>
              <div className="lore-scrollbar mt-1 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-[12.5px]">
                  <thead>
                    <tr className="text-[var(--lore-text-tertiary)]">
                      <th className="py-1 pr-3 font-normal">To</th>
                      <th className="py-1 pr-3 font-normal">Sentence</th>
                      <th className="py-1 pr-3 font-normal">Contractions</th>
                      <th className="py-1 font-normal">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.byAudience.slice(0, 12).map((entry) => (
                      <tr key={entry.audience} className="border-t border-[var(--lore-border)]">
                        <td className="max-w-[16rem] truncate py-1 pr-3 text-[var(--lore-text-primary)]">
                          {entry.audience}
                        </td>
                        <td className="py-1 pr-3 text-[var(--lore-text-secondary)]">
                          {entry.stats.sentenceMedian} words
                        </td>
                        <td className="py-1 pr-3 text-[var(--lore-text-secondary)]">
                          {Math.round(entry.stats.contractionRate * 100)}%
                        </td>
                        <td className="py-1 text-[var(--lore-text-tertiary)]">{entry.stats.samples}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {/* --------------------------------------------------------- sources */}
      <Panel title="What Understudy reads">
        <div className="space-y-1.5">
          {Object.keys(SOURCE_LABEL).map((id) => {
            const counted = status.bySource.find((row) => row.source === id);
            return (
              <label
                key={id}
                className="flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--lore-surface-raised)]"
              >
                <input
                  type="checkbox"
                  checked={config.sources[id] === true}
                  onChange={async (event) => {
                    await putJson("/api/understudy", { sources: { [id]: event.target.checked } });
                    await load();
                  }}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--lore-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--lore-text-primary)]">
                    {SOURCE_LABEL[id]}
                    {counted ? (
                      <span className="t-meta ml-2 font-normal text-[var(--lore-text-tertiary)]">
                        {compact(counted.n)} sample{counted.n === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </span>
                  <span className="t-meta block text-[var(--lore-text-tertiary)]">{SOURCE_HINT[id]}</span>
                </span>
              </label>
            );
          })}
        </div>

        {config.sources.folders ? (
          <div className="mt-3 border-t border-[var(--lore-border)] pt-3">
            {config.folders.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {config.folders.map((folder) => (
                  <span
                    key={folder}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--lore-border)] px-2 py-1 text-[12px] text-[var(--lore-text-secondary)]"
                  >
                    <span className="truncate" style={{ fontFamily: "var(--font-mono), monospace" }}>
                      {folder.replace(/^\/Users\/[^/]+/, "~")}
                    </span>
                    <button
                      type="button"
                      aria-label={`Stop reading ${folder}`}
                      onClick={() => void act("remove-folder", { path: folder }, 20_000)}
                      className="shrink-0 text-[var(--lore-text-tertiary)] hover:text-[var(--lore-danger)]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <PathInput
              placeholder="~/Documents/drafts"
              onAdd={async (path) => {
                await act("add-folder", { path }, 20_000);
              }}
            />
          </div>
        ) : null}
      </Panel>

      <Panel title="Forget" hint="Deletes the samples and the profile. Your writing itself is untouched.">
        <DangerButton
          label="Forget how I write"
          confirmLabel="Really delete the voice profile?"
          onConfirm={() => act("forget", undefined, 30_000)}
        />
      </Panel>
    </ViewFrame>
  );
}

function Measure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--lore-border)] px-3 py-2">
      <div className="truncate text-[14px] font-medium text-[var(--lore-text-primary)]">{value}</div>
      <div className="t-meta truncate text-[var(--lore-text-tertiary)]">{label}</div>
    </div>
  );
}

/**
 * The match score, with the honest caveat attached.
 *
 * A percentage invites being read as "87% you", which it is not — it is the
 * average closeness across eleven measurable dimensions, and a draft can score
 * well while being wrong in a way no measurement catches. The label says
 * "measured", not "sounds like".
 */
function VoiceMatch({ match }: { match: number }) {
  const pct = Math.round(match * 100);
  return (
    <span
      title="Average closeness across eleven measured dimensions. It cannot tell you whether the content is right."
      className={cn(
        "t-meta inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        pct >= 80
          ? "border-[var(--lore-success)] text-[var(--lore-success)]"
          : pct >= 60
            ? "border-[var(--lore-border)] text-[var(--lore-text-secondary)]"
            : "border-[var(--lore-border)] text-[var(--lore-text-tertiary)]",
      )}
    >
      {pct}% measured match
    </span>
  );
}
