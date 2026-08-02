import { jaccardOf } from "@/lib/utils";
import { extractClaims, conflictsWith, type Claim } from "@/lib/claims";
import { checkPages, parseSchemaRules, type FieldRule } from "@/lib/schema-check";
import { toPlainText, type WikiIndex, type WikiPage } from "@/lib/index-core";

/**
 * What Lore says back to an agent that just wrote a page.
 *
 * Until now it said nothing. An agent wrote, the watcher journalled the write,
 * and every problem with it — contradicting an existing page, duplicating one,
 * linking to nothing, missing the frontmatter the vault's own SCHEMA.md
 * requires — surfaced hours later on a screen, for a human to fix by hand.
 *
 * That is the wrong end of the loop. The author is a model that will happily
 * fix any of those in the same turn, for free, if told. Afterwards the same
 * information costs a person their afternoon. So every check Lore can compute
 * runs here, synchronously, and comes back inside the tool result.
 *
 * Three rules keep this from becoming noise the agent learns to skip:
 *
 *   - Nothing is a refusal. The write already happened. These are notes, and
 *     an agent that ignores them has still written the page.
 *   - Precision over recall, everywhere. A warning that is wrong once is a
 *     channel that gets ignored forever.
 *   - At most a handful of lines. A tool result the model has to skim is a
 *     tool result the model skims.
 */

export type WriteNote =
  | { kind: "contradiction"; text: string; pageId: string; relPath: string }
  | { kind: "duplicate"; text: string; pageId: string; relPath: string; score: number }
  | { kind: "link"; text: string; targets: { pageId: string; relPath: string; title: string }[] }
  | { kind: "schema"; text: string; missing: string[] }
  | { kind: "volatile"; text: string }
  | { kind: "consolidate"; text: string; pages: string[] };

export type WriteFeedback = {
  notes: WriteNote[];
  /** Rendered for the MCP tool result; empty when there is nothing to say. */
  text: string;
};

/**
 * Word-level tokens. Deliberately not similarity.ts's tokenizer, which shingles
 * into numeric hashes for MinHash — that is the right shape for finding every
 * duplicate pair in a corpus and the wrong one for asking "does this one page
 * resemble that one".
 */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}


/**
 * Claims for the whole vault, cached.
 *
 * Extracting every claim in the wiki takes most of a second on 1,600 pages,
 * which is fine once and absurd on every write. The index is rebuilt whenever
 * the vault changes, so its page count and newest mtime are enough of a
 * fingerprint to know when the cache is stale.
 */
let claimCache: { key: string; claims: Claim[] } | null = null;

function corpusClaims(index: WikiIndex, exclude: string): Claim[] {
  const newest = index.pages.reduce((max, p) => Math.max(max, p.mtime), 0);
  const key = `${index.root}|${index.pages.length}|${newest}`;
  if (claimCache?.key !== key) {
    const claims: Claim[] = [];
    for (const page of index.pages) {
      claims.push(
        ...extractClaims(
          {
            id: page.id,
            relPath: page.relPath,
            title: page.title,
            plain: page.plain,
            mtime: page.mtime,
          },
          40,
        ),
      );
    }
    claimCache = { key, claims };
  }
  return claimCache.claims.filter((c) => c.relPath !== exclude);
}

/**
 * Pages worth comparing against, without reading all of them.
 *
 * A full pairwise comparison means tokenising two million words on every
 * write. Anything genuinely near-duplicate shares title vocabulary or a
 * folder, so those are the only candidates worth the work.
 */
function duplicateCandidates(
  index: WikiIndex,
  relPath: string,
  title: string,
  limit = 80,
): WikiPage[] {
  const titleWords = words(title);
  const folder = relPath.slice(0, relPath.lastIndexOf("/") + 1);
  const scored: { page: WikiPage; score: number }[] = [];

  for (const page of index.pages) {
    if (page.relPath === relPath) continue;
    const shared = [...words(page.title)].filter((t) => titleWords.has(t)).length;
    const sameFolder = folder && page.relPath.startsWith(folder) ? 1 : 0;
    if (!shared && !sameFolder) continue;
    scored.push({ page, score: shared * 2 + sameFolder });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.page);
}

/** Above this the new page is a rewrite of an existing one, not a new page. */
const DUPLICATE_STRONG = 0.7;
/** Above this it is worth mentioning; below it, two pages on a shared topic. */
const DUPLICATE_WEAK = 0.45;

/** More new pages than this in one session and the agent is fragmenting. */
const SESSION_PAGE_BUDGET = 8;

