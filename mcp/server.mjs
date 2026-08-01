#!/usr/bin/env node
/**
 * Lore MCP server.
 *
 * A thin stdio bridge onto the local Lore app. It exposes seven tools, not
 * twenty-one: an agent choosing between twenty-one overlapping tools spends its
 * budget choosing.
 *
 * There IS a write tool, and it is not a gate. An earlier version shipped
 * `propose_edit`, which queued changes for human approval; that was removed
 * because it did not work and could not work — it competed with every agent's
 * built-in file-write tool and lost, and 300 changed pages a week turns a
 * perfect gate into a 300-item queue that resolves to "accept all".
 *
 * `wiki_write` is the opposite idea. It does not ask permission, it writes. What
 * it adds is that the write is attributed and lands unverified, exactly like a
 * write through any other tool. It exists for agents that have MCP and no
 * filesystem — ChatGPT, Claude on a phone — which until now could read this wiki
 * and never contribute a line to it.
 *
 * Lore watches the filesystem instead, which captures every harness equally.
 *
 * What this server IS for, beyond answering questions: it is the only place
 * that sees what agents ask of the wiki. Every call is journalled, which is
 * what produces the two reports nothing else can generate — which pages carry
 * the weight, and which questions the wiki failed to answer.
 *
 * Speaks MCP over stdio using JSON-RPC 2.0 directly; the protocol surface we
 * need is four methods, so a dependency would cost more than it saves.
 */

import { createInterface } from "node:readline";

const LORE_URL = process.env.LORE_URL ?? "http://127.0.0.1:4646";
const AGENT = process.env.LORE_AGENT_NAME ?? "MCP agent";
/*
 * Provenance, when the harness offers it.
 *
 * Claude Code exports a session id, and its hook payload carries a link back
 * to the conversation. Passing both through means a surprising line on a page
 * can be traced to the conversation that produced it instead of to a name.
 */
const SESSION = process.env.LORE_SESSION_ID ?? process.env.CLAUDE_SESSION_ID ?? "";
const SESSION_URL = process.env.LORE_SESSION_URL ?? "";
const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "wiki_index",
    description:
      "Get the map of the whole wiki: every page with its path, folder, tags and a one-line summary. Call this FIRST, before any other wiki tool — it is small, and it tells you which pages are worth opening.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "wiki_search",
    description:
      "Search the wiki by keyword. Returns matching pages with a snippet around the match. Use when you know roughly what you're looking for but not which page it's on.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or phrase to search for." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "wiki_read",
    description:
      "Read one page in full, plus its trust state and the pages linking to and from it. The trust line says whether a human has ever confirmed this page — prefer verified pages, and say so when you rely on an unverified one. Use the exact `path` from wiki_index or wiki_search.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative path, e.g. notes/stack.md" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "wiki_context",
    description:
      "Get the best passages about a subject, assembled to a token budget, each citing its source page. Prefer this over reading several pages in full — it returns the relevant sections instead of whole documents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The subject you need context on." },
        budget: {
          type: "number",
          description: "Approximate token ceiling for the result. Defaults to 8000.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    /*
     * The brief, for the agent.
     *
     * `wiki_changes` gives a file-level changelog — paths and line counts —
     * which is what an agent needs to avoid re-reading. This gives the meaning:
     * one sentence per page saying what is true now. It exists here because the
     * brief had exactly one door, a screen at localhost, and the reader most
     * likely to benefit from "what did the other agents learn since I last ran"
     * is the next agent, not the human.
     */
    name: "wiki_brief",
    description:
      "What the wiki LEARNED recently, in one sentence per page — what is true now, not which files moved. Call at the start of a session to catch up on what other agents wrote without reading the pages. For raw file-level changes use wiki_changes instead.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "How far back to look. Defaults to 1 (today).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wiki_changes",
    description:
      "List pages that changed since a timestamp, with who changed them and how much. Use at the start of a session to catch up instead of re-reading pages you have already seen.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "number",
          description: "Millisecond epoch timestamp. Defaults to seven days ago.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wiki_write",
    description:
      "Create or update a page. The write is attributed to you and lands UNVERIFIED — a human decides later whether it is trustworthy. Use `mode: append` to add to a page without touching what is already there; that is almost always the safer choice.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative path, e.g. notes/stack.md" },
        content: { type: "string", description: "Markdown to write." },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "append adds to the end; replace overwrites the whole page.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "wiki_health",
    description:
      "Report what is wrong with the wiki: orphaned pages, links pointing at pages that don't exist, and pages past their review window. Use when asked to tidy, audit, or find gaps.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

