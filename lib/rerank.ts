import { generate } from "@/lib/ollama";
import type { Pack, Passage } from "@/lib/pack";

/**
 * Re-score the top passages with the local model.
 *
 * The ranker is a bag of words. It is fast, it runs over 1,600 pages in
 * milliseconds, and it cannot tell that "what do I charge for a video" and "the
 * video edit floor is $150" are the same subject unless they share vocabulary.
 * Everything clever in `pack.ts` — IDF, page-level evidence, trust weighting,
 * recency — is a way of making a lexical scorer behave, and it has a ceiling.
 *
 * A model reading the question next to the passage does not have that ceiling.
 * It is also four orders of magnitude slower, which is why this reranks the top
 * dozen rather than the corpus: the lexical pass is the recall stage and this is
 * the precision stage, which is the standard shape for a reason.
 *
 * Three properties make it safe to turn on:
 *
 *   - It can only reorder. Nothing enters or leaves the pack here, so a
 *     confused model can cost you the best passage's position, never the
 *     passage.
 *   - It is skipped entirely when no model is resident. A keyword answer now
 *     beats a reranked answer in ninety seconds.
 *   - A malformed reply is discarded rather than parsed optimistically. The
 *     original order is the fallback, and the original order was already good.
 */

/** How many passages are worth the model's time. */
const RERANK_TOP = 12;

/**
 * Characters of each passage shown to the judge.
 *
 * 500 truncated most passages mid-thought — `splitSections` caps a section at
 * ~400 tokens, which is about 1,600 characters, so the judge was scoring the
 * first third of the evidence and demoting correct pages whose answer sat
 * below the cut. Raised and re-measured on the golden set rather than assumed.
 */
const EXCERPT = 1_600;

/**
 * Blend rather than replace.
 *
 * Trusting the model's ordering outright throws away everything the lexical
 * score knows — that a passage sits on a page a human verified, that it is not
 * from a raw transcript, that it is recent. Keeping both means the model has to
 * disagree strongly to overturn a strong lexical hit, which is the behaviour
 * you want from a second opinion.
 */
const MODEL_WEIGHT = 0.65;

const SYSTEM = `You score how well a passage answers a question.

Reply with one line per passage, in the form "N: score", where N is the passage
number and score is 0 to 10.

10 = contains the answer outright.
5  = about the right subject, does not answer it.
0  = unrelated.

No prose, no explanation, no other text.`;

function buildPrompt(query: string, passages: Passage[]): string {
  const blocks = passages.map(
    (p, i) =>
      `[${i + 1}] ${p.title}${p.section ? ` — ${p.section}` : ""}\n${p.text.slice(0, EXCERPT).trim()}`,
  );
  return [`Question: ${query}`, "", ...blocks, "", `Score all ${passages.length}.`].join("\n");
}

/**
 * Parse "3: 8" lines into scores.
 *
 * Deliberately tolerant of surrounding junk and strict about the numbers: a
 * small model will sometimes wrap the list in a sentence, which is harmless,
 * and will sometimes return nine scores for twelve passages, which is not —
 * the missing ones keep their lexical rank rather than being treated as zero.
 */
function parseScores(reply: string, count: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const match of reply.matchAll(/^\s*\[?(\d{1,2})\]?\s*[:.)-]\s*(\d{1,2}(?:\.\d+)?)/gm)) {
    const index = Number(match[1]) - 1;
    const score = Number(match[2]);
    if (index < 0 || index >= count || !Number.isFinite(score)) continue;
    out.set(index, Math.max(0, Math.min(10, score)));
  }
  return out;
}

export type RerankOutcome = {
  pack: Pack;
  /** Whether the model actually reordered anything. */
  applied: boolean;
  reason: string;
};

export async function rerankPack(
  pack: Pack,
  model: string | null,
  timeoutMs = 25_000,
): Promise<RerankOutcome> {
  if (!model) return { pack, applied: false, reason: "no local model" };
  if (pack.passages.length < 2) return { pack, applied: false, reason: "nothing to reorder" };

  const head = pack.passages.slice(0, RERANK_TOP);
  const tail = pack.passages.slice(RERANK_TOP);

  let reply: string;
  try {
    reply = await generate(model, buildPrompt(pack.query, head), { system: SYSTEM, timeoutMs });
  } catch {
    return { pack, applied: false, reason: "model did not answer in time" };
  }

  const scores = parseScores(reply, head.length);
  // Fewer than half parsed means the reply was not the shape we asked for, and
  // reordering on three of twelve scores is worse than not reordering.
  if (scores.size < Math.ceil(head.length / 2)) {
    return { pack, applied: false, reason: "model reply could not be read" };
  }

  const lexicalMax = Math.max(...head.map((p) => p.score), 1e-6);
  const blended = head
    .map((passage, i) => {
      const model01 = (scores.get(i) ?? 5) / 10;
      const lexical01 = passage.score / lexicalMax;
      return {
        passage,
        blended: model01 * MODEL_WEIGHT + lexical01 * (1 - MODEL_WEIGHT),
        original: i,
      };
    })
    // Ties keep their original order, so a model that scores everything 7
    // changes nothing at all.
    .sort((a, b) => b.blended - a.blended || a.original - b.original);

  const moved = blended.some((b, i) => b.original !== i);

  /*
   * Confidence follows the rerank.
   *
   * If the model says the best passage is a 3, the pack does not answer the
   * question however well it scored lexically — and reporting 70% confidence
   * on top of a reordering that just said otherwise would be the pack lying
   * about itself in a new way.
   */
  const bestModelScore = Math.max(...[...scores.values()], 0) / 10;
  const confidence = Math.min(pack.confidence, 0.25 + bestModelScore * 0.75);

  return {
    pack: {
      ...pack,
      passages: [...blended.map((b) => b.passage), ...tail],
      confidence,
      verdict:
        bestModelScore < 0.4
          ? "LOW CONFIDENCE — a local model read these and found none of them answers the question. Treat them as leads and say the wiki may not cover this."
          : pack.verdict,
    },
    applied: moved,
    reason: moved ? "reordered by the local model" : "model agreed with the existing order",
  };
}
