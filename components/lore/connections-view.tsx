"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FileDown,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import { paletteVars } from "@/lib/palette";
import { APP_PORT } from "@/lib/brand";

type Row = {
  name: string;
  configPath: string;
  installed: boolean;
  detail: string;
} & ({ action: "install-hook" } | { action: "install-mcp"; target: string });

type Probe = { harnesses: Row[]; snippets: { mcp: string; hook: string } };

type Outcome = { ok: boolean; message: string };

/** Config paths are shown, not opened, and `/Users/name` is noise in all of them. */
const tilde = (file: string) => file.replace(/^\/Users\/[^/]+/, "~");

/**
 * Connections — where an anonymous change log gains a name.
 *
 * Lore already sees every write, because it watches the folder rather than the
 * tool. That is what makes it harness-agnostic and also what makes it blind:
 * the filesystem knows a page lost forty lines at 14:02 and cannot say who did
 * it. A Claude Code PostToolUse hook can.
 *
 * The whole screen is built around one uncomfortable fact: connecting means
 * letting this app edit a config file the user wrote for themselves. So the
 * rules it follows are stated up front, in full, before the button — not in a
 * tooltip and not after the fact.
 */
export function ConnectionsView({ root, installDir }: { root: string; installDir: string }) {
  const [probe, setProbe] = useState<Probe | null>(null);
  /** A failed probe must not read as a slow one — see the note on `load`. */
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const load = useCallback(async () => {
    setFailed(false);
    setProbe(null);
    // Reading four config files off the local disk. It is fast or it is broken;
    // there is no honest middle, so there is no progress bar to show — but a
    // failure has to say so rather than leave "Checking config files…" spinning
    // for the rest of the session, which is what it did.
    const response = await fetch("/api/harness").catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    setProbe(await response.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect(row: Row) {
    setBusy(row.name);
    const body =
      row.action === "install-mcp"
        ? { action: row.action, target: row.target }
        : { action: row.action };

    const response = await fetch("/api/harness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);

    setOutcomes((prev) => ({
      ...prev,
      [row.name]: response.ok
        ? { ok: result?.ok !== false, message: result?.message ?? "Done." }
        : { ok: false, message: result?.error ?? "The installer could not run." },
    }));
    setBusy(null);
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Connections
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Lore watches the vault folder, so every tool is already covered and none of them
          had to opt in. What a folder can never tell you is <em>who</em> made a change.
          The Claude Code hook records that name to a log on disk — and connecting over MCP
          hands your agents the wiki.
        </p>
      </header>

      <Consent />

      <AutoWiki />

      <AccessTokens />

      <ObsidianPlugin />

      <section className="mt-7">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          On this machine
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          Read from disk, not guessed. A row says connected only when Lore&apos;s own entry
          is physically in that file.
        </p>

        <div className="mt-3.5 space-y-2.5">
          {failed ? (
            <div className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-4">
              <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                <AlertTriangle size={13} className="text-[#b45309] dark:text-[#fbbf24]" />
                Could not read your config files
              </p>
              <p className="t-meta mt-1.5 text-[var(--lore-text-secondary)]">
                Lore asks this machine which agent configs exist. If the app is still
                starting up, try again in a moment.
              </p>
              <button
                type="button"
                onClick={load}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
              >
                <RefreshCw size={12} />
                Try again
              </button>
            </div>
          ) : probe === null ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-6 text-[13px] text-[var(--lore-text-tertiary)]">
              <Loader2 size={14} className="animate-spin" />
              Reading four config files on this machine…
            </div>
          ) : (
            probe.harnesses.map((row, i) => (
              <HarnessRow
                key={row.name}
                row={row}
                index={i}
                busy={busy === row.name}
                outcome={outcomes[row.name]}
                onConnect={() => connect(row)}
              />
            ))
          )}
        </div>
      </section>

      <Attribution />

      <AgentsFile root={root} />

      <section className="mt-10">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          Rather do it yourself
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          Exactly what the buttons above would write, generated from the same code — so
          pasting it by hand gets you the identical wiring.
        </p>

        <div className="mt-3.5 space-y-4">
          <CopyBlock
            // Deliberately not a list of filenames. Each tool's real config path
            // is already on its row above, read from disk — naming them a second
            // time here is how the label ends up pointing at a file Lore never
            // writes, which is exactly what it used to do.
            label="mcpServers — into the config path shown on that tool's row above"
            content={
              probe?.snippets.mcp ??
              JSON.stringify(
                {
                  mcpServers: {
                    lore: {
                      command: "node",
                      args: [`${installDir}/mcp/server.mjs`],
                      env: { LORE_URL: `http://127.0.0.1:${APP_PORT}` },
                    },
                  },
                },
                null,
                2,
              )
            }
          />
          {probe ? <CopyBlock label="hooks — ~/.claude/settings.json" content={probe.snippets.hook} /> : null}
        </div>
      </section>
    </div>
  );
}

/**
 * The disclosure. A user is being asked to let an app edit a file that may hold
 * a great deal they care about, so they get the whole procedure before the
 * button rather than a reassuring adjective after it.
 */
function Consent() {
  const steps = [
    "Reads the file and parses it. If it is not valid JSON, Lore stops and tells you — it will never write over a file it could not read.",
    "Copies it to the same name with .lore-backup on the end, whenever there is an existing file to copy. If the file does not exist yet, Lore creates it and there is nothing to back up.",
    "Adds one key: a PostToolUse hook, or `lore` under mcpServers. Every other setting is written back exactly as it was.",
    "Skips silently if an equivalent entry is already there, so pressing Connect twice cannot duplicate anything.",
  ];

  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <h2 className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
        What Connect does to your config
      </h2>
      <ol className="mt-2.5 space-y-1.5">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-2.5" style={paletteVars(i)}>
            <span className="mt-[0.55rem] pal-dot" />
            <span className="t-meta min-w-0 text-[var(--lore-text-secondary)]">{step}</span>
          </li>
        ))}
      </ol>
      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        Nothing leaves this machine. The hook posts to 127.0.0.1:{APP_PORT}, and if Lore
        is not running the request times out in two seconds and your agent carries on.
      </p>
    </section>
  );
}

