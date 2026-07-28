import { fail, requireVault } from "@/lib/server";
import { createPage, getIndex } from "@/lib/wiki";
import { htmlToMarkdown, pdfToMarkdown, structureTranscript, toPage } from "@/lib/ingest";
import { slugify } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turn an outside thing into a page.
 *
 *   { kind: "url",        url }              — fetch and convert
 *   { kind: "html",       html, source }     — convert HTML the caller already has
 *   { kind: "transcript", text, title }      — group a transcript by speaker
 *   { kind: "text",       text, title }      — take markdown or plain text as-is
 *
 * `kind: "html"` is what a browser extension uses: the page is already rendered
 * in the tab, so sending its HTML captures what the reader actually saw,
 * including anything behind a login that a server-side fetch would never get.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();

    /*
     * A PDF arrives as multipart rather than JSON, because base64 in a JSON body
     * inflates a 20MB document to 27MB of string that has to be parsed whole.
     */
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) return fail(new Error("Missing file"));
      if (file.size > 40 * 1024 * 1024) return fail(new Error("PDFs are capped at 40MB."), 413);

      const bytes = new Uint8Array(await file.arrayBuffer());
      // Magic bytes, not the filename: %PDF-
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        return fail(new Error("That is not a PDF."), 415);
      }

      const name = (form.get("title") as string | null)?.trim();
      const filename = file instanceof File ? file.name.replace(/\.pdf$/i, "") : "";
      const pdf = await pdfToMarkdown(bytes, name || filename || "Untitled PDF").catch(
        (error: unknown) => {
          throw new Error(
            `Could not read that PDF: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        },
      );
      // Parenthesised deliberately: ?? binds tighter than ?:, so the obvious
      // one-liner silently discards a supplied source and always uses the
      // filename.
      const supplied = (form.get("source") as string | null)?.trim();
      pdf.source = supplied || (filename ? `${filename}.pdf` : null);

      if (!pdf.markdown.trim()) {
        // A scanned PDF has no text layer at all. Saying so beats writing an
        // empty page and letting the user wonder what happened.
        return fail(
          new Error("That PDF has no text layer — it is probably a scan, and would need OCR."),
          422,
        );
      }
      return await createFromIngested(vault.root, pdf, "inbox", ["pdf"]);
    }

    const body = (await request.json()) as {
      kind?: string;
      url?: string;
      html?: string;
      text?: string;
      title?: string;
      source?: string;
      folder?: string;
      tags?: string[];
    };

    let ingested;
    switch (body.kind) {
      case "url": {
        if (!body.url) return fail(new Error("Missing url"));
        let target: URL;
        try {
          target = new URL(body.url);
        } catch {
          return fail(new Error("That is not a URL."));
        }
        // Only http(s), and never a loopback or private address: this endpoint
        // would otherwise be a server-side request forgery hole, reachable from
        // anything that can reach the app.
        if (!/^https?:$/.test(target.protocol)) {
          return fail(new Error("Only http and https URLs can be captured."));
        }
        if (
          /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(target.hostname) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(target.hostname)
        ) {
          return fail(new Error("Refusing to fetch a private or loopback address."));
        }

        const response = await fetch(target, {
          headers: { "user-agent": "Lore/0.1 (wiki capture)" },
          signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
        if (!response?.ok) return fail(new Error("Could not fetch that page."), 502);

        ingested = htmlToMarkdown(await response.text());
        ingested.source = target.toString();
        break;
      }

      case "html": {
        if (!body.html) return fail(new Error("Missing html"));
        ingested = htmlToMarkdown(body.html);
        ingested.source = body.source ?? null;
        if (body.title) ingested.title = body.title;
        break;
      }

      case "transcript": {
        if (!body.text) return fail(new Error("Missing text"));
        ingested = structureTranscript(body.text, body.title?.trim() || "Transcript");
        ingested.source = body.source ?? null;
        break;
      }

      case "text": {
        if (!body.text) return fail(new Error("Missing text"));
        ingested = {
          title: body.title?.trim() || "Untitled",
          markdown: body.text,
          source: body.source ?? null,
        };
        break;
      }

      default:
        return fail(new Error("kind must be url, html, transcript or text."));
    }

    if (!ingested.markdown.trim()) {
      return fail(new Error("Nothing readable came out of that."), 422);
    }

    return await createFromIngested(vault.root, ingested, body.folder ?? "inbox", body.tags ?? []);
  } catch (error) {
    return fail(error);
  }
}

/** Shared by every kind: pick a free path, write the page, report it. */
async function createFromIngested(
  root: string,
  ingested: { title: string; markdown: string; source: string | null },
  folderInput: string,
  tags: string[],
) {
  const folder = folderInput.replace(/^\/+|\/+$/g, "");

  // Never overwrite. A capture landing on an existing page would destroy
  // whatever was there, and the second capture of a page is common.
  const index = await getIndex(root);
  const taken = new Set(index.pages.map((p) => p.relPath));
  const slug = slugify(ingested.title);
  let relPath = folder ? `${folder}/${slug}.md` : `${slug}.md`;
  for (let n = 2; taken.has(relPath); n++) {
    relPath = folder ? `${folder}/${slug}-${n}.md` : `${slug}-${n}.md`;
  }

  await createPage(root, relPath, toPage(ingested, tags));
  const fresh = await getIndex(root, true);

  return Response.json({
    ok: true,
    relPath,
    title: ingested.title,
    pageId: fresh.pages.find((p) => p.relPath === relPath)?.id ?? null,
    words: ingested.markdown.split(/\s+/).length,
  });
}
