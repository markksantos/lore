"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, RefreshCw, Search, Sparkles, Upload } from "lucide-react";
import {
  bytes,
  Button,
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
 * Ledger's screen.
 *
 * A search box, and then what it found. Everything else on this page is
 * subordinate to that, because the entire feature is "the thing you remember
 * saying is findable again" and any screen that puts configuration before the
 * search box has misunderstood which of those a person came for.
 *
 * Two decisions worth defending. Search is exact-match first and shows the
 * matched words highlighted, because you searched for `createReadStream` and an
 * answer that "captures the essence" of your question is not what you asked
 * for. And a hit opens the whole conversation rather than a summary of it —
 * the value was always in the exact words, and paraphrasing them away is the
 * one thing this tool must not do.
 */

const SOURCE_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  windsurf: "Windsurf",
  "claude-desktop": "Claude desktop",
  import: "Imports",
};

const SOURCE_WHERE: Record<string, string> = {
  "claude-code": "~/.claude/projects",
  codex: "~/.codex/sessions",
  cursor: "Cursor's own database",
  windsurf: "Windsurf's own database",
  "claude-desktop": "Titles for Claude Code sessions",
  import: "Exports you drop in a folder",
};

type Session = {
  id: string;
  source: string;
  title: string | null;
  project: string | null;
  startedAt: number | null;
  endedAt: number | null;
  turns: number;
  words: number;
};

type Hit = {
  turnId: number;
  sessionId: string;
  source: string;
  title: string | null;
  project: string | null;
  role: string;
  at: number | null;
  seq: number;
  snippet: string;
};

type LedgerState = {
  config: { sources: Record<string, boolean>; redact: boolean; maxAgeDays: number };
  status: {
    sessions: number;
    turns: number;
    words: number;
    bySource: { source: string; sessions: number; turns: number; newest: number | null }[];
    projects: { project: string; sessions: number }[];
    diskBytes: number;
    lastIndexedAt: number | null;
    oldest: number | null;
    newest: number | null;
  };
  enabled: boolean;
  running: boolean;
  blockedBecause: string | null;
  importsDir: string;
  pendingImports: string[];
};

