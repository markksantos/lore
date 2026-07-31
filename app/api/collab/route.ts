import { fail, requireVault } from "@/lib/server";
import { getIndex, readRaw } from "@/lib/wiki";
import {
  addComment,
  readActivity,
  readComments,
  readSections,
  readWebhooks,
  recordActivity,
  resolveComment,
  sectionHash,
  sections,
  writeSections,
  writeWebhooks,
  type Webhook,
} from "@/lib/collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Comments, activity, webhooks and per-section sign-off.
 *
 * Grouped behind one route with `?kind=` because they are one feature from the
 * user's side — the record of what people, rather than agents, did to this wiki.
 */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") ?? "all";

    if (kind === "sections") {
      const relPath = params.get("path");
      if (!relPath) return fail(new Error("sections needs ?path="));
      const index = await getIndex(vault.root);
      const page = index.pages.find((p) => p.relPath === relPath);
      if (!page) return fail(new Error("Page is not in the vault index."), 404);

      const ledger = await readSections(vault.root);
      const signed = ledger[page.id] ?? {};
      // Split the RAW source: `plain` has markdown stripped, so it contains no
      // headings at all and every page would report as one giant section.
      const raw = await readRaw(vault.root, relPath).catch(() => "");
      return Response.json({
        relPath,
        pageId: page.id,
        sections: sections(raw).map((s) => {
          const record = signed[s.heading];
          const hash = sectionHash(s.text);
          return {
            heading: s.heading,
            words: s.text.split(/\s+/).length,
            // Same rule as whole-page trust: a confirmation is pinned to the
            // content it confirmed, so a rewrite lapses it rather than
            // inheriting someone else's sign-off.
            state: !record ? "unverified" : record.hash === hash ? "verified" : "lapsed",
            at: record?.at ?? null,
            by: record?.by ?? null,
          };
        }),
      });
    }

    const [comments, activity, webhooks] = await Promise.all([
      readComments(vault.root),
      readActivity(vault.root),
      readWebhooks(vault.root),
    ]);

    if (kind === "comments") return Response.json({ comments });
    if (kind === "activity") return Response.json({ activity });
    if (kind === "webhooks") return Response.json({ webhooks });

    return Response.json({
      comments: comments.filter((c) => !c.resolvedAt),
      activity: activity.slice(0, 50),
      webhooks,
    });
  } catch (error) {
    return fail(error, 409);
  }
}

export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as {
      action?: string;
      pageId?: string;
      relPath?: string;
      body?: string;
      anchor?: string;
      by?: string;
      id?: string;
      heading?: string;
      signature?: string;
      webhooks?: Webhook[];
    };
    const by = body.by?.trim() || "me";

    switch (body.action) {
      case "comment": {
        if (!body.pageId || !body.body?.trim()) return fail(new Error("Missing pageId or body"));
        const comment = await addComment(vault.root, {
          pageId: body.pageId,
          relPath: body.relPath ?? "",
          by,
          body: body.body.trim(),
          anchor: body.anchor?.trim() || null,
        });
        await recordActivity(vault.root, {
          kind: "commented",
          by,
          pageId: body.pageId,
          relPath: body.relPath ?? null,
          detail: comment.body.slice(0, 120),
        });
        return Response.json({ ok: true, comment });
      }

      case "resolve": {
        if (!body.id) return fail(new Error("Missing id"));
        await resolveComment(vault.root, body.id, by);
        await recordActivity(vault.root, {
          kind: "resolved",
          by,
          pageId: body.pageId ?? null,
          relPath: body.relPath ?? null,
        });
        return Response.json({ ok: true });
      }

      case "verify-section": {
        if (!body.relPath || !body.heading) return fail(new Error("Missing relPath or heading"));
        const index = await getIndex(vault.root, true);
        const page = index.pages.find((p) => p.relPath === body.relPath);
        if (!page) return fail(new Error("Page is not in the vault index."), 404);

        const raw = await readRaw(vault.root, body.relPath).catch(() => "");
        const section = sections(raw).find((s) => s.heading === body.heading);
        if (!section) return fail(new Error("No section with that heading."), 404);

        const ledger = await readSections(vault.root);
        ledger[page.id] = {
          ...(ledger[page.id] ?? {}),
          [body.heading]: {
            hash: sectionHash(section.text),
            at: Date.now(),
            by,
            heading: body.heading,
            ...(body.signature ? { signature: body.signature } : {}),
          },
        };
        await writeSections(vault.root, ledger);
        await recordActivity(vault.root, {
          kind: "verified",
          by,
          pageId: page.id,
          relPath: page.relPath,
          detail: body.heading,
        });
        return Response.json({ ok: true, heading: body.heading, state: "verified" });
      }

      case "webhooks": {
        const hooks = (body.webhooks ?? [])
          // Only http(s), and never loopback: a webhook pointed back at the app
          // would let the activity log drive Lore's own API.
          .filter((h) => /^https?:\/\//.test(h.url))
          .filter((h) => !/^https?:\/\/(localhost|127\.|\[?::1)/i.test(h.url));
        await writeWebhooks(vault.root, hooks);
        return Response.json({ ok: true, webhooks: hooks });
      }

      default:
        return fail(new Error("Unknown action."));
    }
  } catch (error) {
    return fail(error);
  }
}