function HarnessRow({
  row,
  index,
  busy,
  outcome,
  onConnect,
}: {
  row: Row;
  index: number;
  busy: boolean;
  outcome: Outcome | undefined;
  onConnect: () => void;
}) {
  const unparsable = row.detail.includes("not valid JSON");

  return (
    <article
      style={paletteVars(index)}
      className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="pal-dot" />
        <h3 className="min-w-0 text-[15px] font-semibold text-[var(--lore-text-primary)]">
          {row.name}
        </h3>
        {row.installed ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--lore-success)]/40 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--lore-success)]">
            <ShieldCheck size={10} />
            Connected
          </span>
        ) : null}
        <span className="flex-1" />
        {row.installed ? null : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busy || unparsable}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
            Connect
          </button>
        )}
      </div>

      <p className="t-meta mt-1.5 text-[var(--lore-text-secondary)]">{row.detail}</p>
      <code className="mt-1 block truncate text-[12px] text-[var(--lore-text-tertiary)]">
        {tilde(row.configPath)}
      </code>

      {outcome ? (
        <p
          className={cn(
            "t-meta mt-2 flex gap-1.5",
            outcome.ok ? "text-[var(--lore-text-secondary)]" : "text-[var(--lore-danger)]",
          )}
        >
          {outcome.ok ? (
            <Check size={13} className="mt-1 shrink-0 text-[var(--lore-success)]" />
          ) : (
            <AlertTriangle size={13} className="mt-1 shrink-0" />
          )}
          <span className="min-w-0">{outcome.message}</span>
        </p>
      ) : null}
    </article>
  );
}

