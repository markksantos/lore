import { fail, requireVault, toMeta } from "@/lib/server";
import { readPolicy } from "@/lib/policy";
import { createPage, deletePage, getIndex, readRaw, writeRaw } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/page?path=notes/spec.md — raw markdown plus metadata and backlinks. */
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

    // Withheld rather than 404'd: an agent that gets "not found" concludes the
    // page does not exist and may helpfully write it again. Saying the page is
    // quarantined is both true and the only answer that stops that loop.
    const policy = await readPolicy(vault.root);
    if (policy.quarantined.includes(page.id)) {
      return Response.json(
        {
          quarantined: true,
          page: toMeta(page),
          error: "This page is quarantined pending human review and is not being served.",
        },
        { status: 409 },
      );
    }

    const backlinkIds = index.backlinks[page.id] ?? [];
    return Response.json({
      page: toMeta(page),
      frontmatter: page.frontmatter,
      raw,
      backlinks: index.pages.filter((p) => backlinkIds.includes(p.id)).map(toMeta),
      outgoing: index.pages.filter((p) => page.links.includes(p.id)).map(toMeta),
    });
  } catch (error) {
    return fail(error, 404);
  }
}

/** PUT — save an existing page in place. */
export async function PUT(request: Request) {
  try {
    const vault = await requireVault();
    const { path: relPath, content } = (await request.json()) as {
      path?: string;
      content?: string;
    };
    if (!relPath || typeof content !== "string") return fail(new Error("Missing path or content"));

    await writeRaw(vault.root, relPath, content);
    return Response.json({ ok: true, savedAt: Date.now() });
  } catch (error) {
    return fail(error);
  }
}

/** POST — create a new page; fails rather than overwriting an existing one. */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const { path: relPath, content } = (await request.json()) as {
      path?: string;
      content?: string;
    };
    if (!relPath) return fail(new Error("Missing path"));

    const created = await createPage(vault.root, relPath, content ?? "");
    return Response.json({ ok: true, path: created });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return fail(new Error("A page already exists at that path."), 409);
    }
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const vault = await requireVault();
    const relPath = new URL(request.url).searchParams.get("path");
    if (!relPath) return fail(new Error("Missing ?path"));

    await deletePage(vault.root, relPath);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
