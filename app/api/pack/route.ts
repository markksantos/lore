import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readLedger } from "@/lib/verify";
import { readPolicy } from "@/lib/policy";
import { buildPack, clampBudget, renderPack } from "@/lib/pack";

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

    const [index, ledger, policy] = await Promise.all([
      getIndex(vault.root),
      readLedger(vault.root),
      readPolicy(vault.root),
    ]);

    const withheld = new Set(policy.quarantined);
    const hashes = new Map(index.pages.map((p) => [p.id, hashOf(p.plain)]));

    const pack = buildPack(
      query,
      index.pages
        .filter((p) => !withheld.has(p.id))
        .map((p) => ({
          id: p.id,
          relPath: p.relPath,
          title: p.title,
          plain: p.plain,
          words: p.words,
        })),
      ledger,
      hashes,
      budget,
    );

    if (params.get("format") === "md") {
      return new Response(renderPack(pack), {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }
    return Response.json(pack);
  } catch (error) {
    return fail(error, 409);
  }
}
