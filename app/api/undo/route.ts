import { fail, requireVault } from "@/lib/server";
import { getIndex, writeRaw } from "@/lib/wiki";
import { vaultKey } from "@/lib/journal";
import { planUndo } from "@/lib/undo";
import { recordAttribution } from "@/lib/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 7;

/** GET ?agent=Codex&days=2 — what reverting that agent would do. */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const params = new URL(request.url).searchParams;
    const agent = params.get("agent")?.trim();
    if (!agent) return fail(new Error("Pass ?agent="));

    const days = Math.min(90, Math.max(1, Number(params.get("days")) || DEFAULT_WINDOW_DAYS));
    const index = await getIndex(vault.root);
    const plan = await planUndo(
      vault.root,
      vaultKey(vault.root),
      agent,
      Date.now() - days * 86_400_000,
      new Set(index.pages.map((p) => p.relPath)),
    );
    return Response.json(plan);
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST — carry out the plan.
 *
 * The plan is recomputed here rather than trusted from the client. A revert
 * writes over the user's notes, and accepting a list of paths and contents from
 * a request body would make this endpoint a way to overwrite any page in the
 * vault with anything.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json().catch(() => ({}))) as {
      agent?: string;
      days?: number;
      /** Restrict the revert to these paths; omit to take everything revertable. */
      only?: string[];
    };
    const agent = body.agent?.trim();
    if (!agent) return fail(new Error("Missing agent"));

    const days = Math.min(90, Math.max(1, Number(body.days) || DEFAULT_WINDOW_DAYS));
    const index = await getIndex(vault.root);
    const plan = await planUndo(
      vault.root,
      vaultKey(vault.root),
      agent,
      Date.now() - days * 86_400_000,
      new Set(index.pages.map((p) => p.relPath)),
    );

    const only = body.only?.length ? new Set(body.only) : null;
    const reverted: string[] = [];

    for (const target of plan.targets) {
      if (target.state !== "revertable" || target.restore === null) continue;
      if (only && !only.has(target.relPath)) continue;
      await writeRaw(vault.root, target.relPath, target.restore);
      // Attributed to the undo, not to nobody: the revert is itself a write,
      // and a page whose history goes silent at the moment it changed is the
      // thing this whole feature exists to prevent.
      await recordAttribution({
        at: Date.now(),
        file: `${vault.root}/${target.relPath}`,
        agent: "Lore (undo)",
        tool: `undo:${agent}`,
      });
      reverted.push(target.relPath);
    }

    await getIndex(vault.root, true);
    return Response.json({ ok: true, reverted, skipped: plan.targets.length - reverted.length });
  } catch (error) {
    return fail(error);
  }
}
