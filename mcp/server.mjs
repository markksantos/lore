#!/usr/bin/env node
/**
 * Lore MCP server.
 *
 * A thin stdio bridge onto the local Lore app. It deliberately exposes five
 * tools, not twenty-one: an agent that has to choose between twenty-one
 * overlapping tools spends its budget choosing.
 *
 * There is no write tool. `propose_edit` is the only way an agent can change
 * anything, and it lands in the human's Review queue as a diff. That is the
 * whole point of the product — an agent that can silently rewrite your wiki
 * will eventually rewrite something true into something plausible.
 *
 * Speaks MCP over stdio using JSON-RPC 2.0 directly; the protocol surface we
 * need is four methods, so a dependency would cost more than it saves.
 */

import { createInterface } from "node:readline";

const LORE_URL = process.env.LORE_URL ?? "http://127.0.0.1:4646";
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
      "Read one page in full, plus the pages that link to it and the pages it links to. Use the exact `path` from wiki_index or wiki_search.",
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
    name: "wiki_health",
    description:
      "Report what is wrong with the wiki: orphaned pages, links pointing at pages that don't exist, and pages past their review window. Use when asked to tidy, audit, or find gaps.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_edit",
    description:
      "Propose a change to the wiki. This does NOT write the file — it queues a diff for the human to accept or reject. Use it whenever you learn something durable that belongs in the wiki. Be specific in `reason`: the human reads it to decide.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Vault-relative path, e.g. notes/stack.md. For kind=create, the new path.",
        },
        kind: {
          type: "string",
          enum: ["create", "append", "replace"],
          description:
            "create: a new page. append: add to the end of an existing page (cheapest, prefer it). replace: rewrite the whole page (use sparingly).",
        },
        content: {
          type: "string",
          description:
            "For append, only the new text. For create and replace, the full file content.",
        },
        reason: {
          type: "string",
          description: "One line: what you learned and why it belongs in the wiki.",
        },
        risk: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "How much damage a wrong accept would do. Replacing existing prose is high.",
        },
      },
      required: ["path", "kind", "content", "reason"],
      additionalProperties: false,
    },
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

async function runTool(name, args = {}) {
  switch (name) {
    case "wiki_index":
      return callLore("/api/agent");

    case "wiki_search": {
      const raw = await callLore(`/api/search?q=${encodeURIComponent(args.query ?? "")}`);
      const { results } = JSON.parse(raw);
      if (!results?.length) return `No pages match "${args.query}".`;
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
      const linked = data.backlinks.map((p) => p.relPath);
      const links = data.outgoing.map((p) => p.relPath);
      return [
        `# ${data.page.title}`,
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

    case "wiki_health": {
      const raw = await callLore("/api/health");
      const h = JSON.parse(raw);
      return [
        `Health score: ${h.score}/100 across ${h.pages} pages (${h.words.toLocaleString()} words).`,
        "",
        `Orphans (${h.orphans.length}): ${h.orphans.slice(0, 20).map((p) => p.relPath).join(", ") || "none"}`,
        `Dead links (${h.unresolved.length}): ${h.unresolved.slice(0, 20).map((l) => `${l.target} (from ${l.from})`).join(", ") || "none"}`,
        `Stale (${h.stale.length}): ${h.stale.slice(0, 20).map((p) => `${p.relPath} — ${p.days}d`).join(", ") || "none"}`,
        `Untagged pages: ${h.untagged}`,
      ].join("\n");
    }

    case "propose_edit": {
      const raw = await callLore("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: args.path,
          kind: args.kind,
          content: args.content,
          reason: args.reason,
          risk: args.risk,
          agent: process.env.LORE_AGENT_NAME ?? "MCP agent",
        }),
      });
      const { proposal } = JSON.parse(raw);
      return `Proposed. It is now waiting in the human's Review queue as a ${proposal.risk}-risk ${proposal.kind} on ${proposal.relPath}. The file has NOT been changed. Do not assume it was accepted.`;
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