async function callLore(path, init) {
  const response = await fetch(`${LORE_URL}${path}`, init);
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Not JSON; the raw body is the best error we have.
    }
    throw new Error(message || `Lore returned ${response.status}`);
  }
  return text;
}

/**
 * Report a tool call to Lore's usage log.
 *
 * Fire-and-forget on purpose: telemetry must never delay or fail the answer the
 * agent is waiting on. A dropped event is a rounding error; a stalled tool call
 * is a broken product.
 */
function report(event) {
  fetch(`${LORE_URL}/api/mcp-event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...event, agent: AGENT }),
  }).catch(() => {});
}

async function runTool(name, args = {}) {
  switch (name) {
    case "wiki_index": {
      const map = await callLore("/api/agent");
      report({ t: "index", tokens: Math.round(map.length / 4) });
      return map;
    }

    case "wiki_search": {
      const raw = await callLore(`/api/search?q=${encodeURIComponent(args.query ?? "")}`);
      const { results } = JSON.parse(raw);
      report({ t: "search", query: args.query ?? "", hits: results?.length ?? 0 });
      // A zero-result search is the single most useful thing this server can
      // observe: it is a question the wiki could not answer, which is a page
      // worth writing. The wording nudges the agent to say so out loud.
      if (!results?.length) {
        return `No pages match "${args.query}". This gap has been logged for the human to fill.`;
      }
      return results
        .map(
          (hit) =>
            `- \`${hit.page.relPath}\` — ${hit.page.title}` +
            (hit.snippet ? `\n  ${hit.snippet}` : ""),
        )
        .join("\n");
    }

    case "wiki_read": {
      const raw = await callLore(`/api/page?path=${encodeURIComponent(args.path ?? "")}`);
      const data = JSON.parse(raw);
      report({ t: "read", page: data.page.id });
      const linked = data.backlinks.map((p) => p.relPath);
      const links = data.outgoing.map((p) => p.relPath);
      /*
       * Trust is stated first, in words the model will act on. A page that says
       * "verified by a human" and one that says "no human has ever checked
       * this" should not be quoted with the same confidence, and until now the
       * model had no way to tell them apart.
       */
      const TRUST_NOTE = {
        verified: "VERIFIED — a human confirmed this exact text. Safe to rely on.",
        aging: "AGING — confirmed by a human, but a while ago. Worth double-checking dates and numbers.",
        lapsed: "LAPSED — a human confirmed an earlier version, and it has been rewritten since. Treat as unverified.",
        unverified: "UNVERIFIED — no human has ever checked this page. It may have been written by an agent. Say so if you rely on it.",
      };

      /*
       * A superseded page is announced before its own content.
       *
       * An agent that reads a replaced page and quotes it is not making a
       * mistake it could have avoided — nothing in the text says it was
       * replaced. Putting the redirect above the fold is the only placement
       * that changes what the model does with it.
       */
      return [
        `# ${data.page.title}`,
        data.supersededBy
          ? `SUPERSEDED — this page was replaced by \`${data.supersededBy.relPath}\` (${data.supersededBy.title}). Read that instead; quote this one only for history.`
          : null,
        data.expired
          ? `EXPIRED — the author marked this good until ${new Date(data.expires).toISOString().slice(0, 10)}, which has passed. Treat every number on it as unconfirmed.`
          : null,
        `trust: ${TRUST_NOTE[data.trust] ?? "unknown"}`,
        `path: ${data.page.relPath}`,
        data.page.tags.length ? `tags: ${data.page.tags.join(", ")}` : null,
        linked.length ? `linked from: ${linked.join(", ")}` : null,
        links.length ? `links to: ${links.join(", ")}` : null,
        "",
        "---",
        "",
        data.raw,
      ]
        .filter((line) => line !== null)
        .join("\n");
    }

    case "wiki_context": {
      const budget = Number(args.budget) || 8000;
      const raw = await callLore(
        `/api/pack?format=md&budget=${budget}&q=${encodeURIComponent(args.query ?? "")}`,
      );
      // Logged as a search so a pack that finds nothing counts as a gap, the
      // same as a bare search would. The question failed either way.
      const found = !raw.startsWith("No passages");
      report({
        t: "context",
        query: args.query ?? "",
        tokens: Math.round(raw.length / 4),
        hits: found ? 1 : 0,
      });
      return raw;
    }

    case "wiki_brief": {
      const days = Math.min(30, Math.max(1, Number(args.days) || 1));
      const data = JSON.parse(await callLore(`/api/brief?days=${days}`));
      report({ t: "brief", days, items: data.items?.length ?? 0 });
      if (!data.items.length) {
        return `Nothing was written to the wiki in the last ${days === 1 ? "day" : `${days} days`}.`;
      }
      const lines = data.items.map(
        (i) => `- ${i.line}\n  (\`${i.relPath}\`${i.agent ? `, by ${i.agent}` : ""})`,
      );
      return [
        `What the wiki learned in the last ${days === 1 ? "day" : `${days} days`} — ${data.events} writes across ${data.pagesTouched} pages, ranked:`,
        "",
        ...lines,
        "",
        "Open any of these with wiki_read if you need the detail.",
      ].join("\n");
    }

    case "wiki_changes": {
      const since = Number(args.since) || Date.now() - 7 * 86_400_000;
      const raw = await callLore(`/api/changes?since=${since}`);
      const data = JSON.parse(raw);
      if (!data.changes.length) {
        return `Nothing changed in the wiki since ${new Date(since).toISOString()}.`;
      }
      const lines = data.changes.map((c) => {
        const who = c.agent ? ` by ${c.agent}` : "";
        const trust = c.gone ? "DELETED" : (c.trust ?? "unknown");
        return `- \`${c.relPath}\` — ${c.kinds.join("/")}${who}, +${c.linesAdded}/-${c.linesRemoved} (${trust})`;
      });
      return [
        `${data.changes.length} pages changed since ${new Date(data.since).toISOString()}.`,
        `Pass since=${data.now} next time to get only what is newer than this call.`,
        "",
        ...lines,
      ].join("\n");
    }

    case "wiki_write": {
      const mode = args.mode === "replace" ? "replace" : "append";
      const raw = await callLore("/api/page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: args.path,
          content: args.content ?? "",
          mode,
          agent: AGENT,
          session: SESSION || undefined,
          url: SESSION_URL || undefined,
        }),
      });
      const data = JSON.parse(raw);
      report({ t: "write", page: data.page?.id ?? args.path, notes: data.notes?.length ?? 0 });
      /*
       * The notes are the point.
       *
       * A write tool that only confirms the write wastes the one moment when
       * the author can still act — it knows what it meant, it has the context
       * loaded, and fixing a contradiction or adding a link costs it a
       * sentence. Everything Lore noticed comes back here rather than waiting
       * on a screen for a human.
       */
      return [
        `Wrote \`${args.path}\` (${mode}).`,
        "It is recorded as unverified and attributed to you. A human decides whether to trust it.",
        data.notesText || "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "wiki_health": {
      report({ t: "health" });
      const raw = await callLore("/api/health");
      const h = JSON.parse(raw);
      return [
        `Health score: ${h.score}/100 across ${h.pages} pages (${h.words.toLocaleString()} words).`,
        "",
        `Orphans (${h.orphans.length}): ${h.orphans.slice(0, 20).map((p) => p.relPath).join(", ") || "none"}`,
        `Dead links (${h.unresolved.length}): ${h.unresolved.slice(0, 20).map((l) => `${l.target} (from ${l.from})`).join(", ") || "none"}`,
        `Stale (${h.stale.length}): ${h.stale.slice(0, 20).map((p) => `${p.relPath} — ${p.days}d`).join(", ") || "none"}`,
        `Expired (${h.expired.length}): ${h.expired.slice(0, 20).map((p) => `${p.relPath} — ${p.daysOver}d past its own expires:`).join(", ") || "none"}`,
        `Untagged pages: ${h.untagged}`,
      ].join("\n");
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ------------------------------------------------------------------- JSON-RPC

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(request) {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "lore", version: "0.1.0" },
      });

    case "notifications/initialized":
      return; // Notification: no id, no response.

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      try {
        const text = await runTool(params?.name, params?.arguments ?? {});
        return reply(id, { content: [{ type: "text", text }] });
      } catch (error) {
        // Tool failures come back as a result with isError, not a protocol
        // error: the agent should see the message and be able to recover.
        return reply(id, {
          content: [
            {
              type: "text",
              text:
                `${error.message}\n\n` +
                `(Is Lore running? The MCP server talks to ${LORE_URL}. ` +
                `Start it with \`npm run dev\` in the Lore folder.)`,
            },
          ],
          isError: true,
        });
      }
    }

    case "ping":
      return reply(id, {});

    default:
      if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return replyError(null, -32700, "Parse error");
  }
  try {
    await handle(request);
  } catch (error) {
    if (request.id !== undefined) replyError(request.id, -32603, error.message);
  }
});
