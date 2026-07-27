"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FileDown,
  Loader2,
  Plug,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/harness");
    if (response.ok) setProbe(await response.json());
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

      <section className="mt-7">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          On this machine
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          Read from disk, not guessed. A row says connected only when Lore&apos;s own entry
          is physically in that file.
        </p>

        <div className="mt-3.5 space-y-2.5">
          {probe === null ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-6 text-[13px] text-[var(--lore-text-tertiary)]">
              <Loader2 size={14} className="animate-spin" />
              Checking config files…
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
