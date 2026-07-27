import { fail, requireVault } from "@/lib/server";
import { getIndex, readRaw, writeRaw } from "@/lib/wiki";
import { applyLinks, suggestLinks, type Suggestion } from "@/lib/autolink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — unlinked mentions of real pages in one page's prose. */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const relPath = new URL(request.url).searchParams.get("path");
    if (!relPath) return fail(new Error("Missing ?path"));

    const [raw, index] = await Promise.all([
      readRaw(vault.root, relPath),
      getIndex(vault.root),
    ]);
    const page = index.pages.find((p) => p.relPath === relPath);
    if (!page) return fail(new Error("Page is not in the vault index."), 404);

    const targets = index.pages.map((p) => {
      const alias = p.frontmatter?.aliases ?? p.frontmatter?.alias;
      const aliases = Array.isArray(alias)
        ? alias.filter((a): a is string => typeof a === "string")
        : typeof alias === "string"
          ? [alias]
          : [];
      return { id: p.id, title: p.title, relPath: p.relPath, aliases };
    });

    return Response.json({
      relPath,
      suggestions: suggestLinks(raw, page.id, targets, new Set(page.links)),
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/** POST — apply the chosen suggestions. */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as { path?: string; suggestions?: Suggestion[] };
    if (!body.path || !body.suggestions?.length) {
      return fail(new Error("Missing path or suggestions"));
    }

    const raw = await readRaw(vault.root, body.path);
    const next = applyLinks(raw, body.suggestions);
    if (next === raw) return Response.json({ ok: true, applied: 0 });

    await writeRaw(vault.root, body.path, next);
    return Response.json({ ok: true, applied: body.suggestions.length });
  } catch (error) {
    return fail(error);
  }
}
