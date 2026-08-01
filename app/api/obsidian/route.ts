import { promises as fs } from "node:fs";
import path from "node:path";
import { fail, requireVault } from "@/lib/server";
import { PLUGIN_ID, mainJs, manifest } from "@/lib/obsidian-plugin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pluginDir = (root: string) => path.join(root, ".obsidian", "plugins", PLUGIN_ID);

/** GET — is the plugin installed in this vault, and is this vault an Obsidian one? */
export async function GET() {
  try {
    const vault = await requireVault();
    const isObsidian = await fs
      .stat(path.join(vault.root, ".obsidian"))
      .then(() => true)
      .catch(() => false);
    const installed = await fs
      .stat(path.join(pluginDir(vault.root), "main.js"))
      .then(() => true)
      .catch(() => false);
    return Response.json({ isObsidian, installed, path: pluginDir(vault.root) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST — write the plugin into the vault.
 *
 * Into `.obsidian/plugins/`, which is where Obsidian looks and where it already
 * keeps its own state, so this adds nothing to the folder of notes the user
 * actually reads. It still has to be enabled by hand in Obsidian's settings:
 * silently enabling a plugin by editing `community-plugins.json` would be
 * turning on code in somebody's editor without asking, which is not a thing to
 * do from a different app.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const { port } = (await request.json().catch(() => ({}))) as { port?: number };

    const dir = pluginDir(vault.root);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "manifest.json"), manifest(), "utf8");
    await fs.writeFile(path.join(dir, "main.js"), mainJs(Number(port) || 4646), "utf8");

    return Response.json({
      ok: true,
      path: dir,
      next: "Open Obsidian → Settings → Community plugins → Reload, then enable Lore.",
    });
  } catch (error) {
    return fail(error);
  }
}
