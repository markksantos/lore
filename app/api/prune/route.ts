import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readEvents } from "@/lib/usage";
import { coverageNotes, prunable } from "@/lib/prune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What has stopped earning its place, and where the wiki is thick but empty.
 *
 * Both answers need the usage log, which is why they live together: a page's
 * link count and age are visible to anything that can read a folder, and
 * whether anything has ever actually read it is visible only from here.
 */
export async function GET() {
  try {
    const vault = await requireVault();
    const [index, events] = await Promise.all([
      getIndex(vault.root),
      readEvents(vault.root).catch(() => []),
    ]);
    return Response.json({
      candidates: prunable(index, events),
      coverage: coverageNotes(index, events),
      pages: index.pages.length,
    });
  } catch (error) {
    return fail(error);
  }
}
