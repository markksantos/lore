import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readLedger } from "@/lib/verify";
import { buildPack, clampBudget , aliasesOf } from "@/lib/pack";
import { detectOllama, generate, generateStream, recommendModel } from "@/lib/ollama";
import { record } from "@/lib/usage";
import { recordAsked } from "@/lib/asked";
import { embeddingStatus, semanticSearch } from "@/lib/embeddings";
import { rerankPack } from "@/lib/rerank";
import { extractClaims, findConflicts } from "@/lib/claims";
import { listVersions, readVersion } from "@/lib/history";
import { vaultKey } from "@/lib/journal";
import { toPlainText } from "@/lib/index-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below this the lexical ordering is doubtful enough to be worth a second pass. */
const RERANK_BELOW = 0.6;

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
    const body = (await request.json()) as {
      question?: string;
      budget?: number;
      /** Send tokens as they arrive rather than the whole answer at the end. */
      stream?: boolean;
      /**
       * Earlier turns in this thread, oldest first.
       *
       * Ask started every question cold, so "what about the second one" was
       * unanswerable and every follow-up had to restate its own subject. The
       * prior turns do two jobs: they go into the prompt so the model can
       * resolve a pronoun, and their questions are folded into the retrieval
       * query so "and the deadline?" still retrieves the right pages.
       */
      thread?: { question: string; answer: string | null }[];
      /**
       * Answer from the wiki as it stood at this millisecond.
       *
       * A wiki is a record of what you believed, and the current text erases
       * every earlier belief. "What did I think about this in May" is a real
       * question with a real answer sitting in the version history, reachable
       * nowhere in the product until now.
       */
      asOf?: number;
    };
    if (body.question !== undefined && typeof body.question !== "string") {
      return fail(new Error("`question` must be a string."));
    }
    const question = (body.question ?? "").trim();
    if (!question) return fail(new Error("Ask something."));

    const thread = (body.thread ?? []).slice(-4);
    const asOf = Number.isFinite(body.asOf) && body.asOf ? Number(body.asOf) : null;
    /*
     * Retrieval sees the conversation, not just the last line.
     *
     * "What about the deadline?" contains no retrievable term at all. Appending
     * the previous questions gives the ranker the subject the asker has stopped
     * repeating, weighted behind the current question because the current
     * question is still what they asked.
     */
    const retrievalQuery = thread.length
      ? `${question} ${thread.map((t) => t.question).join(" ")}`
      : question;

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
      const hits = await semanticSearch(vault.root, retrievalQuery, 24).catch(() => []);
      semanticBoost = new Map(hits.map((h) => [h.id, h.score]));
    }

    /*
     * Rewind the corpus.
     *
     * Only pages with a snapshot from before the cutoff are rewritten; a page
     * with no history is left as it is, because "no snapshot" means "unchanged
     * since", not "did not exist". Pages created after the cutoff are dropped
     * outright — quoting them would be answering a question about May with
     * something written in July.
     */
    let sources = index.pages;
    if (asOf) {
      const key = vaultKey(vault.root);
      const rewound = [];
      for (const page of index.pages) {
        const versions = await listVersions(key, page.relPath).catch(() => []);
        const before = versions
          .filter((v) => v.at <= asOf)
          .sort((a, b) => b.at - a.at)[0];
        if (before) {
          const content = await readVersion(key, page.relPath, before.at).catch(() => null);
          if (content !== null) {
            rewound.push({ ...page, plain: toPlainText(content), mtime: before.at });
            continue;
          }
        }
        if (page.mtime <= asOf || !versions.length) rewound.push(page);
      }
      sources = rewound;
    }

    const hashes = new Map(index.pages.map((p) => [p.id, hashOf(p.plain)]));
    let pack = buildPack(
      retrievalQuery,
      sources.map((p) => ({
        id: p.id,
        relPath: p.relPath,
        title: p.title,
        plain: p.plain,
        words: p.words,
        mtime: p.mtime,
        aliases: aliasesOf(p),
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

    /*
     * Rerank, but only when the lexical pass is unsure.
     *
     * The model reading twelve passages costs seconds, and Ask was brought down
     * from thirty of them to under seven — spending that back on every question
     * would undo the work for the many questions the ranker already gets right.
     * Low confidence is exactly the case where the ordering is doubtful and the
     * answer was going to be poor anyway, so that is where the time is worth
     * spending.
     */
    if (pack.confidence < RERANK_BELOW && model) {
      const outcome = await rerankPack(pack, model).catch(() => null);
      if (outcome) pack = outcome.pack;
    }

    const numbered = pack.passages
      .map((p, i) => `[${i + 1}] ${p.title}${p.section ? ` — ${p.section}` : ""}\n${p.text}`)
      .join("\n\n");

    /*
     * Do the sources contradict each other?
     *
     * Averaging two disagreeing pages into one fluent paragraph is the most
     * damaging thing this feature can do, because the answer looks exactly like
     * a correct one. Running the conflict detector over only the retrieved
     * pages is cheap — a dozen pages, not sixteen hundred — and surfaces it
     * next to the answer instead of leaving it buried in the sources.
     */
    const retrievedPages = [...new Set(pack.passages.map((p) => p.pageId))]
      .map((id) => index.pages.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const disagreements = findConflicts(
      retrievedPages.flatMap((p) =>
        extractClaims({
          id: p.id,
          relPath: p.relPath,
          title: p.title,
          plain: p.plain,
          mtime: p.mtime,
        }),
      ),
      3,
      true,
    ).map((c) => ({
      subject: c.subject,
      values: [...new Set(c.claims.map((x) => x.value))],
      pages: [...new Set(c.claims.map((x) => x.relPath))],
    }));

    const conversation = thread.length
      ? `Earlier in this conversation:\n${thread
          .map((t) => `Q: ${t.question}\nA: ${t.answer ?? "(no answer)"}`)
          .join("\n\n")}\n\n`
      : "";
    const prompt = `${conversation}Question: ${question}\n\nExcerpts:\n\n${numbered}\n\nAnswer:`;

    /*
     * Streaming.
     *
     * Same model, same prompt, same total time — the only thing that changes is
     * when the reader stops wondering whether it is working. The passages go
     * first, in one metadata frame, so the sources render before the first
     * token rather than after the last.
     */
    if (body.stream && model) {
      const encoder = new TextEncoder();
      const meta = {
        question,
        model,
        tokensUsed: pack.used,
        budget: pack.budget,
        confidence: pack.confidence,
        verdict: pack.verdict,
        passages: pack.passages.map((p, i) => ({
          n: i + 1,
          pageId: p.pageId,
          relPath: p.relPath,
          title: p.title,
          section: p.section,
          anchor: p.anchor,
          text: p.text,
          trust: p.trust,
          tokens: p.tokens,
        })),
        omitted: pack.omitted,
      };

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) =>
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

          send("meta", meta);
          let text = "";
          try {
            text = await generateStream(
              model,
              prompt,
              (chunk) => send("token", chunk),
              { system: SYSTEM, timeoutMs: 120_000 },
            );
          } catch {
            send("error", "The local model stopped before finishing.");
          }

          const streamedTurn = {
            id: `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`,
            at: Date.now(),
            question,
            answer: text.trim() || null,
            sources: meta.passages.slice(0, 12).map((p) => ({
              n: p.n,
              pageId: p.pageId,
              relPath: p.relPath,
              title: p.title,
            })),
          };
          await recordAsked(vault.root, streamedTurn).catch(() => {});
          send("done", { id: streamedTurn.id });
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }

    const answer = model
      ? await generate(model, prompt, {
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
      // Surfaced so the UI can say "the wiki may not cover this" instead of
      // rendering a hedged answer with the same confidence as a certain one.
      confidence: pack.confidence,
      verdict: pack.verdict,
      disagreements,
      asOf,
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
