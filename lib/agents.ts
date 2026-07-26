import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Which compatibility chips have a real brand mark on disk.
 *
 * Resolved on the server rather than probed from the browser: letting each chip
 * attempt an <img> and fall back on error costs a 404 per tool per page load,
 * and fills the console with failures that look like bugs. Reading the folder
 * once per request costs nothing and stays live — drop an SVG into
 * `public/assets/agents/` and the chip picks it up with no code change.
 */
export async function availableAgentLogos(): Promise<string[]> {
  const dir = path.join(process.cwd(), "public", "assets", "agents");
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  return entries
    .filter((name) => name.toLowerCase().endsWith(".svg"))
    .map((name) => name.replace(/\.svg$/i, ""));
}
