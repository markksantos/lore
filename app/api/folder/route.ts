import { fail, requireVault, toMeta } from "@/lib/server";
import { getIndex, readRaw } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A folder, as one document.
 *
 * Returns every page in the folder with its full source. This is one request
 * rather than N because the folder *is* the unit the user reads — fetching page
 * bodies lazily as they scroll would make the document assemble itself in front
 * of them.
 *
 * `?path=` is the folder; the empty string is the vault root.
 *
 * PAGINATED, because a real vault has folders this cannot hold: one measured
 * corpus keeps 654 pages in `clients/`, and returning all of them with full
 * source would be a multi-megabyte response rendering thousands of DOM nodes.
 * `?offset=` and `?limit=` page through, newest-edited first so the top of the
 * document is the part you are most likely to want.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const params = new URL(request.url).searchParams;
    const folder = params.get("path") ?? "";
    const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 40) || 40));

    const index = await getIndex(vault.root);

    const inFolder = index.pages
      .filter((page) => page.folder === folder)
      .sort((a, b) => b.mtime - a.mtime);
    const pages = inFolder.slice(offset, offset + limit);

    const sections = await Promise.all(
      pages.map(async (page) => ({
        page: toMeta(page),
        raw: await readRaw(vault.root, page.relPath).catch(() => ""),
      })),
    );

    return Response.json({
      folder,
      sections,
      total: inFolder.length,
      offset,
      limit,
      hasMore: offset + pages.length < inFolder.length,
    });
  } catch (error) {
    return fail(error, 409);
  }
}
