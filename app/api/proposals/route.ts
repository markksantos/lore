import { fail, requireVault } from "@/lib/server";
import {
  createProposal,
  diffStats,
  listProposals,
  resolveMany,
  resolveProposal,
} from "@/lib/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const vault = await requireVault();
    const proposals = await listProposals(vault.root);
    return Response.json({
      proposals: proposals.map((p) => ({
        ...p,
        stats: diffStats(p.base ?? "", p.proposed),
      })),
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/** Agents post here (or use the MCP server, which posts here for them). */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = await request.json();

    if (body.action === "accept" || body.action === "reject") {
      // `ids` is the bulk form behind Accept all / Reject all.
      if (Array.isArray(body.ids)) {
        const result = await resolveMany(vault.root, body.ids, body.action);
        return Response.json(result);
      }
      const proposal = await resolveProposal(vault.root, body.id, body.action);
      return Response.json({ proposal });
    }

    const proposal = await createProposal(vault.root, {
      relPath: body.path,
      agent: body.agent,
      reason: body.reason,
      kind: body.kind ?? "replace",
      risk: body.risk,
      content: body.content ?? "",
    });
    return Response.json({ proposal });
  } catch (error) {
    return fail(error);
  }
}
