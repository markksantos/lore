import { fail, requireVault, toMeta } from "@/lib/server";
import { readPolicy } from "@/lib/policy";
import { currentVersion, expiryOf, supersessions } from "@/lib/page-facts";
import { markSeen } from "@/lib/seen";
import { readLedger, trustOf } from "@/lib/verify";
import crypto from "node:crypto";
import { recordAttribution } from "@/lib/harness";
import { createPage, deletePage, getIndex, readRaw, writeRaw } from "@/lib/wiki";
import {
  creationsBy,
  recordCreation,
  reviewWrite,
  type WriteFeedback,
} from "@/lib/write-feedback";

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

    /*
     * Trust travels with the page.
     *
     * Without this the model has no way to know a page is unverified, so it
     * cannot weigh a fact a human confirmed against one an agent guessed at in
     * April — which is the entire premise of the product, withheld from the one
     * reader that could act on it. It costs one ledger read.
     */
    const ledger = await readLedger(vault.root);
    const hash = crypto.createHash("sha1").update(page.plain).digest("hex").slice(0, 16);
    const trust = trustOf(ledger, page.id, hash, Date.now(), policy.decayDays);

    /*
     * Opening a page is the strongest possible signal that you now know what is
     * on it, so the brief should stop offering it to you. Recorded here rather
     * than in the client because every surface that opens a page — the brief,
     * search, Ask's citations, a wikilink — comes through this one route.
     */
    void markSeen(vault.root, [page.id]).catch(() => {});

    /*
     * Two things the page cannot say about itself.
     *
     * A page that has been replaced looks exactly like the page that replaced
     * it, and a fact that expired last month reads exactly as it did the day it
     * was written. Both are the failure mode a wiki is worst at — being
     * confidently out of date — and both are knowable here, from frontmatter
     * the author wrote precisely so somebody would act on it.
     */
    const supersededBy = currentVersion(page.id, supersessions(index));
    const expires = expiryOf(page);

    const backlinkIds = index.backlinks[page.id] ?? [];
    return Response.json({
      trust,
      verifiedAt: ledger[page.id]?.at ?? null,
      supersededBy: supersededBy
        ? {
            pageId: supersededBy.newId,
            relPath: supersededBy.newRelPath,
            title: supersededBy.newTitle,
          }
        : null,
      expires,
      expired: expires !== null && expires <= Date.now(),
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

/**
 * POST — create a page, or write to one on behalf of an agent.
 *
 * Without `mode` this is the original create-only behaviour, which fails rather
 * than overwriting. With `mode` it is the endpoint behind the `wiki_write` MCP
 * tool, and the two rules that make that safe are here:
 *
 * `append` is the default and never touches existing prose. Measured on a real
 * vault, 60 of 75 modified files were in-place rewrites — the destructive kind —
 * so the safe mode has to be the one you get by not thinking about it.
 *
 * Every write is attributed. It is NOT gated, because gating was tried and does
 * not work; attribution is what survives, and it is what makes Review able to
 * say which agent did this rather than shrugging.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const {
      path: relPath,
      content,
      mode,
      agent,
      session,
      url,
    } = (await request.json()) as {
      path?: string;
      content?: string;
      mode?: "append" | "replace";
      agent?: string;
      session?: string;
      url?: string;
    };
    if (!relPath) return fail(new Error("Missing path"));

    if (mode) {
      const policy = await readPolicy(vault.root);
      const index = await getIndex(vault.root);
      const existing = index.pages.find((p) => p.relPath === relPath);

      // Quarantine withholds a page from agents in both directions. Letting an
      // agent rewrite the page a human just flagged as wrong would defeat the
      // entire point of flagging it.
      if (existing && policy.quarantined.includes(existing.id)) {
        return fail(new Error("That page is quarantined and cannot be written to."), 409);
      }

      const before = await readRaw(vault.root, relPath).catch(() => null);
      const body = content ?? "";
      const next =
        mode === "replace" || before === null
          ? body
          : `${before.replace(/\s*$/, "")}\n\n${body.trim()}\n`;

      if (before === null) await createPage(vault.root, relPath, next);
      else await writeRaw(vault.root, relPath, next);

      // The watcher journals the change itself; this records WHO, which the
      // filesystem cannot know.
      await recordAttribution({
        at: Date.now(),
        file: `${vault.root}/${relPath}`,
        agent: agent?.trim() || "MCP agent",
        tool: `wiki_write:${mode}`,
        session: session?.trim() || undefined,
        url: url?.trim() || undefined,
      });

      const fresh = await getIndex(vault.root, true);
      const page = fresh.pages.find((p) => p.relPath === relPath);

      /*
       * Say something back.
       *
       * This is the whole reason the write path exists as an endpoint rather
       * than a file write: the author is still on the line. Every check Lore
       * can compute — contradictions, duplicates, orphaning, schema drift —
       * runs now and returns with the result, where a model can act on it in
       * the same turn. Afterwards the same information is a chore for a human.
       *
       * Never fatal. The write has already happened, and a page that landed
       * must not report failure because the advice about it could not be
       * computed.
       */
      const who = agent?.trim() || "MCP agent";
      if (before === null) recordCreation(who, relPath);

      let feedback: WriteFeedback = { notes: [], text: "" };
      try {
        feedback = reviewWrite({
          index: fresh,
          relPath,
          content: next,
          schema: await readRaw(vault.root, "SCHEMA.md").catch(() => null),
          sessionPages: creationsBy(who),
        });
      } catch {
        // Advice is best-effort; the write is not.
      }

      return Response.json({
        ok: true,
        path: relPath,
        mode,
        created: before === null,
        page: page ? { id: page.id, title: page.title } : null,
        trust: "unverified",
        notes: feedback.notes,
        notesText: feedback.text,
      });
    }

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
