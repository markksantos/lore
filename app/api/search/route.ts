import { fail, requireVault, toMeta } from "@/lib/server";
import { getIndex, search } from "@/lib/wiki";
import { embeddingStatus, semanticSearch } from "@/lib/embeddings";
import type { SearchResult } from "@/lib/types";
import { readPolicy } from "@/lib/policy";
import { readConfig } from "@/lib/config";

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
    const params = new URL(request.url).searchParams;
    const q = params.get("q") ?? "";

    /*
     * `?all=1` — search every linked vault, not just the active one.
     *
     * The personal wiki and a client wiki are deliberately separate corpora,
     * and the questions are not: "did I already write this up somewhere" spans
     * both, and answering it meant relinking, searching, and relinking back.
     * Results carry the vault they came from, because a hit whose home you
     * cannot see is a hit you cannot act on.
     */
    if (params.get("all") === "1") {
      const config = await readConfig();
      const everywhere: (SearchResult & { vault?: string; vaultRoot?: string })[] = [];
      for (const other of config.vaults) {
        const hits = await search(other.root, q).catch(() => []);
        for (const hit of hits.slice(0, 12)) {
          everywhere.push({
            ...hit,
            page: toMeta(hit.page),
            vault: other.name,
            vaultRoot: other.root,
          });
        }
      }
      // Interleaved by score rather than grouped by vault: grouping puts every
      // result from whichever vault was linked first above every result from
      // the one that actually answers the question.
      everywhere.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return Response.json({ results: everywhere.slice(0, 40), acrossVaults: true });
    }

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

    // Quarantined pages are withheld from every result. This is the half of
    // trust Lore can actually enforce: it cannot stop an agent writing, but it
    // decides what it hands over, and serving a page a human has flagged as
    // wrong is the one failure the whole product exists to prevent.
    const policy = await readPolicy(vault.root);
    const withheld = new Set(policy.quarantined);
    const visible = results.filter((r) => !withheld.has(r.page.id));

    return Response.json({
      results: visible,
      semantic: status,
      withheld: results.length - visible.length,
    });
  } catch (error) {
    return fail(error, 409);
  }
}
