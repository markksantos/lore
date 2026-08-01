/**
 * The Node-only half of instrumentation.ts — see there for why this exists.
 * Split into its own module because Next also compiles instrumentation for the
 * edge runtime, and the bundler statically rejects `process.on` there even
 * behind a runtime guard. The dynamic import in register() is the sanctioned
 * per-runtime split.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".lore");
const log = (kind: string, error: unknown) => {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const line = `${new Date().toISOString()} ${kind}: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`;
    appendFileSync(join(dir, "server-errors.log"), line, "utf8");
  } catch {
    // Logging must never be the thing that throws.
  }
};

process.on("unhandledRejection", (reason) => log("unhandledRejection", reason));
process.on("uncaughtException", (error) => log("uncaughtException", error));

// Fire-and-forget warm-up. Failure is fine — the first request will simply pay
// the old cost — but it must never prevent boot.
void (async () => {
  try {
    const { getActiveVault } = await import("@/lib/config");
    const { getIndex } = await import("@/lib/wiki");
    const vault = await getActiveVault();
    if (vault) await getIndex(vault.root);
  } catch (error) {
    log("warmup", error);
  }
})();
