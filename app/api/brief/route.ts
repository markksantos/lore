import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readJournal, vaultKey, watchVault } from "@/lib/journal";
import { attributionByPath, readAttribution } from "@/lib/harness";
import { buildBrief, changedText, lineFrom, type Brief } from "@/lib/brief";
import { listVersions, readVersion } from "@/lib/history";
import { readRaw } from "@/lib/wiki";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import { markSeen, readSeen } from "@/lib/seen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The brief.
 *
 * Reads the journal, ranks what is worth knowing, and — when a local model is
 * installed — rewrites each item as a sentence about what the page now SAYS
 * rather than what happened to the file. That second half is the whole point:
 * "deploy-pipeline.md, +12 −31" is a changelog, and "the deploy pipeline moved
 * from nightly to on-push" is news.
 *
 * The model is optional and strictly an upgrade. Without it every line falls
 * back to the page's own first sentence, which is worse but never blank, and
 * the response says which of the two you got.
 */

/** Bounded so one enormous window cannot make the brief slow to the point of unused. */
const MAX_SYNTHESISED = 8;

/*
 * Written lines, kept.
 *
 * Every load fired eight local-model calls — including each toggle between
 * Today / This week / This month, and every refresh. On a 12B model that is
 * most of ten seconds to regenerate sentences that had not changed, which is
 * how a home screen becomes something you avoid opening.
 *
 * Keyed by page + the exact text that was summarised, so a line is reused only
 * while the thing it describes is identical, and a fresh edit always gets a
 * fresh sentence. In memory: it is a cache, and losing it on restart costs one
 * slow load.
 */
const lineCache = new Map<string, string>();
const CACHE_MAX = 400;

function cacheKey(pageId: string, evidence: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < evidence.length; i++) {
    h ^= evidence.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${pageId}:${(h >>> 0).toString(16)}`;
}

const SYSTEM = `You turn a wiki edit into a one-line update for the person who owns the wiki.
Rules, all of them absolute:
- Exactly one sentence, under 22 words, no trailing period needed.
- Say what is TRUE NOW according to the new text. Never describe the edit, the file, or the line count.
- Use only facts present in the text given. If it is too thin to summarise, reply with the single word SKIP.
- No preamble, no quotes, no markdown, no "This page". Just the sentence.`;

/**
 * Replace each item's evidence with the lines that actually changed.
 *
 * History snapshots the text a write replaced, so for anything Lore watched
 * there is a real before. Where there isn't — a page whose only version is the
 * current one — the item keeps the page-top evidence, which is a weaker line
 * but still a true one.
 */
async function withDiffs(root: string, key: string, brief: Brief): Promise<Brief> {
  const items = await Promise.all(
    brief.items.map(async (item) => {
      if (item.kind === "created" || item.kind === "deleted") return item;
      const versions = await listVersions(key, item.relPath).catch(() => []);
      const previous = versions[0];
      if (!previous) return item;
      const [before, after] = await Promise.all([
        readVersion(key, item.relPath, previous.at).catch(() => null),
        readRaw(root, item.relPath).catch(() => null),
      ]);
      if (!before || !after) return item;
      const changed = changedText(before, after);
      // A rename or a whitespace-only edit produces no new prose. Nothing was
      // said, so there is nothing to report — the page-top line would be a
      // fabricated update.
      // The line is re-derived here, not just the evidence: without this the
      // diff was computed and then discarded on every path the model did not
      // rewrite — no Ollama, a timeout, or ?plain=1.
      return changed.trim().length > 40
        ? { ...item, evidence: changed, line: lineFrom(changed) }
        : item;
    }),
  );
  return { ...brief, items };
}

async function synthesise(brief: Brief): Promise<Brief> {
  const detection = await detectOllama().catch(() => null);
  if (!detection?.running || !detection.models.length) return brief;
  const model = recommendModel(detection.models) ?? detection.models[0]?.name;
  if (!model) return brief;

  const targets = brief.items.slice(0, MAX_SYNTHESISED);
  const lines = await Promise.all(
    targets.map(async (item) => {
      if (!item.evidence.trim()) return null;
      const key = cacheKey(item.pageId, item.evidence);
      const cached = lineCache.get(key);
      // "" is a cached rejection — the model already declined this text.
      if (cached !== undefined) return cached || null;
      const text = await generate(
        model,
        `Page title: ${item.title}\n\nExcerpt:\n${item.evidence}\n\nOne sentence:`,
        { system: SYSTEM, timeoutMs: 25_000 },
      ).catch(() => "");
      const clean = text.trim().split("\n")[0].replace(/^["'`]|["'`]$/g, "").trim();
      const reject = () => {
        if (lineCache.size > CACHE_MAX) lineCache.clear();
        lineCache.set(key, "");
        return null;
      };
      // A model that says SKIP, returns nothing, or starts narrating the edit
      // is worse than the page's own first sentence, so it loses.
      if (!clean || /^skip$/i.test(clean) || clean.length > 220) return reject();
      if (/^(this page|the page|updated|added|changed)\b/i.test(clean)) return reject();
      // Crude bound rather than an LRU: this is a cache of short strings and
      // the cost of occasionally dropping a warm one is one model call.
      if (lineCache.size > CACHE_MAX) lineCache.clear();
      lineCache.set(key, clean);
      return clean;
    }),
  );

  let used = false;
  const items = brief.items.map((item, i) => {
    const line = lines[i];
    if (!line) return item;
    used = true;
    return { ...item, line };
  });

  return { ...brief, items, synthesised: used };
}

export async function GET(request: Request) {
  try {
    const vault = await requireVault();
    // Starting the watcher here matters: the brief is the first screen, so this
    // is where a freshly linked vault begins recording at all.
    await watchVault(vault.root);

    const params = new URL(request.url).searchParams;
    const days = Math.min(365, Math.max(1, Number(params.get("days") ?? 1) || 1));
    const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
    const limit = Math.min(30, Math.max(1, Number(params.get("limit") ?? 8) || 8));
    const withModel = params.get("plain") !== "1";
    const since = Date.now() - days * 86_400_000;

    const [index, events, attributions, seen] = await Promise.all([
      getIndex(vault.root),
      readJournal(vaultKey(vault.root), since),
      readAttribution(since),
      readSeen(vault.root),
    ]);

    const brief = buildBrief(
      index,
      events,
      since,
      limit,
      attributionByPath(attributions, vault.root),
      seen,
      offset,
    );

    const withChanges = await withDiffs(vault.root, vaultKey(vault.root), brief);
    const final = withModel ? await synthesise(withChanges) : withChanges;

    /*
     * Record what we just showed, so tomorrow's brief is not today's.
     *
     * Deliberately after synthesis and only for what actually made the cut —
     * marking candidates would burn pages the reader never saw. `mark=0` exists
     * for the CLI and for previewing without consuming the news.
     */
    if (params.get("mark") !== "0") {
      await markSeen(vault.root, final.items.map((i) => i.pageId)).catch(() => {});
    }
    return Response.json(final);
  } catch (error) {
    return fail(error, 409);
  }
}
