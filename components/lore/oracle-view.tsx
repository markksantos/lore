"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import {
  bytes,
  Button,
  CapabilityNotice,
  compact,
  ConsentSwitch,
  DangerButton,
  dayAndTime,
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
import { cn } from "@/lib/utils";

/**
 * Oracle's screen.
 *
 * The hard part of this UI is not the search box, it is the seven switches
 * underneath it — because each one asks for something different and five of
 * them need a macOS permission the user has probably not granted. A list of
 * toggles that silently do nothing is the worst possible version of this
 * feature, so every source states three things at all times: whether it is on,
 * whether it CAN work on this Mac, and how much it has read so far.
 *
 * "Complete" is a real state here rather than a spinner. Each pass is bounded,
 * so a source that returned less than a full batch has caught up and says so —
 * which is the difference between "still indexing" and "indexing forever".
 */

type Capability = { state: string; detail: string; settingsPane?: string };

type SourceStatus = {
  source: string;
  label: string;
  where: string;
  needsFullDisk: boolean;
  enabled: boolean;
  available: boolean;
  reason: string;
  items: number;
  newest: number | null;
  complete: boolean;
  lastAt: number | null;
  error: string | null;
};

type OracleState = {
  config: { sources: Record<string, boolean>; roots: string[]; batch: number; maxFileMb: number; redact: boolean };
  status: { items: number; diskBytes: number; sources: SourceStatus[]; oldest: number | null; newest: number | null };
  fullDiskAccess: Capability;
  localModel: Capability & { model: string | null };
  enabled: boolean;
  running: boolean;
  blockedBecause: string | null;
};

type Hit = {
  id: number;
  source: string;
  title: string | null;
  who: string | null;
  at: number | null;
  uri: string | null;
  snippet: string;
};

