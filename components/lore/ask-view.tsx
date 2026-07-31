"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { renderAnswer } from "@/lib/markdown";
import { cn, count } from "@/lib/utils";

/**
 * Ask — a conversation with your own wiki.
 *
 * The first version was a form: a heading, a box, a submit button, and the
 * answer printed underneath as plain text. Two things were wrong with that.
 * The model replies in markdown whatever the prompt says, so a bulleted answer
 * rendered as a wall of literal asterisks and `**bold**`. And a form is the
 * wrong shape for something you return to — the composer belongs at the bottom,
 * the thread above it, in the arrangement everyone already knows rather than a
 * novel one they have to learn.
 *
 * Answers are still never shown without their sources. That is the one part of
 * this screen that is not a chat convention: a wiki assistant you cannot check
 * is worth less than no assistant.
 */

type Source = { n: number; pageId: string; relPath: string; title: string };

type Passage = Source & {
  section: string | null;
  text: string;
  trust: string;
  tokens: number;
};

type Answer = {
  question: string;
  answer: string | null;
  empty?: boolean;
  reason?: string;
  needsModel?: boolean;
  passages: Passage[];
  omitted: { relPath: string; title: string }[];
};

type Turn = {
  id: string;
  at: number;
  question: string;
  answer: string | null;
  sources: Source[];
};

/** One exchange in the visible thread. */
type Message = {
  id: string;
  question: string;
  answer: string | null;
  passages: Passage[];
  omitted: { relPath: string; title: string }[];
  empty?: boolean;
  reason?: string;
  needsModel?: boolean;
  pending?: boolean;
};

export function AskView({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);

  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  const loadSidebar = useCallback(async () => {
    const d = await fetch("/api/asked")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!d) return;
    setHistory(d.history ?? []);
    setSuggestions(d.suggestions ?? []);
  }, []);

  useEffect(() => {
    loadSidebar();
  }, [loadSidebar]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const ask = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || asking) return;

      const id = `${Date.now().toString(36)}`;
      setQuestion("");
      setError(null);
      setActiveThread(null);
      // The question appears immediately. Waiting for a slow model before seeing
      // your own words echoed back is what makes something feel like a form.
      setMessages((m) => [
        ...m,
        { id, question: trimmed, answer: null, passages: [], omitted: [], pending: true },
      ]);
      setAsking(true);

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });
        const data = (await response.json()) as Answer & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "That question could not be answered.");
        setMessages((m) =>
          m.map((msg) =>
            msg.id === id
              ? {
                  ...msg,
                  pending: false,
                  answer: data.answer,
                  passages: data.passages ?? [],
                  omitted: data.omitted ?? [],
                  empty: data.empty,
                  reason: data.reason,
                  needsModel: data.needsModel,
                }
              : msg,
          ),
        );
        loadSidebar();
      } catch (e) {
        setMessages((m) => m.filter((msg) => msg.id !== id));
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setAsking(false);
      }
    },
    [asking, loadSidebar],
  );

  function openThread(turn: Turn) {
    setActiveThread(turn.id);
    setMessages([
      {
        id: turn.id,
        question: turn.question,
        answer: turn.answer,
        // Stored threads keep source titles, not bodies — enough to reopen a
        // page, not enough to re-read the passage here.
        passages: turn.sources.map((s) => ({
          ...s,
          section: null,
          text: "",
          trust: "",
          tokens: 0,
        })),
        omitted: [],
      },
    ]);
  }

  function reset() {
    setMessages([]);
    setActiveThread(null);
    setQuestion("");
    setError(null);
    input.current?.focus();
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--lore-border)] lg:flex">
        <button
          type="button"
          onClick={reset}
          className="m-3 inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
        >
          <Plus size={13} />
          New question
        </button>

        <div className="lore-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {history.length ? (
            <p className="t-meta px-2 pb-1.5 pt-1 font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
              Asked before
            </p>
          ) : null}
          {history.map((turn) => (
            <div key={turn.id} className="group/row relative">
              <button
                type="button"
                onClick={() => openThread(turn)}
                title={turn.question}
                className={cn(
                  "w-full truncate rounded-lg px-2 py-1.5 pr-7 text-left text-[13px] transition-colors",
                  activeThread === turn.id
                    ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
                    : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
                )}
              >
                {turn.question}
              </button>
              <button
                type="button"
                aria-label="Forget this question"
                onClick={async () => {
                  await fetch(`/api/asked?id=${encodeURIComponent(turn.id)}`, {
                    method: "DELETE",
                  });
                  if (activeThread === turn.id) reset();
                  loadSidebar();
                }}
                className="absolute right-1 top-1.5 rounded p-1 text-[var(--lore-text-tertiary)] opacity-0 transition-opacity hover:text-[var(--lore-danger)] group-hover/row:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Transcript scrolls; composer is pinned to the bottom. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="lore-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            {empty ? (
              <div className="pt-[8vh]">
                <h1 className="text-center text-[30px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
                  Ask your wiki
                </h1>
                <p className="t-body mx-auto mt-2 max-w-md text-center text-[var(--lore-text-secondary)]">
                  Answered only from your own pages, with every source shown. Runs on your
                  machine.
                </p>

                {suggestions.length ? (
                  <div className="mt-8">
                    <p className="t-meta mb-2.5 flex items-center justify-center gap-1.5 text-[var(--lore-text-tertiary)]">
                      <Sparkles size={12} />
                      Built from your own pages
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {suggestions.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => ask(q)}
                          className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3.5 py-2.5 text-left text-[13.5px] leading-[1.5] text-[var(--lore-text-secondary)] transition-colors hover:border-[var(--lore-accent)]/40 hover:text-[var(--lore-text-primary)]"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-8">
                {messages.map((m) => (
                  <Exchange key={m.id} message={m} onOpenPage={onOpenPage} />
                ))}
              </div>
            )}

            {error ? (
              <p className="mt-6 rounded-xl border border-[var(--lore-danger)]/40 px-4 py-3 text-[13.5px] text-[var(--lore-danger)]">
                {error}
              </p>
            ) : null}

            <div ref={bottom} />
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-6 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
            className="relative mx-auto max-w-3xl"
          >
            <textarea
              ref={input}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(question);
                }
              }}
              rows={1}
              autoFocus
              placeholder="Ask anything your wiki would know"
              className="lore-scrollbar max-h-40 w-full resize-none rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] py-3.5 pl-4 pr-14 text-[15px] leading-[1.6] text-[var(--lore-text-primary)] outline-none transition-colors placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)]"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              aria-label="Ask"
              className="absolute bottom-2.5 right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--lore-accent)] text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-30"
            >
              {asking ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} />}
            </button>
          </form>
          <p className="t-meta mx-auto mt-2 max-w-3xl text-center text-[var(--lore-text-tertiary)]">
            Answers come only from your pages — check the sources.
          </p>
        </div>
      </div>
    </div>
  );
}

