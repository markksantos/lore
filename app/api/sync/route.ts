import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { isRepo, sync } from "@/lib/git-native";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const vault = await requireVault();
    return Response.json({ repo: await isRepo(vault.root) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST — pull, then push.
 *
 * The honest answer to "sync my wiki between machines" is a git remote, not a
 * service of ours holding a copy of somebody's private notes. The index is
 * rebuilt afterwards because a pull can change every page on disk without a
 * single filesystem event the watcher would recognise as a write.
 */
export async function POST() {
  try {
    const vault = await requireVault();
    const result = await sync(vault.root);
    if (result.pulled) await getIndex(vault.root, true);
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