/** What the hook actually buys, said plainly — including what it does not do. */
function Attribution() {
  return (
    <section className="mt-7 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-5 py-4">
      <h2 className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
        What the hook records
      </h2>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        After every Write, Edit and MultiEdit, Claude Code pipes the tool call to Lore.
        Lore keeps four fields — time, file, agent, tool — and only for files inside this
        vault. Writes anywhere else on your disk are dropped, not logged. It lands in{" "}
        <code className="text-[13px]">~/.lore/attribution.jsonl</code>, outside your wiki,
        so it never turns up in a diff of your notes.
      </p>
      <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
        Attribution is a record, not a gate: nothing is blocked and nothing is approved. A
        change with a name on it still counts as unverified until you sign off on it in
        Review. Review does not display these names yet — for now the hook fills the log and
        the file is the way to read it.
      </p>
    </section>
  );
}

function AgentsFile({ root }: { root: string }) {
  const [state, setState] = useState<"idle" | "writing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function write() {
    setState("writing");
    setError(null);
    const response = await fetch("/api/agent", { method: "POST" });
    if (!response.ok) {
      setError((await response.json().catch(() => null))?.error ?? "Could not write the file.");
      setState("idle");
      return;
    }
    setState("done");
  }

  return (
    <section className="mt-10">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        For agents that only read files
      </h2>
      <p className="t-body mt-1 text-[var(--lore-text-secondary)]">
        Writes a map of every page — path, folder, tags, one-line summary — into AGENTS.md
        at the root of your wiki, so any tool that reads files finds it without being told
        to. The generated map sits inside a fenced block; anything you wrote around it is
        preserved. Re-run it whenever the wiki has moved on.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={write}
          disabled={state === "writing"}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
        >
          {state === "writing" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : state === "done" ? (
            <Check size={14} />
          ) : (
            <FileDown size={14} />
          )}
          {state === "done" ? "Written" : "Write AGENTS.md"}
        </button>
        <code className="min-w-0 truncate text-[12px] text-[var(--lore-text-tertiary)]">
          {tilde(root)}/AGENTS.md
        </code>
      </div>
      {error ? <p className="t-meta mt-2 text-[var(--lore-danger)]">{error}</p> : null}
    </section>
  );
}

function CopyBlock({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--lore-border)]">
      <div className="flex items-center gap-2 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-1.5">
        {/* Labels here are literal file names, so they are never uppercased —
            a path has to stay copy-accurate. */}
        <span className="min-w-0 truncate text-[11px] text-[var(--lore-text-tertiary)]">
          {label}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] transition-colors",
            copied
              ? "text-[var(--lore-success)]"
              : "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]",
          )}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="lore-scrollbar overflow-x-auto bg-[var(--lore-background)] px-3 py-3 text-[12px] leading-[1.6] text-[var(--lore-text-primary)]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {content}
      </pre>
    </div>
  );
}

type ListenState = {
  config: {
    enabled: boolean;
    sources: Record<string, boolean>;
  };
  inbox: string;
  modelReady: boolean;
  lastSweep: {
    at: number;
    result: { scanned: number; distilled: number; filed: number; wrote: string[] };
  } | null;
};

/**
 * Auto-wiki — the conversations you already have, becoming pages.
 *
 * Off by default and loud about what it does, because it reads private
 * transcripts. The card states the three facts a person needs before flipping
 * the switch: which sources exist on this machine, that distillation happens
 * on this machine, and where the inbox is for the tools whose conversations
 * live where no local app can honestly reach (ChatGPT, Claude's own app —
 * their official exports go in the inbox and get the identical treatment).
 */
