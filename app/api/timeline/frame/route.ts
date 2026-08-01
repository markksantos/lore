import { promises as fs } from "node:fs";
import { fail, requireVault } from "@/lib/server";
import { frameFor } from "@/lib/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One captured frame, by uuid.
 *
 * Never by path: an endpoint that accepts a path and serves the file is a
 * read primitive over the whole disk wearing a timeline costume. The uuid is
 * resolved through the recorder's own database and the result must live
 * inside the recorder's store — both enforced in lib/timeline.
 */
export async function GET(request: Request) {
  try {
    await requireVault();
    const uuid = new URL(request.url).searchParams.get("uuid") ?? "";
    const file = await frameFor(uuid);
    if (!file) return fail(new Error("No such frame."), 404);
    const bytes = await fs.readFile(file);
    const type = file.endsWith(".png") ? "image/png" : file.endsWith(".heic") ? "image/heic" : "image/jpeg";
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": type, "cache-control": "private, max-age=3600" },
    });
  } catch (error) {
    return fail(error, 404);
  }
}
