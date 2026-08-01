import { fail, requireVault } from "@/lib/server";
import {
  around,
  blocksForDay,
  renderDayPage,
  searchScreen,
  timelineStatus,
} from "@/lib/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/timeline                     — recorder status
 * GET /api/timeline?at=<ms>&window=45   — blocks + captures around a moment
 * GET /api/timeline?screen=<query>      — full-text search over screen OCR
 *
 * All read-only against the recorder's own store. The vault is required only
 * so the endpoint sits behind the same loopback/token guard as everything
 * else — screen history is the most private data on the machine.
 */
export async function GET(request: Request) {
  try {
    await requireVault();
    const params = new URL(request.url).searchParams;

    const screen = params.get("screen");
    if (screen) return Response.json({ results: await searchScreen(screen) });

    const at = Number(params.get("at"));
    if (Number.isFinite(at) && at > 0) {
      const window = Math.min(240, Math.max(5, Number(params.get("window")) || 45));
      return Response.json({ at, window, ...(await around(at, window)) });
    }

    return Response.json(await timelineStatus());
  } catch (error) {
    return fail(error);
  }
}

/** POST { action: "file", day: "2026-08-01" } — write the day into the wiki. */
export async function POST(request: Request) {
  try {
    await requireVault();
    const body = (await request.json().catch(() => ({}))) as { action?: string; day?: string };
    if (body.action !== "file") return fail(new Error("Unknown action."));
    const day = String(body.day ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(new Error("Pass day as YYYY-MM-DD."));

    const blocks = await blocksForDay(day);
    const content = renderDayPage(day, blocks);
    if (!content) {
      return Response.json({ ok: false, reason: "Nothing recorded that day." });
    }

    const port = Number(process.env.PORT) || 4646;
    const response = await fetch(`http://127.0.0.1:${port}/api/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: `timeline/${day}.md`,
        content,
        // Replace, not append: the page IS the day, regenerated whole, so
        // re-filing after more blocks synthesize never duplicates the morning.
        mode: "replace",
        agent: "Desktop Record",
      }),
    });
    if (!response.ok) return fail(new Error("The wiki write failed."));
    return Response.json({ ok: true, path: `timeline/${day}.md`, blocks: blocks.length });
  } catch (error) {
    return fail(error);
  }
}
