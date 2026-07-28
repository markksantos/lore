import {
  expandPath,
  linkVault,
  readConfig,
  setActiveVault,
  suggestVaults,
  unlinkVault,
} from "@/lib/config";
import { createStarterVault } from "@/lib/starter";
import path from "node:path";
import { fail } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await readConfig();
    // Suggestions only matter on first run; skip the disk probe once a vault
    // is already linked.
    const suggestions = config.vaults.length ? [] : await suggestVaults();
    return Response.json({ ...config, suggestions });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      path?: string;
      root?: string;
      name?: string;
    };

    switch (body.action) {
      case "link": {
        const vault = await linkVault(body.path ?? "");
        return Response.json({ vault });
      }
      /*
       * Create a wiki for someone who does not have one.
       *
       * Deliberately NOT gated by read-only mode. The lock protects an existing
       * wiki from being changed; this creates a new folder that contains nothing
       * to protect, and refusing it would leave a first-run user unable to start
       * without first turning off the safety they were just told to keep on.
       */
      case "create": {
        const target = expandPath(body.path ?? "");
        if (!target) return fail(new Error("Choose where the wiki should live."));
        const name = body.name?.trim() || path.basename(target) || "My wiki";
        const created = await createStarterVault(target, name);
        const vault = await linkVault(created.root);
        await setActiveVault(vault.root);
        return Response.json({ vault, created: created.files });
      }
      case "activate": {
        await setActiveVault(body.root ?? "");
        return Response.json({ ok: true });
      }
      case "unlink": {
        await unlinkVault(body.root ?? "");
        return Response.json({ ok: true });
      }
      default:
        return fail(new Error(`Unknown action: ${body.action ?? "(none)"}`));
    }
  } catch (error) {
    return fail(error);
  }
}
