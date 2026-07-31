import { fail, requireVault } from "@/lib/server";
import { createPage, getIndex, readRaw } from "@/lib/wiki";
import { fill, readStore, targetPath, writeStore, type Store } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — templates, saved searches, and today's daily-note path. */
export async function GET() {
  try {
    const vault = await requireVault();
    const store = await readStore(vault.root);
    const daily = store.templates.find((t) => t.id === store.dailyTemplateId);
    const now = new Date();

    return Response.json({
      ...store,
      dailyPath: daily ? targetPath(daily, now.toISOString().slice(0, 10), now) : null,
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/** PUT — replace the whole store. */
export async function PUT(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as Partial<Store>;
    const current = await readStore(vault.root);
    const next: Store = {
      templates: body.templates ?? current.templates,
      searches: body.searches ?? current.searches,
      dailyFolder: body.dailyFolder ?? current.dailyFolder,
      dailyTemplateId: body.dailyTemplateId ?? current.dailyTemplateId,
    };
    await writeStore(vault.root, next);
    return Response.json({ ok: true, store: next });
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST — create a page from a template, or open today's daily note.
 *
 * Opening an existing daily note rather than failing is the whole point: the
 * button is pressed many times a day and only the first press creates anything.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as { templateId?: string; title?: string; daily?: boolean };
    const store = await readStore(vault.root);
    const now = new Date();

    const template = body.daily
      ? store.templates.find((t) => t.id === store.dailyTemplateId)
      : store.templates.find((t) => t.id === body.templateId);
    if (!template) return fail(new Error("No such template."), 404);

    const title = body.daily ? now.toISOString().slice(0, 10) : (body.title?.trim() ?? "");
    if (!title) return fail(new Error("Missing title"));

    const relPath = targetPath(template, title, now);

    const index = await getIndex(vault.root);
    const existing = index.pages.find((p) => p.relPath === relPath);
    if (existing) {
      return Response.json({
        ok: true,
        created: false,
        relPath,
        pageId: existing.id,
        raw: await readRaw(vault.root, relPath).catch(() => ""),
      });
    }

    await createPage(vault.root, relPath, fill(template.body, title, now));
    const fresh = await getIndex(vault.root, true);
    return Response.json({
      ok: true,
      created: true,
      relPath,
      pageId: fresh.pages.find((p) => p.relPath === relPath)?.id ?? null,
    });
  } catch (error) {
    return fail(error);
  }
}
