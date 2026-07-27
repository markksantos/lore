import path from "node:path";
import { getActiveVault } from "@/lib/config";
import { fail, requireVault } from "@/lib/server";
import {
  detectHarnesses,
  hookCommand,
  installClaudeCodeHook,
  installMcpConfig,
  mcpServerEntry,
  recordAttribution,
  HOOK_MATCHER,
  MCP_TARGET_LABEL,
  MCP_TARGETS,
  type McpTarget,
} from "@/lib/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What is wired up on this machine, read from disk on every request.
 *
 * Two things are added on top of `detectHarnesses()`, and both exist so the
 * Connections screen never has to reimplement server knowledge in the browser:
 * which installer each row maps to, and the exact JSON the installer would
 * write — so the copy-paste fallback is guaranteed to be the same wiring, not
 * a second copy that can drift.
 */
export async function GET() {
  try {
    const statuses = await detectHarnesses();
    const byLabel = new Map(MCP_TARGETS.map((t) => [MCP_TARGET_LABEL[t], t]));

    const harnesses = statuses.map((status) => {
      const target = byLabel.get(status.name);
      return target
        ? { ...status, action: "install-mcp" as const, target }
        : { ...status, action: "install-hook" as const };
    });

    const root = (await getActiveVault())?.root ?? "/path/to/your/vault";
    return Response.json({
      harnesses,
      snippets: {
        mcp: JSON.stringify({ mcpServers: { lore: mcpServerEntry(process.cwd()) } }, null, 2),
        hook: JSON.stringify(
          {
            hooks: {
              PostToolUse: [
                { matcher: HOOK_MATCHER, hooks: [{ type: "command", command: hookCommand(root) }] },
              ],
            },
          },
          null,
          2,
        ),
      },
    });
  } catch (error) {
    return fail(error, 500);
  }
}

const TARGETS: McpTarget[] = MCP_TARGETS;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Two callers share this verb, and they are told apart by whether the body
 * carries an `action`:
 *
 *  - the Connections screen, asking for an installer to run
 *  - the Claude Code PostToolUse hook, reporting a write
 *
 * The hook is the load-bearing one. It runs inside the user's agent loop after
 * every single file edit, so it must never fail loudly, never block, and never
 * return anything worth parsing — hence 204 on every path, including malformed
 * bodies and writes we deliberately ignore.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const body: unknown = await request.json().catch(() => null);

  if (isRecord(body) && typeof body.action === "string") {
    try {
      if (body.action === "install-hook") {
        const vault = await requireVault();
        return Response.json(await installClaudeCodeHook(vault.root));
      }
      if (body.action === "install-mcp") {
        const target = body.target;
        if (typeof target !== "string" || !TARGETS.includes(target as McpTarget)) {
          return fail(new Error("Unknown MCP target."));
        }
        // The install directory is this app's own location; taking it from the
        // request would let a stray caller write any command into the config.
        return Response.json(await installMcpConfig(target as McpTarget, process.cwd()));
      }
      return fail(new Error("Unknown action."));
    } catch (error) {
      return fail(error, 409);
    }
  }

  await recordHookCall(body, url).catch(() => {});
  return new Response(null, { status: 204 });
}

/**
 * Claude Code pipes its own payload shape to the hook (`tool_name`,
 * `tool_input.file_path`); the flatter `{tool, file, agent}` is what anything
 * else posting here should send. Accept both rather than making the hook
 * command do JSON surgery in the shell.
 */
async function recordHookCall(body: unknown, url: URL): Promise<void> {
  if (!isRecord(body)) return;

  const input = isRecord(body.tool_input) ? body.tool_input : {};
  const file = typeof body.file === "string" ? body.file : typeof input.file_path === "string" ? input.file_path : null;
  if (!file) return;

  const tool =
    typeof body.tool === "string"
      ? body.tool
      : typeof body.tool_name === "string"
        ? body.tool_name
        : "write";
  const agent =
    typeof body.agent === "string" ? body.agent : (url.searchParams.get("agent") ?? "unknown");

  // Agents write far more than wiki pages. Scoping to the vault keeps this a
  // record of who edited the wiki rather than a log of everything the user's
  // tools touched on this machine.
  const root = url.searchParams.get("vault") ?? (await getActiveVault())?.root ?? null;
  if (!root) return;
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;

  await recordAttribution({ at: Date.now(), file, agent, tool });
}
