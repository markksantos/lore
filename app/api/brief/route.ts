import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readJournal, vaultKey, watchVault } from "@/lib/journal";
import { attributionByPath, readAttribution } from "@/lib/harness";
import { buildBrief, changedText, lineFrom, type Brief } from "@/lib/brief";
import { listVersions, readVersion } from "@/lib/history";
import { readRaw } from "@/lib/wiki";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import { markSeen, readSeen } from "@/lib/seen";
import { embeddingStatus, ensureIndex } from "@/lib/embeddings";
import { isMuted, readMuted, toggleMuted } from "@/lib/muted";
import { askGate } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — mute or unmute a page or folder prefix. */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const { prefix } = (await request.json().catch(() => ({}))) as { prefix?: string };
    return Response.json({ muted: await toggleMuted(vault.root, String(prefix ?? "")) });
  } catch (error) {
    return fail(error);
  }
}

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

/**
 * Warm the semantic index in the background, once per process.
 *
 * Semantic search was behind a button on the Settings screen. A feature that
 * requires you to know it exists, find it, and wait for a build before it does
 * anything is a feature nobody uses — and it is the half of retrieval that
 * catches the questions the keyword ranker cannot, which are exactly the
 * questions people give up on.
 *
 * Started from the brief because the brief is the first screen, so this begins
 * the moment the app opens. Fire-and-forget: `ensureIndex` returns as soon as
 * the work is scheduled, only re-embeds pages whose text changed, and every
 * caller of it already treats "not ready" as "skip semantic".
 */
let warming = false;

function warmEmbeddings(root: string, pages: { id: string; title: string; text: string }[]): void {
  if (warming || embeddingStatus().error) return;
  warming = true;
  void ensureIndex(root, pages).catch(() => {
    // An index that will not build must cost nothing: search stays lexical.
  });
}

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
  /*
   * The brief's model calls yield to Ask.
   *
   * Both talk to the same single Ollama, and eight brief lines queued behind a
   * question — or worse, in front of one — is how everything times out at
   * once. If the inference slot is taken, the brief ships its fallback lines
   * NOW and improves next refresh, which is precisely what the two-pass
   * client was built to absorb.
   */
  return askGate.tryRun(() => synthesiseInner(brief), brief);
}

async function synthesiseInner(brief: Brief): Promise<Brief> {
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

  /*
   * `synthesised` means EVERY line was written, not merely one of them.
   *
   * It was true as soon as any line came back, so a brief where the model
   * handled seven of eight reported itself as fully synthesised — and the
   * "install Ollama and Lore will write these properly" banner disappeared on
   * a brief that still had a fallback line in it, which is the one case where
   * the banner is telling the truth. The count is reported alongside so the UI
   * can say which lines are which rather than making a claim about all of them.
   */
  let written = 0;
  const items = brief.items.map((item, i) => {
    const line = lines[i];
    if (!line) return item;
    written += 1;
    return { ...item, line, written: true };
  });

  return {
    ...brief,
    items,
    synthesised: written > 0 && written === brief.items.length,
    written,
  };
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

    const [index, rawEvents, attributions, seen, muted] = await Promise.all([
      getIndex(vault.root),
      readJournal(vaultKey(vault.root), since),
      readAttribution(since),
      readSeen(vault.root),
      readMuted(vault.root),
    ]);

    /*
     * Muted paths never reach the ranker.
     *
     * Filtered here rather than after ranking so a muted folder cannot consume
     * the per-folder spread quota and push real news off the page — the whole
     * point of muting `sessions/` is that its forty daily writes stop competing
     * for attention, not that they compete and then get hidden.
     */
    const events = muted.length
      ? rawEvents.filter((event) => !isMuted(muted, event.relPath))
      : rawEvents;

    warmEmbeddings(
      vault.root,
      index.pages.map((page) => ({ id: page.id, title: page.title, text: page.plain })),
    );

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
    return Response.json({ ...final, muted });
  } catch (error) {
    return fail(error, 409);
  }
}
