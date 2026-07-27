import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { resolveInVault } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attachments.
 *
 * Pasting a screenshot into a note is the single most common thing a markdown
 * editor cannot do, and the workaround — save it somewhere, find the path, type
 * a link — is slow enough that people simply do not include the picture.
 *
 * Files land in `assets/` inside the vault, because an attachment IS the user's
 * content and belongs with it: their wiki should still make sense opened in
 * Obsidian, committed to git, or synced to another machine, with no dependence
 * on Lore's private directory.
 *
 * Named by content hash. Pasting the same screenshot into three pages stores it
 * once, and a name can never collide with an existing file.
 */

const ASSET_DIR = "assets";
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Extension by magic bytes, not by the filename the browser supplied.
 *
 * A paste has no filename at all, and a supplied one is attacker-controlled —
 * writing `.html` or `.svg` into a folder the app serves would be a stored-XSS
 * hole. Only these five sniff successfully; anything else is refused.
 */
function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return fail(new Error("Missing file"));
    if (file.size > MAX_BYTES) {
      return fail(new Error(`Attachments are capped at ${MAX_BYTES / 1024 / 1024}MB.`), 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = sniff(bytes);
    if (!ext) {
      return fail(new Error("Only PNG, JPEG, GIF, BMP and WebP images are accepted."), 415);
    }

    const hash = crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 16);
    const relPath = `${ASSET_DIR}/${hash}.${ext}`;
    const absolute = resolveInVault(vault.root, relPath);

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    // Written only if absent: identical content means an identical name, so a
    // rewrite would be pure churn and would touch the mtime for nothing.
    const already = await fs
      .access(absolute)
      .then(() => true)
      .catch(() => false);
    if (!already) await fs.writeFile(absolute, bytes);

    return Response.json({
      ok: true,
      relPath,
      reused: already,
      markdown: `![](${relPath})`,
    });
  } catch (error) {
    return fail(error);
  }
}

/** GET — serve an attachment back to the app. */
export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    const relPath = new URL(request.url).searchParams.get("path");
    if (!relPath) return fail(new Error("Missing ?path"));

    // resolveInVault throws on traversal, which is what stops ?path=../../.ssh
    const absolute = resolveInVault(vault.root, relPath);
    const ext = path.extname(absolute).slice(1).toLowerCase();
    const types: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      webp: "image/webp",
    };
    if (!types[ext]) return fail(new Error("Not an image."), 415);

    const bytes = await fs.readFile(absolute);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": types[ext],
        // Content-addressed names make this safe to cache forever.
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return fail(error, 404);
  }
}
