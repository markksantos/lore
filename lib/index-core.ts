import matter from "gray-matter";
import { authority, bm25, invertedFor, terms } from "@/lib/rank";

/**
 * The wiki engine, with the filesystem taken out of it.
 *
 * Everything here turns `{path, text}` into an index and answers questions
 * about that index. It touches no disk and imports no node module, which is the
 * whole point: the same parser, the same link resolution, the same ranking runs
 * on the server against a folder and in the browser against a directory handle.
 *
 * lib/wiki.ts supplies the files from disk. lib/browser-vault.ts supplies them
 * from the File System Access API. Neither owns the meaning of a wikilink.
 */

export const MARKDOWN = /\.mdx?$/i;

/**
 * Folders that are never wiki content. `.obsidian` and `.trash` matter because
 * the whole point is to sit on top of an existing Obsidian vault without
 * indexing its config or its bin.
 */
export const SKIP_DIRS = new Set([
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
  folder: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  excerpt: string;
  words: number;
  mtime: number;
  /** Resolved page ids after indexing; raw targets before. */
  links: string[];
  rawLinks: string[];
  plain: string;
};

export type WikiIndex = {
  root: string;
  pages: WikiPage[];
  backlinks: Record<string, string[]>;
  tags: { tag: string; count: number }[];
  folders: { folder: string; count: number }[];
  scannedAt: number;
  errors: { relPath: string; message: string }[];
};

// POSIX path helpers. Vault paths are always POSIX by construction — the node
// side converts on the way in — so importing `path` here would buy nothing but
// a dependency the browser cannot have.
export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirName = (p: string) => {
  const at = p.lastIndexOf("/");
  return at === -1 ? "" : p.slice(0, at);
};

/**
 * Patterns from a `.loreignore`, one per line, `#` for comments. Gitignore-ish:
 * a trailing `/` means directory, a leading `/` anchors to the root, `*` matches
 * within a path segment.
 *
 * This exists because pointing an indexer at a real folder is an act of trust,
 * and the first question anyone with client work under NDA or a `secrets/`
 * directory asks is how to keep part of it out. "Move those files" is not an
 * answer.
 */
export function parseIgnore(raw: string): RegExp[] {
  const patterns: RegExp[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const anchored = trimmed.startsWith("/");
    const body = (anchored ? trimmed.slice(1) : trimmed).replace(/\/$/, "");
    // Escape everything, then re-enable the two wildcards people expect.
    const escaped = body
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*")
      .replace(/\?/g, "[^/]");
    patterns.push(new RegExp(anchored ? `^${escaped}(/|$)` : `(^|/)${escaped}(/|$)`));
  }
  return patterns;
}

export const ignored = (patterns: RegExp[], relPath: string) =>
  patterns.some((re) => re.test(relPath));

/** Strip markdown syntax down to readable prose, for excerpts and search. */
export function toPlainText(markdown: string): string {
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

function deriveTitle(
  frontmatter: Record<string, unknown>,
  body: string,
  relPath: string,
): string {
  const fmTitle = frontmatter.title ?? frontmatter.name;
  if (typeof fmTitle === "string" && fmTitle.trim()) return fmTitle.trim();
  const h1 = body.match(/^\s{0,3}#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return baseName(relPath).replace(MARKDOWN, "");
}

/** One file's text into a page. `relPath` must already be POSIX. */
export function parsePage(relPath: string, raw: string, mtime: number): WikiPage {
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
  const links = extractLinks(body);

  return {
    id: relPath.replace(MARKDOWN, ""),
    relPath,
    title: deriveTitle(frontmatter, body, relPath),
    folder: dirName(relPath),
    tags: extractTags(frontmatter, body),
    frontmatter,
    excerpt: plain.slice(0, 240),
    words: plain ? plain.split(/\s+/).length : 0,
    mtime,
    links,
    rawLinks: links,
    plain,
  };
}

/**
 * Resolve every page's raw link targets to real page ids and build the index.
 *
 * `pages` is mutated in place — `links` goes from raw targets to resolved ids —
 * which is what the callers have always relied on.
 */
export function buildIndex(
  root: string,
  pages: WikiPage[],
  errors: { relPath: string; message: string }[] = [],
): WikiIndex {
  pages.sort((a, b) => a.id.localeCompare(b.id));

  // Resolve links to real page ids. An id match wins; otherwise we fall back to
  // a unique basename match, which is how Obsidian's short `[[Page]]` form
  // works. Ambiguous basenames are left unresolved rather than guessed.
  const byId = new Map(pages.map((p) => [p.id.toLowerCase(), p.id]));
  const byBasename = new Map<string, string[]>();
  for (const page of pages) {
    const base = baseName(page.id).toLowerCase();
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
    for (const raw of page.rawLinks) {
      const key = raw.toLowerCase();
      const direct = byId.get(key);
      const candidates = byBasename.get(baseName(key)) ?? [];
      const aliased = byAlias.get(key) ?? byAlias.get(baseName(key)) ?? [];
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

  return {
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
 *
 * Two rankers, deliberately combined rather than one replacing the other.
 *
 * The exact-match bonuses below are what made search feel sharp: on a personal
 * wiki the page whose title IS your query is nearly always the one you meant,
 * and no statistical ranker should be allowed to bury it.
 *
 * BM25 handles everything that is not that. The original scored a query only as
 * one literal phrase, so "postgres backup" returned nothing from a page saying
 * "backup of the postgres cluster" — the words were there, just not adjacent.
 * Term scores are scaled to sit below an exact title hit and above an incidental
 * body mention.
 *
 * Authority is a bounded multiplier, never a sort key. Of two pages that both
 * mention "deploy", the one eleven pages link to is more likely the one you
 * want — but a hub must not outrank a page actually called what you typed.
 */
export function searchIndex(index: WikiIndex, query: string, limit = 40): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const signature = `${index.pages.length}:${index.pages.reduce((m, p) => Math.max(m, p.mtime), 0)}`;
  const inverted = invertedFor(index.root, index.pages, signature);
  const termScores = bm25(query, inverted);
  const rank = authority(
    index.pages.map((p) => p.id),
    index.backlinks,
  );

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
      snippet = (start > 0 ? "…" : "") + page.plain.slice(start, start + 200).trim() + "…";
    }

    const bm = termScores.get(page.id) ?? 0;
    if (bm > 0) {
      score += Math.min(bm * 3, 35);
      if (!snippet) snippet = snippetForTerms(page.plain, query);
    }

    if (score > 0) {
      score *= 1 + 0.18 * (rank.get(page.id) ?? 0);
      hits.push({ page, score, snippet });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || b.page.mtime - a.page.mtime)
    .slice(0, limit);
}

/**
 * A snippet for a multi-word match, where no single literal position exists.
 * Picks the line containing the most query terms, which is the closest thing to
 * "where the answer probably is" without parsing the page.
 */
function snippetForTerms(plain: string, query: string): string | null {
  const wanted = new Set(terms(query));
  if (!wanted.size) return null;

  let best: { line: string; hits: number } | null = null;
  for (const line of plain.split("\n")) {
    if (line.trim().length < 12) continue;
    let hits = 0;
    for (const word of new Set(terms(line))) if (wanted.has(word)) hits++;
    if (hits && (!best || hits > best.hits)) best = { line: line.trim(), hits };
  }
  return best ? best.line.slice(0, 220) + (best.line.length > 220 ? "…" : "") : null;
}

// -------------------------------------------------------- agent-facing view

/**
 * The map an agent reads first: every page, its folder, tags and one-line
 * summary, small enough to fit in a context window. This is the artefact that
 * makes a wiki usable by an agent — without it, an agent either reads
 * everything (too many tokens) or greps blind (misses the right page).
 */
export function renderAgentIndex(index: WikiIndex, vaultName: string, root = index.root): string {
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
