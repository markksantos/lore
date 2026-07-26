import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fail } from "@/lib/server";

const run = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open a real folder picker.
 *
 * Typing a filesystem path into a text box is the worst thing in this app, and
 * the browser cannot fix it: the File System Access API is Chrome/Edge only
 * (~29% of browsers), Safari will never ship it, Firefox has declared it
 * harmful, and its handles expose no path — so a vault chosen that way could
 * not be handed to the MCP server or written to Lore's config.
 *
 * Since Lore's server runs on the user's own machine, it can just ask the OS.
 * This is the entire benefit people package an Electron app to get, available
 * today for twenty lines and no build pipeline.
 *
 * Returns 501 rather than an error on unsupported platforms so the UI can fall
 * back to the text field without treating it as a failure.
 */
export async function POST() {
  if (process.platform !== "darwin") {
    return Response.json(
      { unsupported: true, reason: "The native picker is macOS-only for now." },
      { status: 501 },
    );
  }

  try {
    // `choose folder` returns an AppleScript alias; POSIX path converts it to a
    // plain path. Errors are swallowed to `` so a cancelled dialog is a normal
    // outcome rather than a non-zero exit we would have to parse.
    const script = `try
  set f to choose folder with prompt "Choose your wiki folder"
  return POSIX path of f
on error
  return ""
end try`;

    const { stdout } = await run("osascript", ["-e", script], { timeout: 120_000 });
    const picked = stdout.trim().replace(/\/$/, "");
    return Response.json(picked ? { path: picked } : { cancelled: true });
  } catch (error) {
    return fail(error, 500);
  }
}
