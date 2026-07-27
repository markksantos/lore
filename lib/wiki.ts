import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// The wiki engine. Everything here reads and writes the user's own markdown
// files in place — Lore never imports a vault into its own store, never
// rewrites formatting it wasn't asked to touch, and never owns the data. If
// you delete Lore, the wiki is exactly as it was.

const MARKDOWN = /\.mdx?$/i;

// Folders that are never wiki content. `.obsidian` and `.trash` matter because
// the whole point is to sit on top of an existing Obsidian vault without
// indexing its config or its bin.
const SKIP_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".smart-env",
  "node_modules",
  ".next",
  ".DS_Store",
  "__pycache__",
]);

export type WikiPage = {
  /** Vault-relative path with no extension, POSIX separators. The stable id. */
  id: string;
  /** Vault-relative path including extension. */
  relPath: string;
  title: string;
  /** Vault-relative folder, "" for root-level pages. */
  folder: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  excerpt: string;
  words: number;
  mtime: number;
  /** Ids this page links to via [[wikilinks]] or relative markdown links. */
  links: string[];
  /**
   * Link targets exactly as written, before resolution. Kept because `links`
   * is overwritten with resolved ids during indexing — without this, the ones
   * that resolved to nothing would be indistinguishable from no links at all,
   * and the dead-link check would silently always pass.
   */
  rawLinks: string[];
  /**
   * Whole body as plain text, held in the index so search never re-reads the
   * disk. A personal wiki is a few MB of prose; paying that once per scan is
   * far cheaper than a file read per page per keystroke.
   */
  plain: string;
};

export type WikiIndex = {
  root: string;
  pages: WikiPage[];
  /** id -> ids of pages that link to it. */
  backlinks: Record<string, string[]>;
  tags: { tag: string; count: number }[];
  folders: { folder: string; count: number }[];
  scannedAt: number;
  /** Markdown files that failed to parse, so the UI can surface them honestly. */
  errors: { relPath: string; message: string }[];
};

// ---------------------------------------------------------------- path safety

/**
 * Resolve a vault-relative path and prove it stays inside the vault. Every
 * read and write goes through this: the app is a local HTTP server, so a
 * `../../.ssh/id_rsa` in a request body is the one thing that could turn a
 * notes app into a file-exfiltration tool.
 */
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

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      await walk(root, abs, out);
    } else if (entry.isFile() && MARKDOWN.test(entry.name)) {
      out.push(toPosix(path.relative(root, abs)));
    }
  }
}

/** Strip markdown syntax down to readable prose, for excerpts and search. */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => alias || target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalise a link target to a page id. Obsidian-style `[[Page Name]]` doesn't
 * carry a path, so we match on basename later; here we only clean the string.
 */
function normaliseTarget(target: string): string {
  return target
    .split("#")[0]
    .split("|")[0]
    .trim()
    .replace(/^\.\//, "")
    .replace(MARKDOWN, "");
}

function extractLinks(body: string): string[] {
  const found = new Set<string>();

  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = normaliseTarget(m[1]);
    if (target) found.add(target);
  }
  // Relative markdown links to other notes, e.g. [spec](../specs/spec.md).
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = m[1].trim();
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) continue;
    if (!MARKDOWN.test(href)) continue;
    const target = normaliseTarget(href);
    if (target) found.add(target);
  }

  return [...found];
}

/**
 * Inline `#tags` are a guess, so they have to earn their place.
 *
 * The naive rule — anything after a `#` — is wrong on real corpora. Measured on
 * a 1,441-page vault it produced 71 junk tags out of 195, and gave one page 43
 * of them: an append-only log file full of `#F0837BEC5B308`-style identifiers,
 * every one of which the reader has to visually discard.
 *
 * A real tag has a lowercase letter in it. `#stack`, `#project/lore`, `#follow-up`
 * all pass; a hex id, a commit SHA, a ticket code like `#AB1234` and a C-style
 * `#IFDEF` all fail. That single test removes the entire junk class without
 * touching a tag anyone actually typed.
 */
function looksLikeTag(tag: string): boolean {
  return /[a-z]/.test(tag) && !/^[A-Z0-9_-]+$/.test(tag);
}

/**
 * Cap on inline tags per page. Frontmatter tags are exempt — those were typed
 * deliberately, and silently dropping what someone wrote is worse than showing
 * a long list. This bound only applies to what we inferred, where a page
 * claiming dozens of tags means the guess went wrong, not that the page is
 * unusually rich.
 */
const MAX_INLINE_TAGS = 12;

