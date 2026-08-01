import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";

/**
 * Pages and folders you never want in the brief again.
 *
 * Some directories are noise forever. A `sessions/` folder that gains a page
 * every time an agent runs, a `raw/captures/` dump, an export job — all of them
 * are legitimate writes and none of them is news, and no ranking heuristic can
 * know that because the distinction is about what YOU care about, not about the
 * text.
 *
 * The alternative to this is worse than it looks: a brief that keeps surfacing
 * something you have deliberately ignored six times is a brief you stop
 * reading, and then every other item in it is lost too.
 *
 * Prefixes, so muting `sessions/` mutes everything under it. Stored outside the
 * vault, like everything else that is about how you read the wiki rather than
 * what is in it.
 */

const DIR = path.join(os.homedir(), ".lore");
const filePath = (key: string) => path.join(DIR, `muted-${key}.json`);

export async function readMuted(root: string): Promise<string[]> {
  const raw = await fs.readFile(filePath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function toggleMuted(root: string, prefix: string): Promise<string[]> {
  const trimmed = prefix.trim();
  if (!trimmed) return readMuted(root);
  const current = await readMuted(root);
  const next = current.includes(trimmed)
    ? current.filter((p) => p !== trimmed)
    : [...current, trimmed];
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath(vaultKey(root)), JSON.stringify(next), "utf8").catch(() => {});
  return next;
}

export const isMuted = (muted: string[], relPath: string) =>
  muted.some((prefix) => relPath === prefix || relPath.startsWith(prefix));
