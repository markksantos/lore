import { getActiveVault } from "@/lib/config";
import { record, type UsageEvent } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The MCP server posts every tool call here.
 *
 * This is the sensor half of the product. Lore sitting between agents and the
 * wiki is worthless as a gate — a plain folder has a hundred other write paths
 * — but it is the only vantage point from which you can see what your agents
 * actually ask for. Two questions get answered here and nowhere else: which
 * pages carry the weight, and which questions the wiki failed to answer.
 *
 * Always returns 204. The MCP server fires and forgets, and an agent's answer
 * must never be delayed or failed by bookkeeping.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<UsageEvent> & { t?: string };
    const vault = await getActiveVault();
    if (!vault) return new Response(null, { status: 204 });

    const base = { at: Date.now(), agent: String(body.agent ?? "unknown"), vault: vault.root };

    switch (body.t) {
      case "read":
        if (body.page) await record({ ...base, t: "read", page: String(body.page) });
        break;
      case "search":
        await record({
          ...base,
          t: "search",
          query: String(body.query ?? ""),
          hits: Number(body.hits ?? 0),
        });
        break;
      case "index":
        await record({
          ...base,
          t: "index",
          pages: Number(body.pages ?? 0),
          tokens: Number(body.tokens ?? 0),
        });
        break;
      case "health":
        await record({ ...base, t: "health" });
        break;
      case "write":
        if (body.page) {
          await record({
            ...base,
            t: "write",
            page: String(body.page),
            notes: Number(body.notes ?? 0),
          });
        }
        break;
      case "brief":
        await record({
          ...base,
          t: "brief",
          days: Number(body.days ?? 1),
          items: Number(body.items ?? 0),
        });
        break;
      case "context":
        await record({
          ...base,
          t: "context",
          query: String(body.query ?? ""),
          tokens: Number(body.tokens ?? 0),
          hits: Number(body.hits ?? 0),
        });
        break;
    }
  } catch {
    // Never surface a telemetry failure to the agent.
  }
  return new Response(null, { status: 204 });
}