function extractTags(frontmatter: Record<string, unknown>, body: string): string[] {
  const declared = new Set<string>();

  const fmTags = frontmatter.tags ?? frontmatter.tag;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === "string" && t.trim()) declared.add(t.trim().replace(/^#/, ""));
    }
  } else if (typeof fmTags === "string") {
    for (const t of fmTags.split(/[,\s]+/)) {
      if (t.trim()) declared.add(t.trim().replace(/^#/, ""));
    }
  }

  // Inline tags, but only outside code fences and spans, and never a bare
  // `# heading` — the leading-whitespace requirement is what separates the two.
  const prose = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
  const inline = new Set<string>();
  for (const m of prose.matchAll(/(?:^|[\s(])#([a-zA-Z][\w/-]{1,48})/g)) {
    if (declared.has(m[1])) continue;
    if (!looksLikeTag(m[1])) continue;
    inline.add(m[1]);
    if (inline.size >= MAX_INLINE_TAGS) break;
  }

  return [...declared, ...inline];
}

function deriveTitle(frontmatter: Record<string, unknown>, body: string, relPath: string): string {
  const fmTitle = frontmatter.title ?? frontmatter.name;
  if (typeof fmTitle === "string" && fmTitle.trim()) return fmTitle.trim();
  const h1 = body.match(/^\s{0,3}#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path.basename(relPath).replace(MARKDOWN, "");
}

async function readPage(root: string, relPath: string): Promise<WikiPage> {
  const abs = resolveInVault(root, relPath);
  const [raw, stat] = await Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]);

  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Malformed YAML shouldn't hide a note. Treat the whole file as body.
  }

  const plain = toPlainText(body);
  const folder = toPosix(path.dirname(relPath));

  return {
    id: relPath.replace(MARKDOWN, ""),
    relPath,
    title: deriveTitle(frontmatter, body, relPath),
    folder: folder === "." ? "" : folder,
    tags: extractTags(frontmatter, body),
    frontmatter,
    excerpt: plain.slice(0, 240),
    words: plain ? plain.split(/\s+/).length : 0,
    mtime: stat.mtimeMs,
    links: extractLinks(body),
    rawLinks: extractLinks(body),
    plain,
  };
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
  await walk(root, root, relPaths);

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
  pages.sort((a, b) => a.id.localeCompare(b.id));

  // Resolve links to real page ids. An id match wins; otherwise we fall back to
  // a unique basename match, which is how Obsidian's short `[[Page]]` form
  // works. Ambiguous basenames are left unresolved rather than guessed.
  const byId = new Map(pages.map((p) => [p.id.toLowerCase(), p.id]));
  const byBasename = new Map<string, string[]>();
  for (const page of pages) {
    const base = path.basename(page.id).toLowerCase();
    byBasename.set(base, [...(byBasename.get(base) ?? []), page.id]);
  }

  /*
   * Aliases, from frontmatter `aliases:` (a list, or one string).
   *
   * Renaming a page silently breaks every link to it: the target no longer
   * resolves, so it stops counting as a link at all rather than showing up as
   * broken. On a wiki where agents rename things this is a slow, invisible
   * shredding of the link graph.
   *
   * An alias is the old name kept as a forwarding address. It loses to a real
   * page id and to a unique basename, so adopting an alias can never steal a
   * link from an actual page — the worst case is that a dead link stays dead.
   */
  const byAlias = new Map<string, string[]>();
  for (const page of pages) {
    const raw = page.frontmatter?.aliases ?? page.frontmatter?.alias;
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    for (const alias of list) {
      if (typeof alias !== "string") continue;
      const key = alias.trim().toLowerCase();
      if (!key || byId.has(key)) continue;
      byAlias.set(key, [...(byAlias.get(key) ?? []), page.id]);
    }
  }

  const backlinks: Record<string, string[]> = {};
  for (const page of pages) {
    const resolved: string[] = [];
    for (const raw of page.links) {
      const key = raw.toLowerCase();
      const direct = byId.get(key);
      const candidates = byBasename.get(path.basename(key)) ?? [];
      const aliased = byAlias.get(key) ?? byAlias.get(path.basename(key)) ?? [];
      const target =
        direct ??
        (candidates.length === 1 ? candidates[0] : undefined) ??
        // Ambiguous aliases are dropped for the same reason ambiguous basenames
        // are: a guess here invents a relationship the author never made.
        (aliased.length === 1 ? aliased[0] : undefined);
      if (!target || target === page.id) continue;
      resolved.push(target);
      backlinks[target] = [...(backlinks[target] ?? []), page.id];
    }
    page.links = [...new Set(resolved)];
  }
  for (const key of Object.keys(backlinks)) {
    backlinks[key] = [...new Set(backlinks[key])];
  }

  const tagCounts = new Map<string, number>();
  const folderCounts = new Map<string, number>();
  for (const page of pages) {
    for (const tag of page.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    folderCounts.set(page.folder, (folderCounts.get(page.folder) ?? 0) + 1);
  }

  const index: WikiIndex = {
    root,
    pages,
    backlinks,
    tags: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    folders: [...folderCounts.entries()]
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => a.folder.localeCompare(b.folder)),
    scannedAt: Date.now(),
    errors,
  };

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

export type SearchHit = {
  page: WikiPage;
  score: number;
  /** Matching line from the body, for the result snippet. */
  snippet: string | null;
};

/**
 * Ranked substring search. Deliberately not fuzzy: on a personal wiki, an
 * exact-ish match on a title is almost always the thing you meant, and fuzzy
 * ranking mostly buries it under coincidental body hits.
 */
export async function search(root: string, query: string, limit = 40): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const index = await getIndex(root);
  const hits: SearchHit[] = [];

  for (const page of index.pages) {
    let score = 0;
    const title = page.title.toLowerCase();

    if (title === q) score += 100;
    else if (title.startsWith(q)) score += 60;
    else if (title.includes(q)) score += 40;

    if (page.id.toLowerCase().includes(q)) score += 15;
    if (page.tags.some((t) => t.toLowerCase().includes(q))) score += 25;

    let snippet: string | null = null;
    const at = page.plain.toLowerCase().indexOf(q);
    if (at !== -1) {
      score += 10;
      // Centre the snippet on the match so the user sees the hit, not the
      // first 200 characters of an unrelated intro paragraph.
      const start = Math.max(0, at - 60);
      snippet =
        (start > 0 ? "…" : "") + page.plain.slice(start, start + 200).trim() + "…";
    }

    if (score > 0) hits.push({ page, score, snippet });
  }

  return hits
    .sort((a, b) => b.score - a.score || b.page.mtime - a.page.mtime)
    .slice(0, limit);
}

// -------------------------------------------------------------------- health

export type HealthReport = {
  score: number;
  pages: number;
  words: number;
  /** Pages nothing links to and that link nowhere — knowledge that fell out. */
  orphans: { id: string; title: string; relPath: string }[];
  /** [[links]] pointing at pages that don't exist yet. */
  unresolved: { from: string; target: string }[];
  /** Untouched for longer than the staleness window for their kind. */
  stale: { id: string; title: string; relPath: string; days: number }[];
  untagged: number;
};

/**
 * Review windows in days. A page about a tool version rots far faster than a
 * page about a decision you made, so a single global "stale after 90 days"
 * threshold either screams about everything or catches nothing.
 */
const STALE_DAYS: { match: RegExp; days: number }[] = [
  { match: /pricing|cost|rate|invoice/i, days: 30 },
  { match: /tool|stack|version|setup|install|config/i, days: 90 },
  { match: /client|project|status|roadmap/i, days: 60 },
];
const STALE_DEFAULT_DAYS = 180;

/**
 * Optional per-vault override for the staleness windows above (see lib/policy).
 * Defaulting to the measured constants keeps every existing caller unchanged.
 */
export type WindowResolver = (id: string, title: string) => number;

export async function health(root: string, resolveWindow?: WindowResolver): Promise<HealthReport> {
  const index = await getIndex(root);
  const now = Date.now();
  const ids = new Set(index.pages.map((p) => p.id));

  const orphans = index.pages
    .filter((p) => !(index.backlinks[p.id]?.length ?? 0) && p.links.length === 0)
    .map((p) => ({ id: p.id, title: p.title, relPath: p.relPath }));

  const unresolved: { from: string; target: string }[] = [];
  for (const page of index.pages) {
    for (const target of page.rawLinks) {
      const key = target.toLowerCase();
      const hit =
        ids.has(target) ||
        index.pages.some(
          (p) => p.id.toLowerCase() === key || path.basename(p.id).toLowerCase() === path.basename(key),
        );
      if (!hit) unresolved.push({ from: page.id, target });
    }
  }

  const stale = index.pages
    .map((page) => {
      const window =
        resolveWindow?.(page.id, page.title) ??
        STALE_DAYS.find((rule) => rule.match.test(page.id) || rule.match.test(page.title))?.days ??
        STALE_DEFAULT_DAYS;
      const days = Math.floor((now - page.mtime) / 86_400_000);
      return { id: page.id, title: page.title, relPath: page.relPath, days, window };
    })
    .filter((p) => p.days > p.window)
    .sort((a, b) => b.days - a.days)
    .map(({ id, title, relPath, days }) => ({ id, title, relPath, days }));

  const untagged = index.pages.filter((p) => p.tags.length === 0).length;
  const total = index.pages.length || 1;

  // A single number the user can watch move. Weighted so orphans and dead
  // links — the two things that actually make a wiki unusable to an agent —
  // cost more than a missing tag.
  const score = Math.max(
    0,
    Math.round(
      100 -
        (orphans.length / total) * 35 -
        Math.min(unresolved.length / total, 1) * 30 -
        (stale.length / total) * 20 -
        (untagged / total) * 15,
    ),
  );

  return {
    score,
    pages: index.pages.length,
    words: index.pages.reduce((sum, p) => sum + p.words, 0),
    orphans,
    unresolved,
    stale,
    untagged,
  };
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
