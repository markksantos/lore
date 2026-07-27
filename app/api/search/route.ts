import { fail, requireVault, toMeta } from "@/lib/server";
import { getIndex, search } from "@/lib/wiki";
import { embeddingStatus, semanticSearch } from "@/lib/embeddings";
import type { SearchResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Blended search: literal first, then semantic for anything literal missed.
 *
 * Literal matching stays primary because on a personal wiki an exact title hit
 * is almost always the thing you meant, and burying it under vector neighbours
 * makes search feel vague. But literal alone fails on real questions — measured
 * here, "how do I undo a deploy" returned nothing on a wiki whose page says
 * "Rollback is a revert commit". Semantic results fill exactly that hole and
 * are marked so, so the UI can be honest about why a result is showing.
 *
 * Semantic is strictly additive. If the embedding index is still building, has
 * failed, or the model never downloaded, this degrades to plain literal search
 * rather than erroring — search is the one thing that must never be broken.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const q = new URL(request.url).searchParams.get("q") ?? "";

    const literal = await search(vault.root, q);
    const results: (SearchResult & { semantic?: boolean })[] = literal.map((hit) => ({
      ...hit,
      page: toMeta(hit.page),
    }));

    const status = embeddingStatus();
    if (q.trim() && status.ready) {
      const seen = new Set(results.map((r) => r.page.id));
      const index = await getIndex(vault.root);
      const byId = new Map(index.pages.map((p) => [p.id, p]));

      for (const hit of await semanticSearch(vault.root, q, 12)) {
        if (seen.has(hit.id)) continue;
        const page = byId.get(hit.id);
        if (!page) continue;
        results.push({
          page: toMeta(page),
          // Kept below every literal hit: a vector neighbour is a suggestion,
          // not a match, and ordering should say so without needing a label.
          score: -1,
          snippet: page.excerpt || null,
          semantic: true,
        });
      }
    }

    return Response.json({ results, semantic: status });
  } catch (error) {
    return fail(error, 409);
  }
}