export function OracleView() {
  const [state, setState] = useState<OracleState | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ hits: Hit[]; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string | null; needsModel: boolean; hits: Hit[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [item, setItem] = useState<{ title: string | null; body: string; who: string | null; at: number | null; uri: string | null } | null>(null);

  const load = useCallback(async () => {
    const data = await getJson<OracleState>("/api/oracle", 30_000);
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

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults(null);
      setAnswer(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const data = await getJson<{ hits: Hit[]; total: number }>(
        `/api/oracle?view=search&q=${encodeURIComponent(text)}&limit=40`,
      );
      setResults(data ?? { hits: [], total: 0 });
      setSearching(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const act = async (action: string, extra?: Record<string, unknown>, timeout = 600_000) => {
    setBusy(action);
    setNotice(null);
    const result = await postJson<Record<string, unknown>>("/api/oracle", { action, ...extra }, timeout);
    setBusy(null);
    if (!result.ok) {
      setNotice(result.error);
      return null;
    }
    await load();
    return result.data;
  };

  const ask = async () => {
    const text = query.trim();
    if (!text) return;
    setAsking(true);
    const result = await postJson<{ answer: string | null; needsModel: boolean; hits: Hit[] }>(
      "/api/oracle",
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

  if (failed) {
    return (
      <ViewFrame title="Oracle" lede="One search bar over everything on this machine.">
        <Empty>
          Oracle could not be reached.{" "}
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
      <ViewFrame title="Oracle" lede="One search bar over everything on this machine.">
        <div className="flex items-center gap-2 py-10 text-[var(--lore-text-tertiary)]">
          <Loader2 size={15} className="animate-spin" />
          <span className="t-body">Checking what this Mac will let Lore read.</span>
        </div>
      </ViewFrame>
    );
  }

  const { status, config } = state;
  const anyOn = status.sources.some((source) => source.enabled);

  return (
    <ViewFrame
      title="Oracle"
      lede="Your files, mail, messages, calendar, notes, browsing and photos — indexed on this machine, searched in one place."
      right={
        <Button busy={busy === "reindex"} onClick={() => void act("reindex")} disabled={!anyOn}>
          <RefreshCw size={12} />
          Index now
        </Button>
      }
    >
      <ConsentSwitch
        id="oracle"
        label="Oracle"
        reads="Indexes the sources you tick below. Each one is a separate decision, and nothing is ticked to begin with."
        enabled={state.enabled}
        blockedBecause={state.blockedBecause}
        onChange={async (next) => {
          await postJson("/api/observers", { action: "set", observer: "oracle", enabled: next });
          await load();
        }}
      />

      <CapabilityNotice
        capability={state.fullDiskAccess}
        what="Mail, Messages, Notes and Safari:"
        onRecheck={async () => {
          await postJson("/api/observers", { action: "recheck" });
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
              aria-label="Search your files, mail, messages and calendar"
              placeholder="When did I first talk to someone about that project?"
              className="w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] py-2.5 pl-9 pr-3 text-[16px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)] md:text-[14px]"
            />
          </div>
          <Button busy={asking} onClick={() => void ask()} disabled={!query.trim()}>
            <Sparkles size={12} />
            Answer it
          </Button>
        </div>

        {answer?.answer ? (
          <div className="lore-answer mt-4 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--lore-text-primary)]">
            {answer.answer}
          </div>
        ) : answer?.needsModel ? (
          <ErrorNote>
            No local model is running, so Oracle can find things but not answer in sentences. The
            results below are what it found.
          </ErrorNote>
        ) : null}

        {searching ? (
          <p className="t-meta mt-3 flex items-center gap-1.5 text-[var(--lore-text-tertiary)]">
            <Loader2 size={12} className="animate-spin" />
            Searching {compact(status.items)} items.
          </p>
        ) : results ? (
          results.hits.length ? (
            <div className="mt-3">
              <p className="t-meta text-[var(--lore-text-tertiary)]">
                {compact(results.total)} match{results.total === 1 ? "" : "es"}.
              </p>
              <div className="mt-2 space-y-0.5">
                {results.hits.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={async () => {
                      const data = await getJson<{ item: typeof item }>(`/api/oracle?view=item&id=${hit.id}`);
                      if (data?.item) setItem(data.item);
                    }}
                    className="block w-full min-w-0 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--lore-accent)]" style={{ background: "var(--lore-accent-tint)" }}>
                        {hit.source}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                        {hit.title ?? "Untitled"}
                      </span>
                      <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                        {hit.at ? dayAndTime(hit.at) : "no date"}
                      </span>
                    </span>
                    {hit.who ? (
                      <span className="t-meta block truncate text-[var(--lore-text-tertiary)]">{hit.who}</span>
                    ) : null}
                    <Snippet text={hit.snippet} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Empty>
              {status.items
                ? "Nothing matches that in what has been indexed so far."
                : "Nothing is indexed yet. Tick a source below and press Index now."}
            </Empty>
          )
        ) : null}
      </Panel>

      {item ? (
        <Panel
          title={item.title ?? "Item"}
          hint={[item.who, item.at ? dayAndTime(item.at) : null].filter(Boolean).join(" · ")}
          right={
            <Button onClick={() => setItem(null)}>
              <X size={12} />
              Close
            </Button>
          }
        >
          <pre className="lore-scrollbar max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--lore-text-secondary)]">
            {item.body}
          </pre>
          {item.uri?.startsWith("/") ? (
            <p className="t-meta mt-2 break-all text-[var(--lore-text-tertiary)]">{item.uri}</p>
          ) : item.uri ? (
            <a
              href={item.uri}
              target="_blank"
              rel="noreferrer noopener"
              className="t-meta mt-2 block break-all text-[var(--lore-accent)] underline"
            >
              {item.uri}
            </a>
          ) : null}
        </Panel>
      ) : null}

      <div className="mt-4">
        <Stats
          items={[
            { label: "items indexed", value: compact(status.items) },
            { label: "sources on", value: String(status.sources.filter((s) => s.enabled).length) },
            { label: "index size", value: bytes(status.diskBytes) },
            {
              label: "oldest item",
              value: status.oldest ? new Date(status.oldest).getFullYear().toString() : "—",
            },
          ]}
        />
      </div>

      {/* --------------------------------------------------------- sources */}
      <Panel title="What Oracle may read" hint="Each source is its own decision.">
        <div className="space-y-2">
          {status.sources.map((source) => (
            <div
              key={source.source}
              className="min-w-0 rounded-lg border border-[var(--lore-border)] px-3 py-2.5"
            >
              <div className="flex flex-wrap items-start gap-2">
                <input
                  type="checkbox"
                  id={`oracle-${source.source}`}
                  checked={source.enabled}
                  disabled={!source.available}
                  onChange={async (event) => {
                    await putJson("/api/oracle", { sources: { [source.source]: event.target.checked } });
                    await load();
                  }}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--lore-accent)] disabled:opacity-40"
                />
                <label htmlFor={`oracle-${source.source}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                      {source.label}
                    </span>
                    {source.items ? (
                      <span className="t-meta text-[var(--lore-text-tertiary)]">
                        {compact(source.items)} item{source.items === 1 ? "" : "s"}
                        {source.enabled ? (source.complete ? " · up to date" : " · still reading") : ""}
                      </span>
                    ) : null}
                  </span>
                  <span className="t-meta block truncate text-[var(--lore-text-tertiary)]">
                    {source.where}
                  </span>
                  {!source.available ? (
                    <span className="t-meta mt-1 block text-[var(--lore-text-secondary)]">
                      {source.reason}
                    </span>
                  ) : null}
                  {source.error ? (
                    <span className="t-meta mt-1 block text-[var(--lore-danger)]">{source.error}</span>
                  ) : null}
                </label>
                {source.items ? (
                  <DangerButton
                    label="Reset"
                    confirmLabel="Really re-read from scratch?"
                    onConfirm={() => act("reset", { source: source.source })}
                  />
                ) : null}
              </div>

              {source.source === "files" && source.enabled ? (
                <div className="mt-2.5 border-t border-[var(--lore-border)] pt-2.5">
                  {config.roots.length ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {config.roots.map((root) => (
                        <span
                          key={root}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--lore-border)] px-2 py-1 text-[12px] text-[var(--lore-text-secondary)]"
                        >
                          <span className="truncate" title={root} style={{ fontFamily: "var(--font-mono), monospace" }}>
                            {root.replace(/^\/Users\/[^/]+/, "~")}
                          </span>
                          <button
                            type="button"
                            aria-label={`Stop indexing ${root}`}
                            onClick={() => void act("remove-root", { path: root }, 20_000)}
                            className="shrink-0 text-[var(--lore-text-tertiary)] hover:text-[var(--lore-danger)]"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="t-meta mb-2 text-[var(--lore-text-tertiary)]">
                      No folders chosen yet, so this source reads nothing.
                    </p>
                  )}
                  <PathInput
                    placeholder="~/Documents"
                    busy={busy === "add-root"}
                    onAdd={async (path) => {
                      await act("add-root", { path }, 20_000);
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {notice ? <ErrorNote>{notice}</ErrorNote> : null}
      </Panel>

      <Panel title="Forget" hint="Deletes Lore's index. Nothing it read is modified or removed.">
        <DangerButton
          label="Delete everything Oracle has indexed"
          confirmLabel="Really delete the whole index?"
          onConfirm={() => act("forget", undefined, 60_000)}
        />
      </Panel>
    </ViewFrame>
  );
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span className={cn("mt-0.5 block line-clamp-2 text-[12px] leading-snug text-[var(--lore-text-tertiary)]")}>
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
