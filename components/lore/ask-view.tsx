"use client";

import { useRef, useState } from "react";
import { ArrowRight, ChevronRight, CornerDownLeft, Loader2, Search } from "lucide-react";
import { cn, count } from "@/lib/utils";

/**
 * Ask the wiki.
 *
 * A 1,500-page corpus cannot be read, so the only way a person gets anything
 * out of it is to ask it something. This is the screen that turns the wiki from
 * an archive into something you use.
 *
 * The answer is never shown alone. Underneath it sits every passage it read and
 * every page it nearly read, because an answer you cannot check is worth less
 * than no answer — and because when it IS wrong, those two lists tell you
 * instantly whether retrieval missed the page or the model misread it. Those
 * are different bugs and they get fixed differently.
 */

type Passage = {
  n: number;
  pageId: string;
  relPath: string;
  title: string;
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
  tokensUsed?: number;
  passages: Passage[];
  omitted: { relPath: string; title: string }[];
  pagesConsidered?: number;
};

export function AskView({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    setError(null);
    setShowSources(false);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "That question could not be answered.");
      setResult(data as Answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-5">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Ask your wiki
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Answered only from your own pages, and every answer shows the passages it came
          from — so you can check it in one click instead of trusting it.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="relative"
      >
        <textarea
          ref={input}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Enter asks; shift-enter is a newline. A question box that needs a
            // mouse to submit gets used once.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          rows={2}
          autoFocus
          /* Never a real name. This shipped with an actual client's name in it,
             on a screen that gets screenshotted and streamed — the example has
             to demonstrate the SHAPE of a good question without quoting anyone's
             data back at a room. */
          placeholder="Ask anything your wiki would know — a rate you quoted, a decision you made, what a client asked for."
          className="lore-scrollbar w-full resize-none rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5 pr-28 text-[15px] leading-[1.6] text-[var(--lore-text-primary)] outline-none transition-colors placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)]"
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-40"
        >
          {asking ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
          Ask
        </button>
      </form>

      {asking ? (
        <p className="t-meta mt-3 flex items-center gap-2 text-[var(--lore-text-tertiary)]">
          <Search size={12} />
          Searching your pages, then reading the best ones…
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-[var(--lore-danger)]/40 px-4 py-3 text-[13.5px] text-[var(--lore-danger)]">
          {error}
        </p>
      ) : null}

      {result && !asking ? (
        <div className="mt-6">
          {result.empty ? (
            <div className="rounded-xl border border-dashed border-[var(--lore-border)] px-5 py-8 text-center">
              <p className="text-[14px] text-[var(--lore-text-secondary)]">{result.reason}</p>
              {/* It used to answer a failure with a writing assignment. Failing
                  to help and then handing out homework is the exact move that
                  killed the last two designs. */}
              <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
                Noted, so you can see later which questions your wiki keeps failing.
              </p>
            </div>
          ) : (
            <>
              {result.answer ? (
                <div className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
                  <p className="whitespace-pre-wrap text-[15px] leading-[1.7] text-[var(--lore-text-primary)]">
                    {result.answer}
                  </p>
                </div>
              ) : (
                /* Never nothing. A null answer with `needsModel` false — the
                   model timed out, or errored — used to render an empty page
                   with a collapsed toggle under it and no explanation. */
                <p className="rounded-xl border border-[var(--lore-border)] px-4 py-3 text-[13.5px] text-[var(--lore-text-secondary)]">
                  {result.needsModel
                    ? "No local model is installed, so Lore found the right passages but cannot write the answer up. They are below — install a model with Ollama and it will answer properly."
                    : "Lore found the passages below but the local model did not answer in time. The sources are still here, and asking again usually works."}
                </p>
              )}

              {/* Sources are the point, not an appendix. Collapsed because most
                  answers are believed, expanded in one click when they are not. */}
              <button
                type="button"
                onClick={() => setShowSources((v) => !v)}
                aria-expanded={showSources}
                className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-primary)]"
              >
                <ChevronRight
                  size={12}
                  className={cn("transition-transform", showSources && "rotate-90")}
                />
                {/* Not "from 1,528 pages" — that is boasting about corpus size
                    to someone whose complaint is that the corpus is too big. */}
                Show sources ({result.passages.length})
              </button>

              {showSources ? (
                <div className="mt-2 space-y-2">
                  {result.passages.map((p) => (
                    <div
                      key={`${p.pageId}-${p.n}`}
                      className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3"
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
                        <ArrowRight size={12} className="shrink-0 text-[var(--lore-text-tertiary)]" />
                      </button>
                      <p className="mt-1.5 line-clamp-4 text-[13px] leading-[1.6] text-[var(--lore-text-secondary)]">
                        {p.text}
                      </p>
                    </div>
                  ))}

                  {result.omitted.length ? (
                    <p className="t-meta pt-1 text-[var(--lore-text-tertiary)]">
                      Also matched but did not fit:{" "}
                      {result.omitted.slice(0, 6).map((o) => o.title).join(", ")}
                      {result.omitted.length > 6 ? `, +${result.omitted.length - 6} more` : ""}.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
