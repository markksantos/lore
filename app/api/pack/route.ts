import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { inQuarantineFolder } from "@/lib/policy";
import { getIndex } from "@/lib/wiki";
import { readLedger } from "@/lib/verify";
import { readPolicy } from "@/lib/policy";
import { buildPack, clampBudget, renderPack, aliasesOf } from "@/lib/pack";
import { detectOllama, recommendModel } from "@/lib/ollama";
import { readCanon, renderCanon } from "@/lib/canon";
import { rerankPack } from "@/lib/rerank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/**
 * A context pack: the best N tokens about a subject, as passages with citations.
 *
 * `?q=` is the subject, `?budget=` the token ceiling, `?format=md` returns
 * markdown ready to paste rather than JSON.
 *
 * This exists because the two things an agent could do before were both bad:
 * read the index and guess, or open four whole pages and spend the window on
 * the irrelevant three-quarters of each.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() ?? "";
    if (!query) return fail(new Error("Pass ?q="));

    const budget = clampBudget(params.get("budget"));
    /*
     * `?scope=clients/` — retrieve from one part of the wiki.
     *
     * Distinct from LORE_SCOPE, which is a boundary the agent's own config
     * imposes on it. This is the agent narrowing its own search because it
     * already knows where the answer lives, which is both faster and far more
     * precise than hoping the ranker guesses right.
     */
    const scope = (params.get("scope") ?? "").trim().replace(/^\/+/, "");

    const [index, ledger, policy] = await Promise.all([
      getIndex(vault.root),
      readLedger(vault.root),
      readPolicy(vault.root),
    ]);

    const withheld = new Set(policy.quarantined);
    const hashes = new Map(index.pages.map((p) => [p.id, hashOf(p.plain)]));

    let pack = buildPack(
      query,
      index.pages
        .filter((p) => !withheld.has(p.id))
        // A page in a landing folder nobody has read yet must not be quoted
        // back as though the wiki stands behind it.
        .filter((p) => !inQuarantineFolder(policy, p.relPath))
        .filter((p) => !scope || p.relPath.startsWith(scope))
        .map((p) => ({
          id: p.id,
          relPath: p.relPath,
          title: p.title,
          plain: p.plain,
          words: p.words,
          mtime: p.mtime,
          aliases: aliasesOf(p),
        })),
      ledger,
      hashes,
      budget,
    );

    /*
     * `?rerank=1` — spend seconds to fix the order.
     *
     * Off by default because the lexical pass answers in milliseconds and an
     * agent calling this in a loop should not be paying for a model it did not
     * ask for. On, it is the precision stage over the recall stage.
     */
    if (params.get("rerank") === "1") {
      const detection = await detectOllama().catch(() => null);
      const model = detection?.running
        ? (recommendModel(detection.models) ?? detection.models[0]?.name ?? null)
        : null;
      const outcome = await rerankPack(pack, model).catch(() => null);
      if (outcome) pack = outcome.pack;
    }

    if (params.get("format") === "md") {
      /*
       * Canon goes above the passages and outside the budget.
       *
       * It is a few dozen tokens, it is the only part of the wiki guaranteed
       * true, and paying for it out of the passage allowance — where a long
       * question could crowd it out — would be exactly backwards.
       */
      const canon = renderCanon(await readCanon(vault.root));
      return new Response(canon ? `${canon}\n${renderPack(pack)}` : renderPack(pack), {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }
    return Response.json(pack);
  } catch (error) {
    return fail(error, 409);
  }
}
