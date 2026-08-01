import path from "node:path";
import { fail, requireVault } from "@/lib/server";
import {
  detectInstalled,
  installAll,
  type Harness,
  type InstallOptions,
} from "@/lib/install-pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN: Harness[] = ["claude-code", "claude-desktop", "cursor", "codex", "hermes"];

/** GET — which harnesses are on this machine. */
export async function GET() {
  try {
    return Response.json({ detected: await detectInstalled() });
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST — wire Lore into the agents on this machine.
 *
 * Lives behind the app rather than in the CLI because the CLI deliberately
 * reimplements nothing: a second copy of "where does Cursor keep its MCP
 * config" would drift from the first within a month, and then `lore install`
 * and the Connections screen would disagree about whether you were set up.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json().catch(() => ({}))) as {
      harnesses?: string[];
      scope?: string;
      hooks?: boolean;
      dryRun?: boolean;
      port?: number;
    };

    const requested = (body.harnesses ?? []).filter((h): h is Harness =>
      KNOWN.includes(h as Harness),
    );
    const harnesses = requested.length ? requested : await detectInstalled();

    const options: InstallOptions = {
      // The app runs from `.next/standalone` in a packaged build and from the
      // repo in development; `process.cwd()` is the project root in both.
      installDir: path.resolve(process.cwd()),
      vaultRoot: vault.root,
      port: Number(body.port) || 4646,
      scope: body.scope?.trim() || undefined,
      hooks: body.hooks !== false,
      dryRun: body.dryRun === true,
    };

    return Response.json({ results: await installAll(harnesses, options) });
  } catch (error) {
    return fail(error);
  }
}
