import { fail, requireVault, toMeta } from "@/lib/server";
import { getIndex, readRaw } from "@/lib/wiki";
import { diffStats, listProposals } from "@/lib/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A folder, as one document.
 *
 * Returns every page in the folder with its full source, plus the proposals
 * standing against each. This is one request rather than N because the folder
 * *is* the unit the user reads — fetching page bodies lazily as they scroll
 * would make the document assemble itself in front of them.
 *
 * `?path=` is the folder; the empty string is the vault root.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const folder = new URL(request.url).searchParams.get("path") ?? "";

    const [index, allProposals] = await Promise.all([
      getIndex(vault.root),
      listProposals(vault.root),
    ]);

    const pages = index.pages.filter((page) => page.folder === folder);
    const pending = allProposals.filter((p) => p.status === "pending");

    const sections = await Promise.all(
      pages.map(async (page) => ({
        page: toMeta(page),
        raw: await readRaw(vault.root, page.relPath).catch(() => ""),
        proposals: pending
          .filter((p) => p.relPath === page.relPath)
          .map((p) => ({ ...p, stats: diffStats(p.base ?? "", p.proposed) })),
      })),
    );

    // Proposals that would CREATE a page in this folder have no section to
    // attach to yet, so they ride along separately and render as pending new
    // sections at the end of the document.
    const incoming = pending
      .filter((p) => p.kind === "create")
      .filter((p) => {
        const dir = p.relPath.includes("/")
          ? p.relPath.slice(0, p.relPath.lastIndexOf("/"))
          : "";
        return dir === folder;
      })
      .map((p) => ({ ...p, stats: diffStats("", p.proposed) }));

    const totals = [...sections.flatMap((s) => s.proposals), ...incoming].reduce(
      (acc, p) => ({
        count: acc.count + 1,
        added: acc.added + p.stats.added,
        removed: acc.removed + p.stats.removed,
      }),
      { count: 0, added: 0, removed: 0 },
    );

    return Response.json({ folder, sections, incoming, totals });
  } catch (error) {
    return fail(error, 409);
  }
}
