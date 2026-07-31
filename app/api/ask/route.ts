import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readLedger } from "@/lib/verify";
import { buildPack, clampBudget } from "@/lib/pack";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import { record } from "@/lib/usage";
import { recordAsked } from "@/lib/asked";
import { embeddingStatus, semanticSearch } from "@/lib/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask the wiki a question.
 *
 * A 1,500-page corpus is not readable and never will be, so the only way a
 * human gets value from it is by asking it something and being answered. This
 * is that: retrieve passages with the existing ranker, hand them to a local
 * model, and return an answer that cites the pages it used.
 *
 * Two rules make it trustworthy rather than a confident guesser:
 *
 *  1. It answers ONLY from the retrieved passages, and is told to say so when
 *     they do not contain the answer. A wiki assistant that invents a client's
 *     rate is worse than no wiki assistant.
 *  2. Every answer ships with what it read AND what it nearly read. If the
 *     answer is wrong you can see immediately whether retrieval missed the page
 *     or the model misread it, which are different bugs with different fixes.
 *
 * Nothing is written to the wiki. The question is recorded in the usage log,
 * because a question that retrieved nothing is exactly the gap list the app
 * already knows how to show.
 */

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

const SYSTEM = `You answer questions using ONLY the numbered excerpts from the user's own wiki.

Absolute rules:
- Use only what the excerpts say. Never use outside knowledge. Never guess.
- Cite with the bracketed number of every excerpt you used, like [2].
- If the excerpts do not answer the question, say exactly what IS there and what is missing. Do not pad.
- Be direct and short. Three sentences unless the question genuinely needs more.
- No preamble, no "Based on the excerpts", no restating the question.`;

export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json()) as { question?: string; budget?: number };
    if (body.question !== undefined && typeof body.question !== "string") {
      return fail(new Error("`question` must be a string."));
    }
    const question = (body.question ?? "").trim();
    if (!question) return fail(new Error("Ask something."));

    // Shared clamp — see lib/pack. A non-finite budget used to disable the
    // check entirely and return the whole 2.3M-token corpus.
    const budget = clampBudget(body.budget);

    const [index, ledger] = await Promise.all([
      getIndex(vault.root),
      readLedger(vault.root),
    ]);

    /*
     * Semantic recall, folded in before ranking.
     *
     * 517 lines of local embeddings shipped in this repo and Ask never called
     * them — it was pure keyword ranking, which loses precisely the case a
     * person asking from memory produces: the right words for the idea and the
     * wrong words for the page. Search already blended the two; Ask did not.
     *
     * Strictly additive and never blocking. If the index is still building or
     * the model is not resident, `semanticSearch` returns nothing and this is a
     * no-op — a keyword answer now beats a semantic answer later.
     */
    let semanticBoost = new Map<string, number>();
    if (embeddingStatus().ready) {
      const hits = await semanticSearch(vault.root, question, 24).catch(() => []);
      semanticBoost = new Map(hits.map((h) => [h.id, h.score]));
    }

    const hashes = new Map(index.pages.map((p) => [p.id, hashOf(p.plain)]));
    const pack = buildPack(
      question,
      index.pages.map((p) => ({
        id: p.id,
        relPath: p.relPath,
        title: p.title,
        plain: p.plain,
        words: p.words,
      })),
      ledger,
      hashes,
      budget,
      semanticBoost,
    );

    // Recorded either way. A question that found nothing is the most useful
    // signal this app collects — it is a page you should have written.
    await record({
      t: "search",
      at: Date.now(),
      agent: "You (Ask)",
      vault: vault.root,
      query: question,
      hits: pack.passages.length,
    }).catch(() => {});

    if (!pack.passages.length) {
      return Response.json({
        question,
        answer: null,
        empty: true,
        reason:
          "Nothing in the wiki matched that. Either the page does not exist yet, or it uses different words than your question — try a phrase you would expect to see written on the page.",
        passages: [],
        omitted: [],
      });
    }

    const detection = await detectOllama().catch(() => null);
    const model = detection?.running ? (recommendModel(detection.models) ?? detection.models[0]?.name) : null;

    const numbered = pack.passages
      .map((p, i) => `[${i + 1}] ${p.title}${p.section ? ` — ${p.section}` : ""}\n${p.text}`)
      .join("\n\n");

    const answer = model
      ? await generate(model, `Question: ${question}\n\nExcerpts:\n\n${numbered}\n\nAnswer:`, {
          system: SYSTEM,
          timeoutMs: 90_000,
        }).catch(() => "")
      : "";

    const turn = {
      id: `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`,
      at: Date.now(),
      question,
      answer: answer.trim() || null,
      sources: pack.passages.slice(0, 12).map((p, i) => ({
        n: i + 1,
        pageId: p.pageId,
        relPath: p.relPath,
        title: p.title,
      })),
    };
    // Kept so the sidebar can reopen this thread without a second model call.
    await recordAsked(vault.root, turn).catch(() => {});

    return Response.json({
      id: turn.id,
      question,
      // Without a local model this still returns the ranked passages, which is
      // a worse answer but a real one — and better than the search results the
      // user would otherwise have had to read anyway.
      answer: answer.trim() || null,
      model,
      needsModel: !model,
      tokensUsed: pack.used,
      budget: pack.budget,
      passages: pack.passages.map((p, i) => ({
        n: i + 1,
        pageId: p.pageId,
        relPath: p.relPath,
        title: p.title,
        section: p.section,
        text: p.text,
        trust: p.trust,
        tokens: p.tokens,
      })),
      /* What it nearly used. This is the line between "retrieval missed it" and
         "the model misread it", and without it a wrong answer is unfixable. */
      omitted: pack.omitted,
      pagesConsidered: index.pages.length,
    });
  } catch (error) {
    return fail(error);
  }
}
