import {
  linkVault,
  readConfig,
  setActiveVault,
  suggestVaults,
  unlinkVault,
} from "@/lib/config";
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
    const body = (await request.json()) as { action?: string; path?: string; root?: string };

    switch (body.action) {
      case "link": {
        const vault = await linkVault(body.path ?? "");
        return Response.json({ vault });
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
