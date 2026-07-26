import { fail, requireVault } from "@/lib/server";
import { buildAgentIndex, writeRaw } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agent-facing map of the vault, as plain markdown. This is the single
 * endpoint an agent needs before it knows anything: hand it this, and it can
 * pick the two or three pages that actually matter instead of reading the
 * whole wiki or grepping blind.
 */
export async function GET() {
  try {
    const vault = await requireVault();
    const markdown = await buildAgentIndex(vault.root, vault.name);
    return new Response(markdown, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/**
 * Write that map to AGENTS.md at the vault root. This is the only file Lore
 * ever puts inside a user's wiki, it is regenerated wholesale on every run,
 * and it is the one thing that makes a plain folder legible to an agent that
 * only knows how to read files.
 */
export async function POST() {
  try {
    const vault = await requireVault();
    const markdown = await buildAgentIndex(vault.root, vault.name);
    await writeRaw(vault.root, "AGENTS.md", markdown);
    return Response.json({ ok: true, path: "AGENTS.md" });
  } catch (error) {
    return fail(error);
  }
}
