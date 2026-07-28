import { promises as fs } from "node:fs";
import path from "node:path";

import { STARTER_FOLDERS, starterFiles } from "@/lib/starter-files";

/**
 * Write a starter wiki to a path on disk.
 *
 * The pages themselves are in lib/starter-files, which has no filesystem in it
 * so the browser build creates exactly the same wiki.
 */

export type Created = { root: string; files: string[] };

export async function createStarterVault(root: string, name: string): Promise<Created> {
  // Refuse to write into somewhere that already has content. Scaffolding on top
  // of an existing folder is how you end up with an index.md that overwrites
  // one someone wrote.
  const existing = await fs.readdir(root).catch(() => null);
  if (existing?.some((entry) => !entry.startsWith("."))) {
    throw new Error(`${root} is not empty. Link it instead of creating a new wiki there.`);
  }

  await fs.mkdir(root, { recursive: true });
  for (const folder of STARTER_FOLDERS) {
    await fs.mkdir(path.join(root, folder), { recursive: true });
  }

  const files: string[] = [];
  for (const { relPath, body } of starterFiles(name)) {
    const absolute = path.join(root, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, body, "utf8");
    files.push(relPath);
  }

  return { root, files };
}
