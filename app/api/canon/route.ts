import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { addCanon, canonViolations, readCanon, removeCanon } from "@/lib/canon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the canon list, and every page that currently disagrees with it. */
export async function GET() {
  try {
    const vault = await requireVault();
    const [facts, index] = await Promise.all([readCanon(vault.root), getIndex(vault.root)]);
    const violations = canonViolations(
      facts,
      index.pages.map((p) => ({
        id: p.id,
        relPath: p.relPath,
        title: p.title,
        plain: p.plain,
        mtime: p.mtime,
      })),
    );
    return Response.json({ facts, violations });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json().catch(() => ({}))) as {
      action?: "add" | "remove";
      text?: string;
      pageId?: string;
      id?: string;
    };
    const facts =
      body.action === "remove"
        ? await removeCanon(vault.root, String(body.id ?? ""))
        : await addCanon(vault.root, String(body.text ?? ""), body.pageId);
    return Response.json({ facts });
  } catch (error) {
    return fail(error);
  }
}
