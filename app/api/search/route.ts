import { fail, requireVault, toMeta } from "@/lib/server";
import { search } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const hits = await search(vault.root, q);
    return Response.json({
      results: hits.map((hit) => ({ ...hit, page: toMeta(hit.page) })),
    });
  } catch (error) {
    return fail(error, 409);
  }
}
