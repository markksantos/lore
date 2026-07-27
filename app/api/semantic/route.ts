import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { embeddingStatus, ensureIndex, relatedTo, semanticSearch } from "@/lib/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meaning-based search over the vault, computed on this machine.
 *
 * Every response carries the index status alongside the results, because an
 * empty result set is ambiguous on its own: it can mean "nothing is similar",
 * "the model is still downloading" or "the model failed to load". The caller
 * needs to tell those apart to decide whether to fall back to literal search.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const params = new URL(request.url).searchParams;
    const limitParam = Number(params.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

    const related = params.get("related");
    const q = params.get("q");

    const results = related
      ? await relatedTo(vault.root, related, limit)
      : q
        ? await semanticSearch(vault.root, q, limit)
        : [];

    return Response.json({ results, status: embeddingStatus() });
  } catch (error) {
    return fail(error, 409);
  }
}

/**
 * Refresh the index. Returns as soon as the work is scheduled — building runs
 * in the background and progress is read back from GET, so nothing here waits
 * on a full pass over the vault.
 */
export async function POST() {
  try {
    const vault = await requireVault();
    const index = await getIndex(vault.root);
    await ensureIndex(
      vault.root,
      index.pages.map((page) => ({ id: page.id, title: page.title, text: page.plain })),
    );
    return Response.json({ status: embeddingStatus() });
  } catch (error) {
    return fail(error, 409);
  }
}
