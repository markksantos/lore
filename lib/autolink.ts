/**
 * Link suggestions.
 *
 * A wiki decays into a pile of documents one unlinked mention at a time. Nobody
 * neglects links on purpose — you write "we moved this to Postgres" without
 * remembering there is a page called Postgres, and an agent writing at speed
 * never links anything at all.
 *
 * So this finds mentions of real page titles in prose that are not yet links,
 * and offers them. It suggests rather than rewrites: silently linking every
 * occurrence of a common word would vandalise the page, and the judgement of
 * whether *this* mention means *that* page is exactly the thing worth a human
 * second.
 */

export type LinkTarget = {
  id: string;
  title: string;
  relPath: string;
  aliases?: string[];
};

export type Suggestion = {
  targetId: string;
  targetTitle: string;
  relPath: string;
  /** The exact text matched, as it appears in the page. */
  mention: string;
  /** Character offset into the raw source. */
  at: number;
  line: string;
};

/**
 * Titles shorter than this are skipped entirely.
 *
 * Set from what actually goes wrong: a page called "AI" or "Ops" matches
 * hundreds of times in ordinary prose and every hit is noise. Four characters
 * removes that class without losing anything anyone would want linked.
 */
const MIN_TITLE = 4;

/** Common words that happen to be page titles on many wikis. */
const TOO_GENERIC = new Set([
  "notes","index","home","todo","ideas","log","logs","misc","other","stuff","things",
  "readme","overview","summary","list","draft","inbox","archive","test","temp","new",
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regions of the source where a suggestion would be wrong or unwanted.
 *
 * Fenced code, inline code, existing wikilinks, markdown link targets, headings,
 * frontmatter and URLs. Offering to link a word inside a code block is the
 * fastest way to make someone turn a feature off.
 */
function maskedRanges(raw: string): [number, number][] {
  const ranges: [number, number][] = [];
  const push = (re: RegExp) => {
    for (const m of raw.matchAll(re)) {
      if (m.index === undefined) continue;
      ranges.push([m.index, m.index + m[0].length]);
    }
  };

  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end !== -1) ranges.push([0, end + 4]);
  }
  push(/```[\s\S]*?```/g);
  push(/`[^`\n]+`/g);
  push(/\[\[[^\]]+\]\]/g);
  push(/\[[^\]]*\]\([^)]*\)/g);
  push(/^#{1,6} .*$/gm);
  push(/https?:\/\/\S+/g);
  return ranges;
}

const inside = (ranges: [number, number][], at: number, end: number) =>
  ranges.some(([s, e]) => at < e && end > s);

export function suggestLinks(
  raw: string,
  selfId: string,
  targets: LinkTarget[],
  alreadyLinked: Set<string>,
  limit = 25,
): Suggestion[] {
  const masked = maskedRanges(raw);
  const out: Suggestion[] = [];
  const claimed: [number, number][] = [];

  const candidates = targets
    .filter((t) => t.id !== selfId && !alreadyLinked.has(t.id))
    .flatMap((t) => [t.title, ...(t.aliases ?? [])].map((name) => ({ target: t, name })))
    .filter(({ name }) => name.length >= MIN_TITLE && !TOO_GENERIC.has(name.toLowerCase()))
    // Longest first, so "Context Window" wins over "Context" at the same spot
    // rather than both being offered for overlapping text.
    .sort((a, b) => b.name.length - a.name.length);

  for (const { target, name } of candidates) {
    if (out.length >= limit) break;

    // Word-boundary match. \b is wrong for titles ending in punctuation, so the
    // boundaries are spelled out.
    const re = new RegExp(`(^|[^\\w[\\]-])(${escape(name)})(?=$|[^\\w-])`, "gi");
    for (const m of raw.matchAll(re)) {
      if (m.index === undefined) continue;
      const at = m.index + m[1].length;
      const end = at + m[2].length;
      if (inside(masked, at, end) || inside(claimed, at, end)) continue;

      const lineStart = raw.lastIndexOf("\n", at) + 1;
      const lineEnd = raw.indexOf("\n", at);
      out.push({
        targetId: target.id,
        targetTitle: target.title,
        relPath: target.relPath,
        mention: m[2],
        at,
        line: raw.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().slice(0, 200),
      });
      claimed.push([at, end]);
      // One suggestion per target per page. Linking the first mention is the
      // wiki convention, and offering the same link nine times is noise.
      break;
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

/**
 * Apply chosen suggestions to the source.
 *
 * Applied back to front so each offset stays valid — rewriting front to back
 * shifts every later position by the characters just inserted, which silently
 * corrupts the page.
 */
export function applyLinks(raw: string, chosen: Suggestion[]): string {
  let out = raw;
  for (const s of [...chosen].sort((a, b) => b.at - a.at)) {
    const end = s.at + s.mention.length;
    if (out.slice(s.at, end) !== s.mention) continue; // page moved under us
    out = `${out.slice(0, s.at)}[[${s.mention}]]${out.slice(end)}`;
  }
  return out;
}