export function LedgerView() {
  const [state, setState] = useState<LedgerState | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ hits: Hit[]; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [open, setOpen] = useState<{
    session: Session;
    turns: { seq: number; role: string; text: string }[];
    total: number;
  } | null>(null);
  const [answer, setAnswer] = useState<{ answer: string | null; needsModel: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recent, setRecent] = useState<Session[]>([]);

  const load = useCallback(async () => {
    const [data, sessions] = await Promise.all([
      getJson<LedgerState>("/api/ledger"),
      getJson<{ sessions: Session[] }>("/api/ledger?view=sessions&limit=12"),
    ]);
    if (!data) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setState(data);
    setRecent(sessions?.sessions ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Debounced, because this fires against a full-text index over tens of
     thousands of turns and a keystroke-per-query would queue them. */
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults(null);
      setAnswer(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ view: "search", q: text, limit: "40" });
      if (source) params.set("source", source);
      const data = await getJson<{ hits: Hit[]; total: number }>(`/api/ledger?${params}`);
      setResults(data ?? { hits: [], total: 0 });
      setSearching(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, source]);

  const openSession = async (id: string) => {
    setBusy(`open:${id}`);
    const data = await getJson<{
      session: Session;
      turns: { seq: number; role: string; text: string }[];
      total: number;
    }>(`/api/ledger?view=session&id=${encodeURIComponent(id)}`, 30_000);
    setBusy(null);
    if (data) setOpen(data);
  };

  const reindex = async () => {
    setBusy("reindex");
    setNotice(null);
    const result = await postJson<{ sessions: number; turns: number; ms: number }>(
      "/api/ledger",
      { action: "reindex" },
      600_000,
    );
    setBusy(null);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setNotice(
      result.data.sessions
        ? `Indexed ${result.data.sessions} conversation${result.data.sessions === 1 ? "" : "s"} in ${Math.round(result.data.ms / 1000)}s.`
        : "Already up to date.",
    );
    await load();
  };

  const ask = async () => {
    const text = query.trim();
    if (!text) return;
    setAsking(true);
    const result = await postJson<{ answer: string | null; needsModel: boolean }>(
      "/api/ledger",
      { action: "ask", question: text },
      180_000,
    );
    setAsking(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setAnswer(result.data);
  };

  const sourceCounts = useMemo(
    () => new Map(state?.status.bySource.map((row) => [row.source, row]) ?? []),
    [state],
  );

  if (failed) {
    return (
      <ViewFrame title="Ledger" lede="Every AI conversation you have had on this Mac, in one search box.">
        <Empty>
          Ledger could not be reached.{" "}
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
      <ViewFrame title="Ledger" lede="Every AI conversation you have had on this Mac, in one search box.">
        <div className="flex items-center gap-2 py-10 text-[var(--lore-text-tertiary)]">
          <Loader2 size={15} className="animate-spin" />
          <span className="t-body">Reading the index.</span>
        </div>
      </ViewFrame>
    );
  }

  if (open) {
    return <SessionReader data={open} onBack={() => setOpen(null)} highlight={query.trim()} />;
  }

  const { status, config } = state;

  return (
    <ViewFrame
      title="Ledger"
      lede="Every Claude Code session, Codex run and Cursor chat on this Mac, in one search box."
      right={
        <Button busy={busy === "reindex"} onClick={() => void reindex()}>
          <RefreshCw size={12} />
          Re-index
        </Button>
      }
    >
      <ConsentSwitch
        id="ledger"
        label="Ledger"
        reads="Reads the conversation logs your AI tools already keep on this Mac, and indexes them locally."
        enabled={state.enabled}
        blockedBecause={state.blockedBecause}
        onChange={async (next) => {
          await postJson("/api/observers", { action: "set", observer: "ledger", enabled: next });
          await load();
        }}
      />

      {/* ---------------------------------------------------------- search */}
      <Panel>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--lore-text-tertiary)]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="What was that regex I figured out three weeks ago?"
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] py-2.5 pl-9 pr-3 text-[16px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:text-[14px]"
            />
          </div>
          <Button busy={asking} onClick={() => void ask()} disabled={!query.trim()}>
            <Sparkles size={12} />
            Answer it
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <SourceChip label="Everything" active={!source} onClick={() => setSource(null)} />
          {Object.keys(SOURCE_LABEL)
            .filter((id) => (sourceCounts.get(id)?.sessions ?? 0) > 0)
            .map((id) => (
              <SourceChip
                key={id}
                label={`${SOURCE_LABEL[id]} · ${compact(sourceCounts.get(id)?.sessions ?? 0)}`}
                active={source === id}
                onClick={() => setSource(source === id ? null : id)}
              />
            ))}
        </div>

        {answer ? (
          answer.answer ? (
            <div className="lore-answer mt-4 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--lore-text-primary)]">
              {answer.answer}
            </div>
          ) : answer.needsModel ? (
            <ErrorNote>
              No local model is running, so Ledger can find the conversation but not summarise it.
              The results below are the real thing anyway.
            </ErrorNote>
          ) : null
        ) : null}

        {searching ? (
          <p className="t-meta mt-3 flex items-center gap-1.5 text-[var(--lore-text-tertiary)]">
            <Loader2 size={12} className="animate-spin" />
            Searching {compact(status.turns)} messages.
          </p>
        ) : results ? (
          results.hits.length ? (
            <div className="mt-3">
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                {compact(results.total)} match{results.total === 1 ? "" : "es"}
                {results.total > results.hits.length ? `, showing the best ${results.hits.length}` : ""}.
              </p>
              <div className="mt-2 space-y-1">
                {results.hits.map((hit) => (
                  <button
                    key={hit.turnId}
                    type="button"
                    onClick={() => void openSession(hit.sessionId)}
                    className="block w-full min-w-0 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                        {hit.title ?? "Untitled conversation"}
                      </span>
                      <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                        {SOURCE_LABEL[hit.source] ?? hit.source}
                        {hit.at ? ` · ${relativeTime(hit.at)}` : ""}
                      </span>
                    </span>
                    <Snippet text={hit.snippet} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Empty>
              Nothing matches. Ledger searches the words that were actually typed, so try a phrase
              you remember writing rather than a description of it.
            </Empty>
          )
        ) : null}
      </Panel>

      {!query ? (
        <Panel title="Most recent">
          {recent.length ? (
            <div className="space-y-0.5">
              {recent.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => void openSession(session.id)}
                  className="flex w-full min-w-0 items-baseline gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
                    {session.title ?? "Untitled conversation"}
                  </span>
                  <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                    {session.turns} turns
                    {session.endedAt ? ` · ${relativeTime(session.endedAt)}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty>
              Nothing indexed yet. Switch Ledger on and press Re-index — the first pass over a few
              thousand sessions takes about a minute, and every pass after that takes a second.
            </Empty>
          )}
        </Panel>
      ) : null}

      <div className="mt-4">
        <Stats
          items={[
            { label: "conversations", value: compact(status.sessions) },
            { label: "messages", value: compact(status.turns) },
            { label: "words", value: compact(status.words) },
            { label: "index size", value: bytes(status.diskBytes) },
          ]}
        />
      </div>

      <Panel
        title="Where it looks"
        hint={
          status.lastIndexedAt
            ? `Last indexed ${relativeTime(status.lastIndexedAt)}.`
            : "Nothing has been indexed yet."
        }
      >
        <div className="space-y-1.5">
          {Object.keys(SOURCE_LABEL).map((id) => {
            const row = sourceCounts.get(id);
            return (
              <label
                key={id}
                className="flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--lore-surface-raised)]"
              >
                <input
                  type="checkbox"
                  checked={config.sources[id] !== false}
                  onChange={async (event) => {
                    await putJson("/api/ledger", { sources: { [id]: event.target.checked } });
                    await load();
                  }}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--lore-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--lore-text-primary)]">
                    {SOURCE_LABEL[id]}
                    {row?.sessions ? (
                      <span className="t-meta ml-2 font-normal text-[var(--lore-text-tertiary)]">
                        {compact(row.sessions)} conversation{row.sessions === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </span>
                  <span className="t-meta block truncate text-[var(--lore-text-tertiary)]">
                    {SOURCE_WHERE[id]}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-[var(--lore-border)] p-3">
          <p className="text-[13px] font-medium text-[var(--lore-text-primary)]">
            Claude.ai and ChatGPT
          </p>
          <p className="t-body mt-1 text-[var(--lore-text-secondary)]">
            Those conversations live on a server, so nothing on this Mac can read them. Export them
            and drop the file here — both formats are understood.
          </p>
          <ImportDrop
            dir={state.importsDir}
            pending={state.pendingImports}
            onDone={() => void load()}
          />
        </div>

        {notice ? <p className="t-meta mt-3 text-[var(--lore-text-secondary)]">{notice}</p> : null}
      </Panel>

      <Panel title="Forget" hint="Deletes Lore's index. Your actual transcripts are never touched.">
        <DangerButton
          label="Delete the index"
          confirmLabel="Really delete the index?"
          onConfirm={async () => {
            await postJson("/api/ledger", { action: "forget" });
            await load();
          }}
        />
      </Panel>
    </ViewFrame>
  );
}

function SourceChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "border-[var(--lore-accent)] bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
          : "border-[var(--lore-border)] text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
      )}
    >
      {label}
    </button>
  );
}

/**
 * FTS5's snippet output, with its markers turned into emphasis.
 *
 * The guillemets come from the query in lib/ledger.ts. Rendering them as
 * literal characters would be readable but would waste the one piece of
 * information the snippet carries: which words actually matched.
 */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span className="mt-0.5 block line-clamp-2 text-[12px] leading-snug text-[var(--lore-text-tertiary)]">
      {parts.map((part, i) =>
        part.startsWith("«") && part.endsWith("»") ? (
          <mark
            key={i}
            className="rounded bg-[var(--lore-accent-tint)] px-0.5 text-[var(--lore-text-primary)]"
          >
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

function ImportDrop({
  dir,
  pending,
  onDone,
}: {
  dir: string;
  pending: string[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          * Visually hidden, not `display: none`.
          *
          * Tailwind's `hidden` removes the input from the accessibility tree
          * AND from the focus order, so the only control for this feature could
          * not be reached by keyboard at all — the label was clickable and
          * nothing else. `sr-only` keeps it focusable and the peer selector puts
          * a visible ring on the label when it has focus, so a keyboard user can
          * see where they are.
          */}
        <label className="peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--lore-accent)] inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Choose an export
          <input
            type="file"
            accept=".json,.md,.txt"
            className="peer sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              /* Cleared immediately so choosing the same file twice re-fires
                 the change event — otherwise a failed import cannot be retried
                 without picking a different file. */
              event.target.value = "";
              if (!file) return;
              /*
               * Checked before reading, not after.
               *
               * `file.text()` on a multi-hundred-megabyte export materialises
               * the whole thing as a JavaScript string and then
               * `JSON.stringify` makes a second copy of it for the request
               * body. The server refuses anything over 200 MB anyway; refusing
               * it here means the tab does not freeze on the way to finding
               * that out.
               */
              if (file.size > 150 * 1024 * 1024) {
                setError(
                  `That export is ${Math.round(file.size / 1_048_576)} MB, which is too large to send through the browser. Copy it into the imports folder instead.`,
                );
                return;
              }
              setBusy(true);
              setError(null);
              const content = await file.text();
              const result = await postJson("/api/ledger", {
                action: "import",
                name: file.name,
                content,
              }, 600_000);
              setBusy(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              onDone();
            }}
          />
        </label>
        <span className="t-meta min-w-0 truncate text-[var(--lore-text-tertiary)]" title={dir}>
          or copy files into {dir}
        </span>
      </div>
      {pending.length ? (
        <p className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]">
          {pending.length} file{pending.length === 1 ? "" : "s"} in that folder:{" "}
          {pending.slice(0, 4).join(", ")}
          {pending.length > 4 ? "…" : ""}
        </p>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

/** One conversation, whole. */
function SessionReader({
  data,
  onBack,
  highlight,
}: {
  data: { session: Session; turns: { seq: number; role: string; text: string }[]; total: number };
  onBack: () => void;
  highlight: string;
}) {
  const { session, turns, total } = data;
  const needles = useMemo(
    () =>
      highlight
        .toLowerCase()
        .split(/[^\p{L}\p{N}_]+/u)
        .filter((token) => token.length > 2),
    [highlight],
  );

  return (
    <ViewFrame
      title={session.title ?? "Untitled conversation"}
      lede={[
        SOURCE_LABEL[session.source] ?? session.source,
        session.project,
        session.endedAt ? dayAndTime(session.endedAt) : null,
        `${session.turns} turns · ${compact(session.words)} words`,
      ]
        .filter(Boolean)
        .join(" · ")}
      right={
        <Button onClick={onBack}>
          <ArrowLeft size={12} />
          Back
        </Button>
      }
    >
      {total > turns.length ? (
        <p className="t-meta mb-3 rounded-lg border border-[var(--lore-border)] px-3 py-2 text-[var(--lore-text-tertiary)]">
          Showing the first {turns.length} of {total} messages. The longest session on this machine
          runs to 791, and rendering all of them at once is what makes a tab stop responding.
        </p>
      ) : null}
      <div className="space-y-3">
        {turns.map((turn) => (
          <article
            key={turn.seq}
            className={cn(
              "min-w-0 rounded-xl border p-3",
              turn.role === "user"
                ? "border-[var(--lore-border)] bg-[var(--lore-surface-raised)]"
                : "border-[var(--lore-border)] bg-[var(--lore-surface)]",
            )}
          >
            <p className="t-meta mb-1 flex items-center gap-1.5 text-[var(--lore-text-tertiary)]">
              <MessageSquare size={11} />
              {turn.role === "user" ? "You" : "Assistant"}
            </p>
            <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-[var(--lore-text-primary)]">
              <Highlighted text={turn.text} needles={needles} />
            </pre>
          </article>
        ))}
      </div>
    </ViewFrame>
  );
}

/**
 * Highlight the searched words inside a full transcript.
 *
 * The needles are escaped before they become a pattern. They come from a search
 * box, so a query containing `(` would otherwise throw a SyntaxError and blank
 * the entire conversation the user was trying to read.
 */
function Highlighted({ text, needles }: { text: string; needles: string[] }) {
  if (!needles.length) return <>{text}</>;
  const escaped = needles.map((needle) => needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let pattern: RegExp;
  try {
    pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  } catch {
    return <>{text}</>;
  }
  return (
    <>
      {text.split(pattern).map((part, i) =>
        needles.includes(part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-[var(--lore-accent-tint)] px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
