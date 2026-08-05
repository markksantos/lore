import { promises as fs } from "node:fs";
import { fail } from "@/lib/server";
import { framePath, ghostDb } from "@/lib/ghost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve one captured frame.
 *
 * The path is never taken from the request. A caller supplies a row id, the
 * database supplies the filename, and `framePath` still re-checks that the
 * result is inside the frames directory — because a value that came from our
 * own table is only trustworthy until something else can write to that table,
 * and "the id is a number" is a much easier invariant to keep than "no column
 * anywhere ever contains `../`".
 *
 * Frames are private by construction: this route is under /api, so the proxy's
 * loopback and CSRF guards already apply, and nothing here adds a cache header
 * that would leave a screenshot of someone's banking tab in a shared cache.
 */
export async function GET(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return fail(new Error("`id` must be a frame id."));

    const row = ghostDb().get<{ file: string }>("SELECT file FROM frames WHERE id = ?", id);
    if (!row) return fail(new Error("No such frame."), 404);

    const full = framePath(row.file);
    if (!full) return fail(new Error("That frame is outside the frame store."), 400);

    const image = await fs.readFile(full).catch(() => null);
    if (!image) return fail(new Error("That frame has been deleted."), 404);

    return new Response(new Uint8Array(image), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(image.length),
        /* Immutable because a frame id never points at different pixels, and
           private because these pixels are the inside of someone's screen. */
        "cache-control": "private, max-age=86400, immutable",
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
