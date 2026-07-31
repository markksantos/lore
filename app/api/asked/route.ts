import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { deleteAsked, readAsked, suggestQuestions } from "@/lib/asked";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Ask sidebar: what you have asked before, and what to ask first.
 *
 * Separate from /api/ask so the sidebar paints instantly while an answer is
 * still being written, and so reopening an old thread costs nothing.
 */
export async function GET() {
  try {
    const vault = await requireVault();
    const [history, index] = await Promise.all([readAsked(vault.root), getIndex(vault.root)]);
    return Response.json({
      history,
      suggestions: suggestQuestions(
        index.pages.map((p) => ({ id: p.id, title: p.title, folder: p.folder, tags: p.tags })),
        index.backlinks,
      ),
    });
  } catch (error) {
    return fail(error, 409);
  }
}

export async function DELETE(request: Request) {
  try {
    const vault = await requireVault();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return fail(new Error("Missing id"));
    await deleteAsked(vault.root, id);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
