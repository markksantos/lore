"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Cpu, Loader2, Sparkles } from "lucide-react";
import type { OllamaModel } from "@/lib/ollama";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

type Detection = {
  host: string;
  running: boolean;
  models: OllamaModel[];
  error: string | null;
  recommended: string | null;
  reason: string | null;
};

type Task = "summarize" | "tags" | "title";

type Result = { task: Task; model: string; text?: string; tags?: string[] };

const STORAGE_KEY = "lore:ai:model";
const PULL_COMMAND = "ollama pull gemma4:12b";

const TASKS: { id: Task; label: string; blurb: string }[] = [
  { id: "summarize", label: "Summarise", blurb: "One sentence, twenty words." },
  { id: "tags", label: "Tags", blurb: "Three to six, drawn from the text you paste." },
  { id: "title", label: "Title", blurb: "A title that says what the page is." },
];

const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/** A shell command you are meant to run, with the one affordance that matters. */
function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-2">
      <code
        className="min-w-0 flex-1 truncate text-[13px] text-[var(--lore-text-primary)]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface)] hover:text-[var(--lore-text-primary)]"
      >
        {copied ? <Check size={11} className="text-[var(--lore-success)]" /> : <Copy size={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Local AI — the jobs that should never leave the machine.
 *
 * Summarising a page, proposing tags and rewriting a title are small and
 * repetitive, and they run over a private wiki. Lore sends them to a model on
 * this machine instead of a paid API.
 *
 * Ollama being absent is not an error and is not presented as one. These
 * features are optional; the rest of Lore does not depend on them, and the
 * page's job in that case is to explain the one command that turns them on —
 * not to nag. Lore detects Ollama and never installs or bundles it.
 */
export function AiView() {
  const [data, setData] = useState<Detection | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState<Task | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/ai")
      .then((response) => (response.ok ? response.json() : null))
      .then((detection: Detection | null) => {
        if (!live || !detection) return;
        setData(detection);
        // A stored choice only survives while the model does: uninstalling a
        // model must not leave the picker pointing at something that is gone.
        const stored = localStorage.getItem(STORAGE_KEY);
        const installed = detection.models.map((m) => m.name);
        setModel(
          stored && installed.includes(stored)
            ? stored
            : (detection.recommended ?? installed[0] ?? null),
        );
      })
      .catch(() => setData(null));
    return () => {
      live = false;
    };
  }, []);

  const choose = useCallback((name: string) => {
    setModel(name);
    localStorage.setItem(STORAGE_KEY, name);
  }, []);

  async function run(task: Task) {
    if (!model) return;
    setRunning(task);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, model, text: draft }),
      });
      const body = (await response.json()) as Result & { error?: string };
      if (!response.ok) setError(body.error ?? "The model did not return anything usable.");
      else setResult(body);
    } catch {
      setError("Could not reach the local model.");
    }
    setRunning(null);
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Local AI
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Optional. Summaries, tags and titles written by a model running on this machine —
          nothing is uploaded and nothing is billed. Lore detects Ollama; it never installs
          or bundles it.
        </p>
      </header>

      {/* Detection, stated plainly. Not running is a state, not a failure. */}
      <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="pal-dot"
            style={{
              background: data.running ? "var(--lore-success)" : "var(--lore-border-strong)",
            }}
          />
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
            {data.running ? "Ollama is running" : "Ollama is not running"}
          </h2>
          <span className="flex-1" />
          <code
            className="t-meta min-w-0 truncate text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {data.host}
          </code>
        </div>

        {data.error ? (
          <p className="t-meta mt-2 text-[var(--lore-danger)]">{data.error}</p>
        ) : null}

        {!data.running ? (
          <>
            <p className="t-body mt-2 text-[var(--lore-text-secondary)]">
              Nothing here is required — every other part of Lore works without it. If you
              want these three jobs done locally, start Ollama and reload this page.
            </p>
            <Command command="ollama serve" />
            <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
              If that command isn&apos;t found, Ollama isn&apos;t installed yet. It is a
              separate download from ollama.com — Lore will not fetch it for you.
            </p>
          </>
        ) : data.models.length === 0 ? (
          <>
            <p className="t-body mt-2 text-[var(--lore-text-secondary)]">
              Running, but no models are installed. Pull one and reload this page.
            </p>
            <Command command={PULL_COMMAND} />
          </>
        ) : (
          <p className="t-body mt-2 text-[var(--lore-text-secondary)]">
            {data.models.length} model{data.models.length === 1 ? "" : "s"} installed.
          </p>
        )}
      </section>

      {data.running && data.models.length > 0 ? (
        <>
          <section className="mt-8">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
              Model
            </h2>
            {data.reason ? (
              <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">{data.reason}</p>
            ) : null}

            <div className="mt-3 space-y-2">
              {data.models.map((installed, i) => {
                const active = installed.name === model;
                return (
                  <button
                    key={installed.name}
                    type="button"
                    onClick={() => choose(installed.name)}
                    style={paletteVars(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                      active
                        ? "border-[var(--lore-accent)] bg-[var(--lore-accent-tint)]"
                        : "border-[var(--lore-border)] bg-[var(--lore-surface)] hover:bg-[var(--lore-surface-raised)]",
                    )}
                  >
                    <span className="pal-dot" />
                    <span
                      className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      {installed.name}
                    </span>
                    {installed.name === data.recommended ? (
                      <span className="pal-chip shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.05em]">
                        Recommended
                      </span>
                    ) : null}
                    <span className="t-meta shrink-0 tabular-nums text-[var(--lore-text-tertiary)]">
                      {gigabytes(installed.size)}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
              Don&apos;t have Gemma 4? It is Apache-2.0 and handles these jobs at 12B.
            </p>
            <Command command={PULL_COMMAND} />
          </section>

          {/* A scratchpad, and the whole of the feature today: text in, one
              answer back. Nothing here reads or writes the vault. */}
          <section className="mt-10">
            <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
              <Sparkles size={16} className="text-[var(--lore-text-tertiary)]" />
              Try it
            </h2>
            <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
              Paste a page in and see what the local model gives back. Nothing here is
              written to the vault.
            </p>

            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={7}
              spellCheck={false}
              placeholder="Paste the text of a page…"
              className="lore-scrollbar mt-3 w-full resize-y rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3.5 py-3 text-[13.5px] leading-relaxed text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-border-strong)]"
            />

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {TASKS.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => run(task.id)}
                  disabled={running !== null || draft.trim().length < 40}
                  title={task.blurb}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-40"
                >
                  {running === task.id ? <Loader2 size={12} className="animate-spin" /> : null}
                  {task.label}
                </button>
              ))}
              <span className="t-meta text-[var(--lore-text-tertiary)]">
                {draft.trim().length < 40 ? "Needs a paragraph to work with." : null}
              </span>
            </div>

            {error ? (
              <p className="t-meta mt-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3 text-[var(--lore-danger)]">
                {error}
              </p>
            ) : null}

            {result ? (
              <div className="mt-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--lore-text-tertiary)]">
                  <Cpu size={11} />
                  {result.model}
                </p>
                {result.tags ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.tags.map((tag) => (
                      <span key={tag} className="lore-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="t-body mt-1.5 text-[var(--lore-text-primary)]">{result.text}</p>
                )}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
