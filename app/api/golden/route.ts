import crypto from "node:crypto";
import { fail, requireVault } from "@/lib/server";
import { getIndex } from "@/lib/wiki";
import { readLedger } from "@/lib/verify";
import { readPolicy } from "@/lib/policy";
import { aliasesOf, buildPack } from "@/lib/pack";
import { detectOllama, recommendModel } from "@/lib/ollama";
import { rerankPack } from "@/lib/rerank";
import {
  addGolden,
  readGolden,
  readHistory,
  recordRun,
  removeGolden,
  scoreRun,
  type GoldenResult,
  type GoldenRun,
} from "@/lib/golden";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hashOf = (text: string) =>
  crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

/** GET — the golden set and how it has scored over time. */
export async function GET() {
  try {
    const vault = await requireVault();
    const [cases, history] = await Promise.all([
      readGolden(vault.root),
      readHistory(vault.root),
    ]);
    return Response.json({ cases, history: history.slice(-30) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST — add a case, or run the whole set.
 *
 * Running it goes through `buildPack` directly rather than over `/api/ask`: the
 * question being measured is whether retrieval finds the right page, and
 * putting a language model between the ranker and the score would mean a
 * ranking regression could be masked by a model that guessed well anyway.
 */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    const body = (await request.json().catch(() => ({}))) as {
      action?: "add" | "run" | "remove";
      question?: string;
      pageId?: string;
      why?: string;
      source?: "manual" | "asked";
      id?: string;
      /** Measure the reranker rather than the lexical pass alone. */
      rerank?: boolean;
    };

    if (body.action === "remove") {
      return Response.json({ cases: await removeGolden(vault.root, String(body.id ?? "")) });
    }

    if (body.action !== "run") {
      const cases = await addGolden(vault.root, {
        question: String(body.question ?? ""),
        pageId: String(body.pageId ?? ""),
        why: body.why?.trim() || undefined,
        source: body.source === "asked" ? "asked" : "manual",
      });
      return Response.json({ cases });
    }

    const cases = await readGolden(vault.root);
    if (!cases.length) return Response.json({ run: null, cases });

    const [index, ledger, policy] = await Promise.all([
      getIndex(vault.root),
      readLedger(vault.root),
      readPolicy(vault.root),
    ]);
    const withheld = new Set(policy.quarantined);
    const hashes = new Map(index.pages.map((p) => [p.id, hashOf(p.plain)]));
    const sources = index.pages
      .filter((p) => !withheld.has(p.id))
      .map((p) => ({
        id: p.id,
        relPath: p.relPath,
        title: p.title,
        plain: p.plain,
        words: p.words,
        mtime: p.mtime,
        aliases: aliasesOf(p),
      }));

    const model = body.rerank
      ? await detectOllama()
          .then((d) => (d.running ? (recommendModel(d.models) ?? d.models[0]?.name ?? null) : null))
          .catch(() => null)
      : null;

    const results: GoldenResult[] = [];
    for (const c of cases) {
      let pack = buildPack(c.question, sources, ledger, hashes, 6_000);
      if (model) {
        const outcome = await rerankPack(pack, model).catch(() => null);
        if (outcome) pack = outcome.pack;
      }
      /*
       * Rank is over distinct PAGES, in the order they first appear.
       *
       * Ranking passages instead is the error that made a better ranker look
       * worse earlier in this project: returning four fragments of the right
       * page pushes every other page down four places and scores as one hit at
       * rank one, while a ranker that returns one fragment each from four pages
       * scores the correct page at rank four for identical behaviour.
       */
      const pages: string[] = [];
      for (const p of pack.passages) if (!pages.includes(p.pageId)) pages.push(p.pageId);
      results.push({
        case: c,
        rank: pages.indexOf(c.pageId) + 1,
        got: pages.slice(0, 5),
        confidence: pack.confidence,
      });
    }

    const run: GoldenRun = { at: Date.now(), ...scoreRun(results), results };
    await recordRun(vault.root, run);
    return Response.json({ run, cases });
  } catch (error) {
    return fail(error);
  }
}
