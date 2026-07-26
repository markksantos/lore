import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { buildReport, readEvents } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What your agents read, and what they asked for and could not find.
 *
 * The gap list is the valuable half: every zero-result search is a question the
 * wiki failed to answer, which is a page worth writing. It is a to-do list
 * generated from real demand rather than from guessing what future-you needs.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
    const [events, index] = await Promise.all([
      readEvents(vault.root),
      getIndex(vault.root),
    ]);
    return Response.json(
      buildReport(events, index.pages.map((p) => p.id), Number.isFinite(days) ? days : 30),
    );
  } catch (error) {
    return fail(error, 409);
  }
}