/** One question and its answer. */
function Exchange({
  message,
  onOpenPage,
}: {
  message: Message;
  onOpenPage: (pageId: string) => void;
}) {
  const [showSources, setShowSources] = useState(false);
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement | null>(null);

  /*
   * One delegated listener rather than one per citation.
   *
   * The answer is HTML — rendering it as React would mean either losing markdown
   * or rebuilding a markdown renderer in JSX — so citation chips inside it are
   * plain buttons carrying `data-cite`, and this catches every click on them.
   * Thirty citations, one listener.
   */
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cite]");
      if (!target) return;
      event.preventDefault();
      setShowSources(true);
      requestAnimationFrame(() =>
        document
          .getElementById(`src-${message.id}-${target.dataset.cite}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
    };
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [message.id]);

  return (
    <div>
      {/* The question, as a bubble on the right — the convention everyone knows. */}
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-[var(--lore-surface-raised)] px-4 py-2.5 text-[15px] leading-[1.6] text-[var(--lore-text-primary)]">
          {message.question}
        </p>
      </div>

      <div className="mt-5">
        {message.pending ? (
          <p className="flex items-center gap-2 text-[14px] text-[var(--lore-text-tertiary)]">
            <Loader2 size={14} className="animate-spin" />
            Searching your pages, then reading the best ones…
          </p>
        ) : message.empty ? (
          <div className="rounded-xl border border-dashed border-[var(--lore-border)] px-5 py-6">
            <p className="text-[14.5px] text-[var(--lore-text-secondary)]">{message.reason}</p>
            <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
              Noted, so you can see later which questions your wiki keeps failing.
            </p>
          </div>
        ) : (
          <>
            {message.answer ? (
              <div
                ref={body}
                className="lore-answer text-[15px] leading-[1.7] text-[var(--lore-text-primary)]"
                dangerouslySetInnerHTML={{ __html: renderAnswer(message.answer) }}
              />
            ) : (
              <p className="text-[14.5px] text-[var(--lore-text-secondary)]">
                {message.needsModel
                  ? "No local model is installed, so Lore found the right passages but cannot write the answer up. They are below — install a model with Ollama and it will answer properly."
                  : "Lore found the passages below but the local model did not answer in time. Asking again usually works."}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {message.passages.length ? (
                <button
                  type="button"
                  onClick={() => setShowSources((v) => !v)}
                  aria-expanded={showSources}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 py-1 text-[12.5px] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
                >
                  <ChevronRight
                    size={11}
                    className={cn("transition-transform", showSources && "rotate-90")}
                  />
                  <FileText size={11} />
                  {count(message.passages.length, "source")}
                </button>
              ) : null}

              {message.answer ? (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(message.answer ?? "");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                  aria-label="Copy answer"
                  className="rounded-lg p-1.5 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
                >
                  {copied ? (
                    <Check size={13} className="text-[var(--lore-success)]" />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              ) : null}
            </div>

            {showSources ? (
              <div className="mt-3 space-y-2">
                {message.passages.map((p) => (
                  <div
                    key={`${p.pageId}-${p.n}`}
                    id={`src-${message.id}-${p.n}`}
                    className="scroll-mt-6 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenPage(p.pageId)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <span className="t-meta shrink-0 rounded bg-[var(--lore-surface-raised)] px-1.5 py-0.5 tabular-nums text-[var(--lore-text-tertiary)]">
                        {p.n}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                        {p.title}
                        {p.section ? (
                          <span className="text-[var(--lore-text-tertiary)]"> — {p.section}</span>
                        ) : null}
                      </span>
                    </button>
                    {p.text ? (
                      <p className="mt-1.5 line-clamp-4 text-[13px] leading-[1.6] text-[var(--lore-text-secondary)]">
                        {p.text}
                      </p>
                    ) : null}
                  </div>
                ))}

                {message.omitted.length ? (
                  <p className="t-meta pt-1 text-[var(--lore-text-tertiary)]">
                    Also matched but did not fit:{" "}
                    {message.omitted.slice(0, 6).map((o) => o.title).join(", ")}
                    {message.omitted.length > 6
                      ? `, +${message.omitted.length - 6} more`
                      : ""}
                    .
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
