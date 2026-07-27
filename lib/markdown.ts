import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/** Escape for safe interpolation into an HTML attribute or text node. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MASK_PREFIX = "LOREMASK";

/**
 * Render a note to HTML.
 *
 * Wikilinks and #tags are not markdown, so they're converted to HTML before
 * marked runs — but only outside code spans and fenced blocks, which are
 * masked out first. Without that, a `[[` inside a code sample gets rewritten
 * into a link and the sample stops being the thing it documents.
 *
 * `pages` maps page id to title. A link that resolves renders as the target's
 * title rather than its raw path, because `[[stack/deploy-pipeline]]` reading
 * as "Deploy pipeline" mid-sentence is the difference between a wiki and a
 * file listing. An unresolved link renders as a visible dangling reference, so
 * an empty map makes every link render as missing — the honest default when
 * the index hasn't loaded.
 *
 * Raw HTML in the source is passed through, matching Obsidian. These are the
 * user's own local files rendered in their own browser, so there is no
 * untrusted author to sanitise against — and stripping it would silently break
 * every note that embeds a table or a details block.
 */
export function renderMarkdown(source: string, pages: Map<string, string>): string {
  // The placeholder is prefixed rather than a bare number: an unprefixed
  // numeric token would also match a year or a version in the prose and get
  // corrupted on the way back out.
  const masked: string[] = [];
  const stash = (match: string) => ` ${MASK_PREFIX}${masked.push(match) - 1} `;

  /*
   * Diagrams and math are pulled out before anything else touches the text.
   *
   * A mermaid fence is markdown's own code-fence syntax, so leaving it to the
   * generic fence handler below would render the diagram source as a code
   * listing. Math is worse: `$x_i$` contains underscores, which the italic rule
   * eats before a maths renderer ever sees them.
   *
   * Both are emitted as inert markup and rendered in the browser (see
   * components/lore/rich-blocks.tsx). Rendering them here would mean shipping a
   * DOM implementation into the server bundle for no gain.
   */
  let body = source.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code: string) =>
    stash(`<pre class="lore-mermaid">${escapeHtml(code.trim())}</pre>`),
  );

  body = body
    .replace(/\$\$\n?([\s\S]*?)\n?\$\$/g, (_m, tex: string) =>
      stash(`<div class="lore-math" data-display="1">${escapeHtml(tex.trim())}</div>`),
    )
    // Single-dollar inline math, but never `$5` or `$ x` — a wiki about money
    // would otherwise turn half its prose into equations.
    .replace(/\$(?!\s)([^$\n]{1,200}?)(?<!\s)\$(?!\d)/g, (_m, tex: string) =>
      stash(`<span class="lore-math">${escapeHtml(tex.trim())}</span>`),
    );

  body = body
    .replace(/```[\s\S]*?```/g, stash)
    .replace(/`[^`\n]*`/g, stash);

  body = body.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const [rawTarget, alias] = String(inner).split("|");
    const target = rawTarget.split("#")[0].trim();
    const key = target.toLowerCase();
    const resolved = [...pages.keys()].find(
      (id) => id.toLowerCase() === key || id.toLowerCase().split("/").pop() === key,
    );
    if (!resolved) {
      const label = (alias ?? rawTarget).trim();
      return `<span class="lore-wikilink" data-missing="true" title="No page named &quot;${escapeHtml(target)}&quot; yet">${escapeHtml(label)}</span>`;
    }
    // An explicit `|alias` always wins; otherwise show the target's title.
    const label = alias?.trim() || pages.get(resolved) || target;
    return `<a class="lore-wikilink" href="#page:${escapeHtml(resolved)}" data-page="${escapeHtml(resolved)}" title="${escapeHtml(resolved)}">${escapeHtml(label)}</a>`;
  });

  body = body.replace(
    /(^|[\s(])#([a-zA-Z][\w/-]{1,48})/g,
    (_m, lead: string, tag: string) => `${lead}<span class="lore-tag">${escapeHtml(tag)}</span>`,
  );

  const restored = body.replace(
    new RegExp(` ${MASK_PREFIX}(\\d+) `, "g"),
    (_m, i: string) => masked[Number(i)],
  );

  return marked.parse(restored, { async: false });
}

/** Strip a YAML frontmatter block so the reader doesn't render raw metadata. */
export function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Drop a leading `# Heading` when it just repeats the title already shown in
 * the page header. Almost every markdown note opens with its own title, and
 * rendering both makes every page look like a mistake.
 */
export function stripLeadingTitle(source: string, title: string): string {
  const match = source.match(/^\s*#\s+(.+?)\s*$/m);
  if (!match) return source;
  const heading = match[1].trim().toLowerCase();
  if (heading !== title.trim().toLowerCase()) return source;
  return source.slice(0, match.index).trimStart() + source.slice(match.index! + match[0].length);
}
