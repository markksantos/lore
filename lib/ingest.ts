/**
 * Getting things into the wiki.
 *
 * Everything Lore does assumes the pages already exist. They have to come from
 * somewhere, and "somewhere" is usually a web page you read once, a transcript
 * nobody will reread, or a document that has been sitting in Downloads for a
 * month. Each of those has the same failure: the effort of turning it into a
 * page is larger than the effort of not bothering.
 *
 * Nothing here calls a model. Conversion is mechanical and predictable, which
 * matters because the alternative — an LLM rewriting a source into a summary —
 * quietly replaces what the source said with what a model thought it said, and
 * you no longer have the thing you captured.
 */

export type Ingested = {
  title: string;
  markdown: string;
  /** Where the content came from, recorded in frontmatter for provenance. */
  source: string | null;
};

const BLOCK = new Set([
  "p","div","section","article","header","footer","main","aside","br","hr",
  "h1","h2","h3","h4","h5","h6","li","tr","blockquote","pre",
]);

function decode(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—",
    ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  };
  return text
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}

/**
 * HTML to markdown, structure-preserving.
 *
 * Not a general converter — a good one is a large dependency and this needs to
 * handle exactly what a web clipper meets: headings, paragraphs, lists, links,
 * code and emphasis. Everything else degrades to its text, which is the right
 * failure: losing a table's borders is fine, losing its contents is not.
 */
export function htmlToMarkdown(html: string): Ingested {
  let source = html;

  // Chrome, script, style and svg carry no prose and wreck the output.
  source = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|iframe|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|footer|aside)[\s\S]*?<\/\1>/gi, "");

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source);
  const title = decode(
    (h1Match?.[1] ?? titleMatch?.[1] ?? "Untitled").replace(/<[^>]+>/g, ""),
  )
    .trim()
    .slice(0, 160);

  // Prefer <article>/<main> when present: it is the page's own statement about
  // which part is the content.
  const main =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(source)?.[1] ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(source)?.[1] ??
    source;

  let out = main
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
      const text = decode(inner.replace(/<[^>]+>/g, "")).trim();
      return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "";
    })
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
      const text = decode(inner.replace(/<[^>]+>/g, ""));
      return `\n\n\`\`\`\n${text.trim()}\n\`\`\`\n\n`;
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, i: string) => `\`${decode(i.replace(/<[^>]+>/g, ""))}\``)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, i: string) => `**${decode(i.replace(/<[^>]+>/g, ""))}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, i: string) => `*${decode(i.replace(/<[^>]+>/g, ""))}*`)
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, i: string) => {
      const text = decode(i.replace(/<[^>]+>/g, "")).trim();
      if (!text) return "";
      // Anchors and javascript: links carry nothing once the page is markdown.
      return /^(https?:)?\/\//.test(href) ? `[${text}](${href})` : text;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, i: string) => `\n- ${decode(i.replace(/<[^>]+>/g, "")).trim()}`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, i: string) =>
      `\n\n> ${decode(i.replace(/<[^>]+>/g, "")).trim()}\n\n`,
    );

  out = out.replace(/<\/?([a-z0-9]+)[^>]*>/gi, (_m, tag: string) =>
    BLOCK.has(tag.toLowerCase()) ? "\n" : "",
  );

  out = decode(out)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // The page's own <h1> becomes the title, and toPage writes the title as an
  // H1 too — so leaving it here renders the heading twice on every capture.
  const leading = new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\n+`);
  out = out.replace(leading, "");

  return { title, markdown: out, source: null };
}

/**
 * Structure a transcript.
 *
 * A raw transcript is unreadable and unsearchable in the way that matters: the
 * speaker labels are there but nothing is grouped, so a search lands you in the
 * middle of a sentence with no idea who said it or what part of the
 * conversation it was.
 *
 * Consecutive lines from one speaker are merged into a paragraph under a
 * heading. That is the smallest change that makes a transcript skimmable, and it
 * invents nothing.
 */
export function structureTranscript(raw: string, title: string): Ingested {
  const speaker = /^\s*(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*)?([A-Z][\w .'-]{1,40}?)\s*:\s*(.*)$/;
  const blocks: { who: string; lines: string[] }[] = [];

  for (const line of raw.split("\n")) {
    const match = speaker.exec(line);
    if (match) {
      const who = match[1].trim();
      const said = match[2].trim();
      const last = blocks[blocks.length - 1];
      if (last && last.who === who) last.lines.push(said);
      else blocks.push({ who, lines: said ? [said] : [] });
    } else if (line.trim() && blocks.length) {
      blocks[blocks.length - 1].lines.push(line.trim());
    }
  }

  // No speaker labels found at all — keep the text rather than mangle it.
  if (blocks.length < 2) {
    return { title, markdown: raw.trim(), source: null };
  }

  const speakers = [...new Set(blocks.map((b) => b.who))];
  const body = blocks
    .filter((b) => b.lines.length)
    .map((b) => `**${b.who}**\n\n${b.lines.join(" ")}`)
    .join("\n\n");

  return {
    title,
    markdown: `_${speakers.length} speakers: ${speakers.join(", ")}._\n\n${body}`,
    source: null,
  };
}

/** Wrap ingested content in frontmatter that records where it came from. */
export function toPage(ingested: Ingested, extraTags: string[] = []): string {
  const now = new Date().toISOString();
  const tags = ["ingested", ...extraTags];
  return [
    "---",
    `title: ${JSON.stringify(ingested.title)}`,
    `created: ${now.slice(0, 10)}`,
    `updated: ${now.slice(0, 10)}`,
    ingested.source ? `source: ${JSON.stringify(ingested.source)}` : null,
    `tags: [${tags.join(", ")}]`,
    // Never claim more than is true: this arrived mechanically and no human has
    // looked at it, which is exactly what unverified means everywhere else.
    "confidence: unreviewed",
    "---",
    "",
    `# ${ingested.title}`,
    "",
    ingested.source ? `_Captured from ${ingested.source}._\n` : "",
    ingested.markdown,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}