function AutoWiki() {
  const [state, setState] = useState<ListenState | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const load = useCallback(() => {
    fetch("/api/listen", { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (patch: Record<string, unknown>) => {
    await fetch("/api/listen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    load();
  };

  const sweepNow = async () => {
    setSweeping(true);
    await fetch("/api/listen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sweep" }),
    }).catch(() => null);
    setSweeping(false);
    load();
  };

  if (!state) return null;
  const { config } = state;

  const SOURCES: { key: string; label: string; hint: string }[] = [
    { key: "claude-code", label: "Claude Code", hint: "session transcripts on this machine" },
    { key: "codex", label: "Codex", hint: "session transcripts on this machine" },
    { key: "inbox", label: "Inbox", hint: "ChatGPT / Claude app exports you drop in" },
  ];

  return (
    <section className="mt-7 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--lore-text-primary)]">
            Auto-wiki
          </h2>
          <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
            Reads your AI conversations after they go quiet, distils what was durable with
            the local model — decisions, corrections, setups — and files it under{" "}
            <code className="rounded bg-[var(--lore-surface-raised)] px-1 py-px">auto/</code>.
            Secrets are scrubbed before the model ever sees the text. Nothing leaves this
            machine, and without a local model nothing is written at all.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => update({ enabled: !config.enabled })}
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors",
            config.enabled ? "bg-[var(--lore-accent)]" : "bg-[var(--lore-surface-raised)]",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              config.enabled ? "translate-x-[18px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {config.enabled ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {SOURCES.map((source) => (
              <button
                key={source.key}
                type="button"
                onClick={() =>
                  update({ sources: { ...config.sources, [source.key]: !config.sources[source.key] } })
                }
                title={source.hint}
                className={cn(
                  "t-meta rounded-lg border px-2.5 py-1 transition-colors",
                  config.sources[source.key]
                    ? "border-[var(--lore-accent)] text-[var(--lore-text-primary)]"
                    : "border-[var(--lore-border)] text-[var(--lore-text-tertiary)]",
                )}
              >
                {source.label}
              </button>
            ))}
          </div>

          <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
            {!state.modelReady
              ? "No local model is running — the listener will wait rather than dump raw transcripts."
              : state.lastSweep
                ? `Last sweep ${relativeTime(state.lastSweep.at)}: ${state.lastSweep.result.scanned} transcripts checked, ${state.lastSweep.result.filed} filed.`
                : "Waiting for the first sweep."}{" "}
            Inbox for exports:{" "}
            <code className="rounded bg-[var(--lore-surface-raised)] px-1 py-px">{state.inbox}</code>
          </p>

          <button
            type="button"
            onClick={sweepNow}
            disabled={sweeping}
            className="t-meta mt-2.5 rounded-lg border border-[var(--lore-border)] px-3 py-1.5 text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-40"
          >
            {sweeping ? "Sweeping…" : "Sweep now"}
          </button>
        </>
      ) : null}
    </section>
  );
}

type AgentToken = {
  id: string;
  name: string;
  role: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  scopes: string[];
};

/**
 * Access tokens for the HTTP MCP endpoint.
 *
 * `/api/mcp` has always worked and has always been unreachable: it requires a
 * bearer token, and nothing in the product could mint one. A feature that
 * returns 401 to every possible caller is not a security posture, it is a
 * missing button — and the audit that found it also found DOCUMENTATION.md
 * describing the endpoint as available.
 *
 * The plaintext token exists in exactly one response and is never recoverable,
 * so it is shown once, loudly, with the reason. Revoked tokens are kept rather
 * than deleted: the usage log refers to them, and an audit trail with holes in
 * it explains nothing.
 */
