"use client";

import { useState } from "react";
import { Check, Copy, FileDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_PORT } from "@/lib/brand";

/**
 * Connect agents.
 *
 * Two wires, and the screen says plainly what each one buys you:
 *  - MCP, for agents that speak it (Claude Code, Claude Desktop, Cursor, Codex)
 *  - a plain AGENTS.md in the vault, for every agent that just reads files
 *
 * Most tools in this space ship one or the other and leave you to discover
 * which your agent needs.
 */
export function ConnectionsView({ root, installDir }: { root: string; installDir: string }) {
  const [wrote, setWrote] = useState<"idle" | "writing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // The real path on this machine, resolved server-side, so the config below is
  // copy-paste-and-go rather than copy-paste-then-edit.
  const serverPath = `${installDir}/mcp/server.mjs`;

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        lore: {
          command: "node",
          args: [serverPath],
          env: { LORE_URL: `http://127.0.0.1:${APP_PORT}` },
        },
      },
    },
    null,
    2,
  );

  async function writeAgentsFile() {
    setWrote("writing");
    setError(null);
    const response = await fetch("/api/agent", { method: "POST" });
    if (!response.ok) {
      setError((await response.json()).error ?? "Could not write the file.");
      setWrote("idle");
      return;
    }
    setWrote("done");
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Connections
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Two ways in. Wire either one and your agents can read this wiki — and propose
          changes back to it.
        </p>
      </header>

      <Card
        step="1"
        title="Drop an index into the vault"
        body="Writes AGENTS.md at the root of your wiki: a one-page map of every note, its folder, its tags and a one-line summary. Any agent that reads files finds it without being told to. Re-run it whenever the wiki has moved on."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={writeAgentsFile}
            disabled={wrote === "writing"}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
          >
            {wrote === "writing" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : wrote === "done" ? (
              <Check size={14} />
            ) : (
              <FileDown size={14} />
            )}
            {wrote === "done" ? "Written" : "Write AGENTS.md"}
          </button>
          <code className="text-[12px] text-[var(--lore-text-tertiary)]">
            {root.replace(/^\/Users\/[^/]+/, "~")}/AGENTS.md
          </code>
        </div>
        {error ? <p className="t-meta mt-2 text-[var(--lore-danger)]">{error}</p> : null}
      </Card>

      <Card
        step="2"
        title="Connect over MCP"
        body="Gives an agent live tools instead of a static file: search the wiki, read a page, and propose an edit that lands in your Review queue. Add this to your MCP client config, then restart it."
      >
        <CopyBlock label="claude_desktop_config.json / .mcp.json" content={mcpConfig} />
        <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
          The path is already filled in for this machine. The server talks to this app over
          127.0.0.1, so Lore has to be running.
        </p>
      </Card>

      <Card
        step="3"
        title="Or just call the HTTP API"
        body="Every surface the MCP server uses is a plain local endpoint. Handy for a shell script, a cron job, or an agent framework that doesn't speak MCP."
      >
        <CopyBlock
          label="Shell"
          content={[
            `# the whole map, as markdown`,
            `curl -s localhost:${APP_PORT}/api/agent`,
            ``,
            `# search`,
            `curl -s "localhost:${APP_PORT}/api/search?q=pricing"`,
            ``,
            `# propose an edit (lands in Review, never written directly)`,
            `curl -s localhost:${APP_PORT}/api/proposals \\`,
            `  -H 'content-type: application/json' \\`,
            `  -d '{"path":"notes/stack.md","kind":"append","agent":"my-script",`,
            `       "reason":"Noted the new Postgres version","content":"- Postgres 17"}'`,
          ].join("\n")}
        />
      </Card>

      <div className="mt-8 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-5 py-4">
        <h2 className="text-[14px] font-semibold text-[var(--lore-text-primary)]">
          Why agents can&apos;t write directly
        </h2>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          The dangerous edit isn&apos;t the obviously wrong one — it&apos;s the confident,
          plausible one you never see. So the MCP server has no write tool. It has{" "}
          <code>propose_edit</code>, and the proposal waits in Review with a diff until you
          accept it.
        </p>
      </div>
    </div>
  );
}

function Card({
  step,
  title,
  body,
  children,
}: {
  step: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-5">
      <div className="flex items-baseline gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--lore-accent-tint)] text-[11px] font-semibold text-[var(--lore-accent)]">
          {step}
        </span>
        <h2 className="text-[15px] font-semibold text-[var(--lore-text-primary)]">{title}</h2>
      </div>
      <p className="t-body ml-[1.9rem] mt-1.5 text-[var(--lore-text-secondary)]">{body}</p>
      <div className="ml-[1.9rem] mt-4">{children}</div>
    </section>
  );
}

function CopyBlock({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--lore-border)]">
      <div className="flex items-center justify-between border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-1.5">
        <span className="t-meta text-[var(--lore-text-tertiary)]">{label}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] transition-colors",
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