/**
 * Facts with a shelf life.
 *
 * A price, a version and a port are the three things a wiki is most often
 * wrong about, because they were right when written. Suggesting `expires:`
 * once, on the write that introduces one, is the only moment the author knows
 * how long the number is good for.
 */
const VOLATILE = new Set(["money", "version", "port"]);

export type WriteContext = {
  index: WikiIndex;
  relPath: string;
  /** The full text of the page after the write. */
  content: string;
  /** Raw SCHEMA.md, if the vault has one. */
  schema: string | null;
  /** Pages this agent has created earlier in the same session. */
  sessionPages: string[];
};

/** Pages worth linking to, by shared vocabulary with the new page. */
function linkTargets(
  index: WikiIndex,
  relPath: string,
  plain: string,
  alreadyLinked: Set<string>,
  limit = 3,
): WikiPage[] {
  const mine = words(plain);
  if (mine.size < 8) return [];

  const scored: { page: WikiPage; score: number }[] = [];
  for (const page of index.pages) {
    if (page.relPath === relPath || alreadyLinked.has(page.id)) continue;
    // Title match is the strongest and cheapest signal that one page is about
    // something the other should point at.
    const titleTokens = [...words(page.title)];
    if (titleTokens.length === 0) continue;
    const hit = titleTokens.filter((t) => mine.has(t)).length / titleTokens.length;
    if (hit < 0.6) continue;
    scored.push({ page, score: hit });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.page.links.length - a.page.links.length)
    .slice(0, limit)
    .map((s) => s.page);
}

/**
 * Everything Lore can tell the author about what they just wrote.
 *
 * Pure apart from its inputs, so it can run at write time, in a dry-run
 * preview, or over an existing page in a batch — the same rules, one
 * implementation.
 */
export function reviewWrite(ctx: WriteContext): WriteFeedback {
  const notes: WriteNote[] = [];
  const plain = toPlainText(ctx.content);
  const page = ctx.index.pages.find((p) => p.relPath === ctx.relPath);
  const pageId = page?.id ?? ctx.relPath;
  const title = page?.title ?? ctx.relPath.split("/").pop() ?? ctx.relPath;

  const mineClaims = extractClaims({
    id: pageId,
    relPath: ctx.relPath,
    title,
    plain,
    mtime: Date.now(),
  });

  // ---------------------------------------------------------- contradictions
  const others = corpusClaims(ctx.index, ctx.relPath);

  for (const hit of conflictsWith(mineClaims, others).slice(0, 2)) {
    notes.push({
      kind: "contradiction",
      pageId: hit.existing.pageId,
      relPath: hit.existing.relPath,
      text:
        `This disagrees with \`${hit.existing.relPath}\` line ${hit.existing.line}: ` +
        `you wrote ${hit.incoming.value}${unitLabel(hit.incoming)}, that page says ` +
        `${hit.existing.value}${unitLabel(hit.existing)}. ` +
        `If yours is the current fact, update that page too — otherwise the wiki now says both.`,
    });
  }

  // -------------------------------------------------------------- duplicates
  /*
   * Twelve distinct words, not forty.
   *
   * The higher floor meant a short page could never be reported as a
   * duplicate — and a re-created stub is the most common duplicate there is,
   * because the agent that writes it has no idea the page already exists.
   */
  const mineTokens = words(`${title} ${plain}`);
  let duplicated = false;
  if (mineTokens.size >= 12) {
    let best: { page: WikiPage; score: number } | null = null;
    for (const other of duplicateCandidates(ctx.index, ctx.relPath, title)) {
      const score = jaccardOf(mineTokens, words(`${other.title} ${other.plain}`));
      if (!best || score > best.score) best = { page: other, score };
    }
    if (best && best.score >= DUPLICATE_WEAK) {
      const strong = best.score >= DUPLICATE_STRONG;
      duplicated = strong;
      notes.push({
        kind: "duplicate",
        pageId: best.page.id,
        relPath: best.page.relPath,
        score: best.score,
        text: strong
          ? `\`${best.page.relPath}\` already covers this — ${Math.round(best.score * 100)}% the same text. ` +
            `Append to it instead of keeping two pages, or add \`supersedes: ${best.page.relPath}\` ` +
            `to the frontmatter here so readers are sent to the current one.`
          : `\`${best.page.relPath}\` is close to this (${Math.round(best.score * 100)}% overlap). ` +
            `Worth linking to rather than restating.`,
      });
    }
  }

  // ------------------------------------------------------------------- links
  /*
   * 56% of the pages in the wiki this was built against are orphans — nothing
   * links to them. Not because linking is hard, but because nobody ever asked
   * the author to, at the one moment it costs nothing.
   */
  const linked = new Set(page?.links ?? []);
  const targets = linkTargets(ctx.index, ctx.relPath, plain, linked);
  // A page that is already reported as a duplicate does not also need to be
  // told to link somewhere: the answer to both is the same, and saying it
  // twice makes the shorter, better note easier to skip.
  if (targets.length && linked.size === 0 && !duplicated) {
    notes.push({
      kind: "link",
      targets: targets.map((t) => ({ pageId: t.id, relPath: t.relPath, title: t.title })),
      text:
        `Nothing on this page links anywhere. It is about the same things as ` +
        targets.map((t) => `[[${t.id}]]`).join(", ") +
        ` — a wikilink to one of those is what makes it findable later.`,
    });
  }

  // ------------------------------------------------------------------ schema
  if (ctx.schema) {
    const rules: FieldRule[] = parseSchemaRules(ctx.schema);
    if (rules.length && page) {
      const [issue] = checkPages([page], rules);
      if (issue?.missing.length) {
        notes.push({
          kind: "schema",
          missing: issue.missing,
          text:
            `SCHEMA.md requires ${issue.missing.map((f) => `\`${f}\``).join(", ")} in the frontmatter, ` +
            `and this page has ${issue.missing.length === 1 ? "no" : "neither"} of them.`,
        });
      }
    }
  }

  // ---------------------------------------------------------------- volatile
  const volatile = mineClaims.filter((c) => VOLATILE.has(c.kind) && !c.soft);
  const hasExpiry = /^expires\s*:/im.test(ctx.content);
  if (volatile.length && !hasExpiry) {
    const sample = volatile[0];
    notes.push({
      kind: "volatile",
      text:
        `This states a ${sample.kind} (${sample.value}${unitLabel(sample)}), which goes stale without anything changing. ` +
        `Add \`expires: YYYY-MM-DD\` to the frontmatter and Lore will flag it when the date passes.`,
    });
  }

  // ------------------------------------------------------------- consolidate
  if (ctx.sessionPages.length >= SESSION_PAGE_BUDGET) {
    notes.push({
      kind: "consolidate",
      pages: ctx.sessionPages.slice(-SESSION_PAGE_BUDGET),
      text:
        `You have created ${ctx.sessionPages.length} pages this session. ` +
        `Before the next one, check whether it belongs on a page that already exists — ` +
        `a wiki of many small pages is harder to retrieve from than one of a few good ones.`,
    });
  }

  return { notes, text: render(notes) };
}

