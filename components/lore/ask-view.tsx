"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookmarkPlus,
  Check,
  Download,
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
  modelFailed?: boolean;
  confidence?: number;
  verdict?: string;
  passages: Passage[];
  omitted: { relPath: string; title: string }[];
  disagreements?: { subject: string; values: number[]; pages: string[] }[];
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
  modelFailed?: boolean;
  pending?: boolean;
  /** True while tokens are still arriving, so the caret can blink. */
  streaming?: boolean;
  confidence?: number;
  verdict?: string;
  disagreements?: { subject: string; values: number[]; pages: string[] }[];
};

export function AskView({
  onOpenPage,
  handoff,
}: {
  onOpenPage: (pageId: string) => void;
  /** A question sent here from the palette. `key` changes even if the text does not. */
  handoff?: { question: string; key: number } | null;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);

  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  /*
   * The thread, readable without being a dependency.
   *
   * `ask` needs the earlier turns to send as conversation context, and putting
   * `messages` in its dependency list would rebuild the callback on every
   * streamed token — thousands of times per answer.
   */
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  /*
   * A question handed over from the palette.
   *
   * Keyed on `handoff.key` rather than the text, so asking the same thing twice
   * from the palette asks twice — comparing the string would silently swallow
   * the second one.
   */
  const lastHandoff = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.key === lastHandoff.current) return;
    lastHandoff.current = handoff.key;
    ask(handoff.question);
    // `ask` is stable across renders except when a request is in flight, and
    // re-running this on that change would re-ask the same question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

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
        /*
         * Ask the stream first.
         *
         * The server falls back to a whole-answer JSON response when no local
         * model is resident, and the two are told apart by the content type
         * rather than by asking twice — a second round trip to discover which
         * shape is coming would cost more than the streaming saves.
         */
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: trimmed,
            stream: true,
            // Only the turns already answered; the pending one is this question.
            thread: messagesRef.current
              .filter((msg) => !msg.pending)
              .slice(-4)
              .map((msg) => ({ question: msg.question, answer: msg.answer })),
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
            busy?: boolean;
          };
          // Busy is not broken: the machine runs one local model at a time,
          // and the honest move is to say so and invite a retry in seconds.
          throw new Error(
            data.busy
              ? "Lore is answering another question right now — local models run one at a time. Try again in a few seconds."
              : (data.error ?? "That question could not be answered."),
          );
        }

        if (response.headers.get("content-type")?.includes("text/event-stream")) {
          await consumeStream(response, id, setMessages);
        } else {
          const data = (await response.json()) as Answer & { error?: string };
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
                    modelFailed: data.modelFailed,
                    disagreements: data.disagreements,
                  }
                : msg,
            ),
          );
        }
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

  /**
   * The thread as a markdown file.
   *
   * A conversation that answered something properly is a document, and until
   * now the only way out of this screen was copying one answer at a time. The
   * export keeps the questions, the answers and the sources together, which is
   * what makes it worth pasting into a page, an email or an issue.
   */
  function exportThread() {
    const lines: string[] = [`# Asked ${new Date().toISOString().slice(0, 10)}`, ""];
    for (const msg of messages) {
      lines.push(`## ${msg.question}`, "", msg.answer ?? "_No answer._", "");
      if (msg.passages.length) {
        lines.push(
          `Sources: ${msg.passages.map((p) => `\`${p.relPath}\``).join(", ")}`,
          "",
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lore-thread-${Date.now().toString(36)}.md`;
    link.click();
    // Revoked on the next frame: revoking synchronously races the download in
    // Safari and produces an empty file.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
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

        {messages.length ? (
          <button
            type="button"
            onClick={exportThread}
            className="mx-3 mb-2 inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[12.5px] text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            <Download size={12} />
            Export this thread
          </button>
        ) : null}

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
  const [saved, setSaved] = useState(false);

  /**
   * Write this answer into the wiki as a page.
   *
   * Filed under `answers/` with the date, so a day of questions collects on one
   * page rather than scattering. Every source is listed as a real wikilink,
   * which matters twice over: it is how the claim stays checkable, and it is
   * what stops the page being born an orphan — the failure that 56% of this
   * wiki already has.
   */
  const onSave = async (msg: Message) => {
    const day = new Date().toISOString().slice(0, 10);
    const body = [
      `## ${msg.question}`,
      "",
      msg.answer ?? "",
      "",
      msg.passages.length
        ? `Sources: ${msg.passages.slice(0, 8).map((p) => `[[${p.pageId}]]`).join(", ")}`
        : "",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n");

    const response = await fetch("/api/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: `answers/${day}.md`,
        content: body,
        mode: "append",
        agent: "You (Ask)",
      }),
    }).catch(() => null);
    if (response?.ok) setSaved(true);
  };
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
              <>
                <div
                  ref={body}
                  className={cn(
                    "lore-answer text-[15px] leading-[1.7] text-[var(--lore-text-primary)]",
                    // A caret while tokens arrive. Six seconds of a spinner
                    // reads as broken; six seconds of text reads as thinking.
                    message.streaming && "after:ml-0.5 after:animate-pulse after:content-['▍']",
                  )}
                  dangerouslySetInnerHTML={{ __html: renderAnswer(message.answer) }}
                />
                {/*
                  * Said plainly, not hedged into the prose.
                  *
                  * When retrieval is unsure the model still writes a fluent
                  * paragraph, and a fluent paragraph is indistinguishable from
                  * a certain one. The warning has to sit outside the answer.
                  */}
                {/*
                  * Sources that disagree, said out loud.
                  *
                  * Averaging two conflicting pages into one fluent paragraph is
                  * the most damaging thing this screen can do, because the
                  * result is indistinguishable from a correct answer. If the
                  * pages Lore just read hold different numbers for one thing,
                  * that belongs above the fold, not buried in the sources.
                  */}
                {!message.streaming && message.disagreements?.length ? (
                  <div className="mt-2.5 rounded-lg border border-[var(--lore-danger)] px-3 py-2">
                    {message.disagreements.map((d) => (
                      <p
                        key={d.subject}
                        className="t-meta text-[var(--lore-text-secondary)]"
                      >
                        Your sources disagree about{" "}
                        <span className="text-[var(--lore-text-primary)]">{d.subject}</span>:{" "}
                        {d.values.join(" vs ")} — {d.pages.slice(0, 3).join(", ")}
                      </p>
                    ))}
                  </div>
                ) : null}

                {!message.streaming &&
                message.confidence !== undefined &&
                message.confidence < 0.35 ? (
                  <p className="t-meta mt-2 rounded-lg border border-dashed border-[var(--lore-border)] px-3 py-2 text-[var(--lore-text-tertiary)]">
                    Retrieval was not confident about this one — the passages below are the
                    closest matches, not necessarily the answer. Worth opening the sources.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[14.5px] text-[var(--lore-text-secondary)]">
                {message.needsModel
                  ? "No local model is installed, so Lore found the right passages but cannot write the answer up. They are below — install a model with Ollama and it will answer properly."
                  : "The local model was too busy to answer in time. The passages Lore found are below — ask again in a moment and it will write them up."}
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

              {/*
                * Save the answer back into the wiki.
                *
                * A synthesis across nine pages is usually the most valuable
                * thing produced in a session, and until now it evaporated when
                * the tab closed — the wiki got no better for having been asked
                * a good question. Written with its citations intact, so the
                * next reader can check it the same way you just did.
                */}
              {message.answer && !message.streaming ? (
                <button
                  type="button"
                  onClick={() => onSave(message)}
                  disabled={saved}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 py-1 text-[12.5px] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-50"
                >
                  <BookmarkPlus size={11} />
                  {saved ? "Saved to the wiki" : "Save as a page"}
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

/**
 * Read a server-sent answer into the message it belongs to.
 *
 * Frames arrive as `event:`/`data:` pairs separated by a blank line, and a
 * network chunk can split one in half — so the tail is always held back until
 * the next read completes it. Getting this wrong shows up as JSON parse errors
 * on perfectly good answers, roughly one time in twenty.
 */
async function consumeStream(
  response: Response,
  id: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  const patch = (fields: Partial<Message>) =>
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, ...fields } : msg)));

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const eventLine = frame.split("\n").find((l) => l.startsWith("event: "));
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!eventLine || !dataLine) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(dataLine.slice(6));
      } catch {
        continue; // One dropped frame, not a dropped answer.
      }

      switch (eventLine.slice(7)) {
        case "meta": {
          const meta = payload as Answer & { confidence?: number; verdict?: string };
          patch({
            pending: false,
            streaming: true,
            passages: meta.passages ?? [],
            omitted: meta.omitted ?? [],
            confidence: meta.confidence,
            verdict: meta.verdict,
            disagreements: meta.disagreements,
          });
          break;
        }
        case "token":
          answer += String(payload);
          patch({ answer });
          break;
        case "verdict": {
          // The server re-judged its own confidence after reading what the
          // model wrote; the warning banner must follow the correction.
          const v = payload as { confidence: number; verdict: string };
          patch({ confidence: v.confidence, verdict: v.verdict });
          break;
        }
        case "error":
          patch({ streaming: false, reason: String(payload) });
          break;
        case "done":
          patch({ streaming: false, answer: answer.trim() || null });
          break;
      }
    }
  }
  patch({ streaming: false });
}