function AccessTokens() {
  const [tokens, setTokens] = useState<AgentToken[] | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("reader");
  const [issued, setIssued] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/access", { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTokens(d?.tokens ?? []))
      .catch(() => setTokens([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const issue = async () => {
    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role }),
    }).catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json()) as { token?: string };
    if (data.token) setIssued(data.token);
    setName("");
    load();
  };

  const revoke = async (id: string) => {
    // The route reads ?id= from the query string, not a JSON body. Sending a
    // body returned 400 and left the token live — caught by driving the whole
    // mint/use/revoke cycle rather than by reading the component.
    await fetch(`/api/access?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => null,
    );
    load();
  };

  if (!tokens) return null;
  const live = tokens.filter((t) => !t.revokedAt);

  return (
    <section className="mt-7 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--lore-text-primary)]">
        Access tokens
      </h2>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
        For agents that reach Lore over HTTP rather than stdio — a hosted assistant, a
        script on this machine, a phone. A reader token can search and read; a writer
        token can also write. Tokens are stored hashed and shown once.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is this token for?"
          className="min-w-0 flex-1 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2 text-[13.5px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-text-tertiary)]"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="shrink-0 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[13px] text-[var(--lore-text-primary)] outline-none"
        >
          <option value="reader">reader</option>
          <option value="writer">writer</option>
        </select>
        <button
          type="button"
          onClick={issue}
          disabled={!name.trim()}
          className="shrink-0 rounded-lg border border-[var(--lore-border)] px-3 py-2 text-[13px] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-40"
        >
          Issue
        </button>
      </div>

      {issued ? (
        <div className="mt-3 rounded-lg border border-[var(--lore-accent)] px-3 py-2.5">
          <p className="t-meta text-[var(--lore-text-secondary)]">
            Copy this now — it is stored hashed and cannot be shown again.
          </p>
          <code className="mt-1 block break-all text-[12.5px] text-[var(--lore-text-primary)]">
            {issued}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(issued);
              setIssued(null);
            }}
            className="t-meta mt-2 rounded border border-[var(--lore-border)] px-2 py-1 text-[var(--lore-text-secondary)] transition-colors hover:text-[var(--lore-text-primary)]"
          >
            Copy and dismiss
          </button>
        </div>
      ) : null}

      {live.length ? (
        <ul className="mt-3 divide-y divide-[var(--lore-border)] rounded-lg border border-[var(--lore-border)]">
          {live.map((token) => (
            <li key={token.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-[var(--lore-text-primary)]">
                  {token.name}
                </span>
                <span className="t-meta text-[var(--lore-text-tertiary)]">
                  {token.role} · {token.lastUsedAt ? `last used ${relativeTime(token.lastUsedAt)}` : "never used"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(token.id)}
                className="t-meta shrink-0 text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-danger)]"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The Obsidian plugin, from the app that generates it.
 *
 * `/api/obsidian` writes a complete plugin into the vault's own
 * `.obsidian/plugins/` and has never had a caller — the feature shipped and
 * could only be reached by curling it. It belongs here rather than in Settings
 * because installing it is the same category of act as connecting an agent:
 * you are giving another program a door into this wiki.
 *
 * Enabling it stays manual. Editing `community-plugins.json` to switch on code
 * inside somebody's editor is not a thing one app should do to another.
 */
function ObsidianPlugin() {
  const [state, setState] = useState<{ isObsidian: boolean; installed: boolean; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/obsidian", { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Nothing to offer someone whose wiki is not an Obsidian vault.
  if (!state?.isObsidian) return null;

  const install = async () => {
    setBusy(true);
    const response = await fetch("/api/obsidian", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ port: APP_PORT }),
    }).catch(() => null);
    const body = response?.ok ? await response.json() : null;
    setDone(body?.next ?? "Could not write the plugin.");
    setBusy(false);
    load();
  };

  return (
    <section className="mt-7 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--lore-text-primary)]">
        Obsidian plugin
      </h2>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
        This wiki is an Obsidian vault. Lore can write a small plugin into it that shows
        the brief in a side panel and lets you ask your wiki without leaving Obsidian. It
        talks only to Lore on this machine, and never writes to your notes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={install}
          disabled={busy}
          className="rounded-lg border border-[var(--lore-border)] px-3 py-1.5 text-[13px] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-40"
        >
          {busy ? "Writing…" : state.installed ? "Reinstall the plugin" : "Install the plugin"}
        </button>
        <span className="t-meta text-[var(--lore-text-tertiary)]">
          {done ?? (state.installed ? "Installed. Enable it in Obsidian's community plugins." : state.path)}
        </span>
      </div>
    </section>
  );
}