function unitLabel(claim: Claim): string {
  if (claim.kind === "money") return claim.unit === "usd" ? " USD" : ` ${claim.unit}`;
  if (claim.kind === "port" || claim.kind === "version") return "";
  return claim.unit === "%" ? "%" : ` ${claim.unit}`;
}

/**
 * The notes as the agent sees them.
 *
 * Framed as consequences, not scolding: an agent responds to "the wiki now
 * says both" and ignores "warning: possible inconsistency".
 */
function render(notes: WriteNote[]): string {
  if (!notes.length) return "";
  return ["", "Notes on what you wrote:", ...notes.map((n) => `- ${n.text}`)].join("\n");
}

/**
 * Which pages each agent has created lately.
 *
 * "This session" has no server-side meaning — an MCP server is a process that
 * comes and goes, and the app cannot see the conversation behind it. A rolling
 * two-hour window per agent name is the honest approximation, and it is the
 * one the nudge needs: an agent that has created nine pages in two hours is
 * fragmenting whether or not that was one session.
 *
 * In memory on purpose. If Lore restarts, the count restarts, and the worst
 * case is one missing nudge.
 */
const SESSION_WINDOW_MS = 2 * 60 * 60 * 1000;
const recentCreations = new Map<string, { at: number; relPath: string }[]>();

export function recordCreation(agent: string, relPath: string): void {
  const now = Date.now();
  const kept = (recentCreations.get(agent) ?? []).filter(
    (entry) => now - entry.at < SESSION_WINDOW_MS && entry.relPath !== relPath,
  );
  kept.push({ at: now, relPath });
  recentCreations.set(agent, kept);
}

export function creationsBy(agent: string): string[] {
  const now = Date.now();
  return (recentCreations.get(agent) ?? [])
    .filter((entry) => now - entry.at < SESSION_WINDOW_MS)
    .map((entry) => entry.relPath);
}
