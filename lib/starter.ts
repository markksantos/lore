import { promises as fs } from "node:fs";
import path from "node:path";

import { STARTER_FOLDERS, starterFiles } from "@/lib/starter-files";
import { kitById, kitFiles } from "@/lib/kits";

/**
 * Write a starter wiki to a path on disk.
 *
 * The pages themselves are in lib/starter-files, which has no filesystem in it
 * so the browser build creates exactly the same wiki.
 */

export type Created = { root: string; files: string[] };

export async function createStarterVault(
  root: string,
  name: string,
  /**
   * Which shape of wiki to build.
   *
   * The folder layout is the highest-leverage decision in a wiki agents write
   * to, because it decides what "same subject" means for retrieval scope,
   * contradiction detection, the brief's spread and prune's heuristic. Omitted
   * or unknown falls back to the original starter, so every existing caller
   * gets exactly what it got before.
   */
  kitId?: string,
): Promise<Created> {
  // Refuse to write into somewhere that already has content. Scaffolding on top
  // of an existing folder is how you end up with an index.md that overwrites
  // one someone wrote.
  const existing = await fs.readdir(root).catch(() => null);
  if (existing?.some((entry) => !entry.startsWith("."))) {
    throw new Error(`${root} is not empty. Link it instead of creating a new wiki there.`);
  }

  await fs.mkdir(root, { recursive: true });

  const kit = kitId && kitId !== "general" ? kitById(kitId) : null;
  const folders = kit ? kit.folders.map((f) => f.name) : STARTER_FOLDERS;
  for (const folder of folders) {
    await fs.mkdir(path.join(root, folder), { recursive: true });
  }

  const files: string[] = [];
  for (const { relPath, body } of kit ? kitFiles(kit, name) : starterFiles(name)) {
    const absolute = path.join(root, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, body, "utf8");
    files.push(relPath);
  }

  return { root, files };
}
