import { fail, requireVault } from "@/lib/server";
import { can, identify, inScope, touch } from "@/lib/access";
import { getIndex, readRaw } from "@/lib/wiki";
import { readPolicy } from "@/lib/policy";
import { record } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP over HTTP.
 *
 * The stdio server in `mcp/` only works for a client running on this machine.
 * That covers Claude Code and Cursor and excludes everything else: ChatGPT on a
 * phone, a hosted agent, anything that can make a request but cannot spawn a
 * process. This is the same four-plus-three tool surface reachable over HTTP,
 * and it is what a hosted Lore would expose.
 *
 * Unlike every other route, this one authenticates per caller rather than
 * trusting loopback. A token identifies WHICH agent is asking, which is what
 * makes revocation, scoping and per-agent reporting possible — none of which
 * loopback can express, because loopback says only "someone on this machine".
 */
const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "wiki_index",
    description:
      "The map of the whole wiki: every page with path, folder, tags and a one-line summary. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "wiki_search",
    description: "Search the wiki by keyword. Returns matching pages with a snippet.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "wiki_read",
    description: "Read one page in full, using the exact path from index or search.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "wiki_context",
    description:
      "The best passages about a subject, assembled to a token budget, each citing its page.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, budget: { type: "number" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

const rpc = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function POST(request: Request) {
  try {
    const vault = await requireVault();

    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const agent = await identify(vault.root, token);
    if (!agent) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "A valid bearer token is required." } },
        { status: 401 },
      );
    }
    void touch(vault.root, agent.id);

    const body = (await request.json()) as { id?: unknown; method?: string; params?: Record<string, unknown> };
    const { id, method, params } = body;

    if (method === "initialize") {
      return rpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "lore-http", version: "0.1.0" },
      });
    }
    if (method === "tools/list") {
      return rpc(id, { tools: TOOLS });
    }
    if (method !== "tools/call") {
      return rpcError(id, -32601, `Unknown method: ${method}`);
    }

    const name = String((params as { name?: string })?.name ?? "");
    const args = ((params as { arguments?: Record<string, unknown> })?.arguments ?? {}) as Record<
      string,
      string | number
    >;

    const capability = { wiki_index: "index", wiki_search: "search", wiki_read: "read", wiki_context: "context" }[name];
    if (!capability) return rpcError(id, -32602, `Unknown tool: ${name}`);
    if (!can(agent.role, capability)) {
      return rpcError(id, -32003, `Your token's role (${agent.role}) cannot ${capability}.`);
    }

    const [index, policy] = await Promise.all([getIndex(vault.root), readPolicy(vault.root)]);
    const withheld = new Set(policy.quarantined);
    // Scope and quarantine are applied once, here, so no tool below can forget.
    const visible = index.pages.filter((p) => !withheld.has(p.id) && inScope(agent, p.id));

    const text = async (): Promise<string> => {
      switch (name) {
        case "wiki_index": {
          void record({ t: "index", at: Date.now(), agent: agent.name, vault: vault.root, pages: visible.length, tokens: 0 });
          return visible
            .map((p) => `- \`${p.relPath}\` — ${p.title}${p.tags.length ? ` [${p.tags.join(", ")}]` : ""}`)
            .join("\n");
        }
        case "wiki_search": {
          const q = String(args.query ?? "").toLowerCase();
          const hits = visible.filter(
            (p) => p.title.toLowerCase().includes(q) || p.plain.toLowerCase().includes(q),
          );
          void record({ t: "search", at: Date.now(), agent: agent.name, vault: vault.root, query: String(args.query ?? ""), hits: hits.length });
          if (!hits.length) return `No pages match "${args.query}". This gap has been logged.`;
          return hits.slice(0, 25).map((p) => `- \`${p.relPath}\` — ${p.title}`).join("\n");
        }
        case "wiki_read": {
          const page = visible.find((p) => p.relPath === String(args.path ?? ""));
          if (!page) return "No such page, or it is outside your token's scope.";
          void record({ t: "read", at: Date.now(), agent: agent.name, vault: vault.root, page: page.id });
          return await readRaw(vault.root, page.relPath).catch(() => "");
        }
        default: {
          const budget = Number(args.budget) || 8000;
          const url = new URL(request.url);
          url.pathname = "/api/pack";
          url.search = `?format=md&budget=${budget}&q=${encodeURIComponent(String(args.query ?? ""))}`;
          const response = await fetch(url, { headers: { host: "127.0.0.1" } });
          return response.ok ? await response.text() : "Could not build a context pack.";
        }
      }
    };

    return rpc(id, { content: [{ type: "text", text: await text() }] });
  } catch (error) {
    return fail(error, 409);
  }
}
