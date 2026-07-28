import { promises as fs } from "node:fs";
import path from "node:path";
import {
  MARKDOWN,
  SKIP_DIRS,
  buildIndex,
  ignored,
  parseIgnore,
  parsePage,
  searchIndex,
  type SearchHit,
  type WikiIndex,
  type WikiPage,
} from "@/lib/index-core";
import { renderHealth, type HealthReport, type WindowResolver } from "@/lib/health-core";

export type { SearchHit, WikiIndex, WikiPage };
export type { HealthReport, WindowResolver };
export { renderHealth };

// The wiki engine. Everything here reads and writes the user's own markdown
// files in place — Lore never imports a vault into its own store, never
// rewrites formatting it wasn't asked to touch, and never owns the data. If
// you delete Lore, the wiki is exactly as it was.

export function resolveInVault(root: string, relPath: string): string {
  const absolute = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    throw new Error("Path escapes the vault.");
  }
  return absolute;
}

const toPosix = (p: string) => p.split(path.sep).join("/");

// ------------------------------------------------------------------ scanning

async function walk(
  root: string,
  dir: string,
  out: string[],
  patterns: RegExp[] = [],
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = toPosix(path.relative(root, abs));
    if (ignored(patterns, rel)) continue;
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      await walk(root, abs, out, patterns);
    } else if (entry.isFile() && MARKDOWN.test(entry.name)) {
      out.push(rel);
    }
  }
}

async function readPage(root: string, relPath: string): Promise<WikiPage> {
  const abs = resolveInVault(root, relPath);
  const [raw, stat] = await Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]);
  return parsePage(relPath, raw, stat.mtimeMs);
}

// -------------------------------------------------------------------- index

type CacheEntry = { index: WikiIndex; builtAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 4000;

export function invalidateVault(root: string): void {
  cache.delete(root);
}

export async function getIndex(root: string, force = false): Promise<WikiIndex> {
  const cached = cache.get(root);
  if (!force && cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached.index;

  const relPaths: string[] = [];
  const ignoreFile = await fs
    .readFile(path.join(root, ".loreignore"), "utf8")
    .catch(() => "");
  await walk(root, root, relPaths, parseIgnore(ignoreFile));

  const pages: WikiPage[] = [];
  const errors: { relPath: string; message: string }[] = [];
  for (const relPath of relPaths) {
    try {
      pages.push(await readPage(root, relPath));
    } catch (error) {
      errors.push({
        relPath,
        message: error instanceof Error ? error.message : "Unreadable file",
      });
    }
  }

  const index = buildIndex(root, pages, errors);
  cache.set(root, { index, builtAt: Date.now() });
  return index;
}

// ---------------------------------------------------------------- read/write

export async function readRaw(root: string, relPath: string): Promise<string> {
  return fs.readFile(resolveInVault(root, relPath), "utf8");
}

export async function writeRaw(root: string, relPath: string, content: string): Promise<void> {
  const abs = resolveInVault(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  invalidateVault(root);
}

export async function createPage(
  root: string,
  relPath: string,
  content: string,
): Promise<string> {
  const withExt = MARKDOWN.test(relPath) ? relPath : `${relPath}.md`;
  const abs = resolveInVault(root, withExt);
  // `wx` fails rather than clobbering an existing note.
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const handle = await fs.open(abs, "wx");
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  invalidateVault(root);
  return toPosix(path.relative(root, abs));
}

export async function deletePage(root: string, relPath: string): Promise<void> {
  await fs.unlink(resolveInVault(root, relPath));
  invalidateVault(root);
}

// ------------------------------------------------------------------- search

/** Ranked search over the vault's current index. See lib/index-core. */
export async function search(root: string, query: string, limit = 40): Promise<SearchHit[]> {
  return searchIndex(await getIndex(root), query, limit);
}

// -------------------------------------------------------------------- health

/** Wiki health for a vault on disk. The computation lives in lib/health-core. */
export async function health(root: string, resolveWindow?: WindowResolver): Promise<HealthReport> {
  return renderHealth(await getIndex(root), resolveWindow);
}

// --------------------------------------------------------- agent-facing view

/**
 * The map an agent reads first: every page, its folder, tags and one-line
 * summary, small enough to fit in a context window. This is the artefact that
 * makes a wiki usable by an agent — without it, an agent either reads
 * everything (too many tokens) or greps blind (misses the right page).
 */
export async function buildAgentIndex(root: string, vaultName: string): Promise<string> {
  const index = await getIndex(root);
  const lines: string[] = [];

  lines.push(`# ${vaultName} — wiki index`);
  lines.push("");
  lines.push(
    `${index.pages.length} pages. Generated by Lore. Read this map first, then open only the pages you need.`,
  );
  lines.push("");
  lines.push(`Vault root: \`${root}\``);
  lines.push("");

  const byFolder = new Map<string, WikiPage[]>();
  for (const page of index.pages) {
    byFolder.set(page.folder, [...(byFolder.get(page.folder) ?? []), page]);
  }

  for (const folder of [...byFolder.keys()].sort()) {
    lines.push(`## ${folder || "(root)"}`);
    lines.push("");
    for (const page of byFolder.get(folder)!) {
      const tags = page.tags.length ? ` — tags: ${page.tags.map((t) => `#${t}`).join(" ")}` : "";
      const summary = page.excerpt ? ` — ${page.excerpt.slice(0, 120)}` : "";
      lines.push(`- \`${page.relPath}\` — **${page.title}**${tags}${summary}`);
    }
    lines.push("");
  }

  if (index.tags.length) {
    lines.push("## Tags");
    lines.push("");
    lines.push(index.tags.map((t) => `#${t.tag} (${t.count})`).join(" · "));
    lines.push("");
  }

  return lines.join("\n");
}
