import { fail, requireVault } from "@/lib/server";
import { buildAgentIndex, getIndex } from "@/lib/wiki";
import { buildBudget } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many tokens it costs to hand any part of this wiki to an agent.
 *
 * Tokenizing a whole vault is not cheap, so this is the one endpoint that may
 * take a second on a large corpus. It is a page the user opens deliberately,
 * not something polled, so that is an acceptable trade for an accurate number.
 */
export async function GET() {
  try {
    const vault = await requireVault();
    const [index, agentIndex] = await Promise.all([
      getIndex(vault.root),
      buildAgentIndex(vault.root, vault.name),
    ]);
    return Response.json(
      buildBudget(
        index.pages.map((p) => ({
          id: p.id,
          title: p.title,
          folder: p.folder,
          text: p.plain,
        })),
        agentIndex,
      ),
    );
  } catch (error) {
    return fail(error, 409);
  }
}
