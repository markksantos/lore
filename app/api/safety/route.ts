import { fail } from "@/lib/server";
import { readSafety, writeSafety, VAULT_WRITERS } from "@/lib/safety";
import { recordActivity } from "@/lib/collab";
import { readConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The read-only switch.
 *
 * Returns the list of routes the lock covers as well as its state, so the
 * Settings screen can show what is actually blocked rather than asking the user
 * to trust a sentence.
 */
export async function GET() {
  try {
    const safety = await readSafety();
    return Response.json({
      ...safety,
      blocks: Object.entries(VAULT_WRITERS).map(([route, methods]) => ({ route, methods })),
    });
  } catch (error) {
    return fail(error, 409);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { readOnly?: boolean };
    if (typeof body.readOnly !== "boolean") return fail(new Error("readOnly must be a boolean."));

    const safety = await writeSafety(body.readOnly);

    // Worth a line in the activity feed either way. Unlocking a wiki is exactly
    // the kind of thing you want a record of having done.
    const config = await readConfig();
    if (config.activeVault) {
      await recordActivity(config.activeVault, {
        kind: body.readOnly ? "quarantined" : "released",
        by: "me",
        pageId: null,
        relPath: null,
        detail: body.readOnly ? "read-only mode on" : "read-only mode off — Lore can write",
      }).catch(() => {});
    }

    return Response.json({ ok: true, ...safety });
  } catch (error) {
    return fail(error);
  }
}
