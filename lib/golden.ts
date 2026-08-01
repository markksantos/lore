import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";

/**
 * The golden set — questions whose right answer is written down in advance.
 *
 * `scripts/eval-retrieval.mjs` measures retrieval by having a local model
 * invent a question per page, then checking whether that page comes back. It is
 * a good harness and it cannot detect a regression, because the questions are
 * different every run: a worse ranker on an easier question set scores better,
 * and nothing in the output says so. Twice during this project a ranking change
 * was judged by a number that had moved for the wrong reason.
 *
 * A golden set fixes that by fixing the questions. Each entry names a question
 * and the page that answers it, both chosen once by a human. Re-running it after
 * any change to the ranker answers the only question that matters — did this
 * make retrieval better or worse — and answers it the same way twice.
 *
 * Stored per vault, outside it, so the set follows the wiki without polluting a
 * folder of notes with test fixtures.
 */

const DIR = path.join(os.homedir(), ".lore");
const filePath = (key: string) => path.join(DIR, `golden-${key}.json`);

export type GoldenCase = {
  id: string;
  question: string;
  /** The page id that should be retrieved. */
  pageId: string;
  /** How it got here: a human typed it, or it came out of a real session. */
  source: "manual" | "asked";
  addedAt: number;
  /** Optional note about why this case exists. */
  why?: string;
};

export type GoldenResult = {
  case: GoldenCase;
  /** 1-indexed rank of the expected page, or 0 when it never appeared. */
  rank: number;
  /** Pages that came back instead, best first, for reading a failure. */
  got: string[];
  confidence: number;
};

export type GoldenRun = {
  at: number;
  cases: number;
  recallAt1: number;
  recallAt5: number;
  /** Median rank over cases that were found at all. */
  medianRank: number;
  missed: number;
  results: GoldenResult[];
};

export async function readGolden(root: string): Promise<GoldenCase[]> {
  const raw = await fs.readFile(filePath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as GoldenCase[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(root: string, cases: GoldenCase[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath(vaultKey(root)), JSON.stringify(cases, null, 2), "utf8");
}

export async function addGolden(
  root: string,
  entry: Omit<GoldenCase, "id" | "addedAt">,
): Promise<GoldenCase[]> {
  const cases = await readGolden(root);
  const question = entry.question.trim();
  if (!question || !entry.pageId) return cases;

  // The same question twice is one case. Keeping both would double-count it in
  // every score for as long as the set exists.
  const deduped = cases.filter(
    (c) => c.question.trim().toLowerCase() !== question.toLowerCase(),
  );
  const next: GoldenCase[] = [
    ...deduped,
    { ...entry, question, id: `g${Date.now().toString(36)}`, addedAt: Date.now() },
  ];
  await write(root, next);
  return next;
}

export async function removeGolden(root: string, id: string): Promise<GoldenCase[]> {
  const next = (await readGolden(root)).filter((c) => c.id !== id);
  await write(root, next);
  return next;
}

// ------------------------------------------------------------------- history

const historyPath = (key: string) => path.join(DIR, `golden-${key}-history.jsonl`);

/** Score summaries over time, so a regression is visible as a drop. */
export async function recordRun(root: string, run: GoldenRun): Promise<void> {
  const { results, ...summary } = run;
  void results;
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs
    .appendFile(historyPath(vaultKey(root)), JSON.stringify(summary) + "\n", "utf8")
    .catch(() => {});
}

export async function readHistory(root: string): Promise<Omit<GoldenRun, "results">[]> {
  const raw = await fs.readFile(historyPath(vaultKey(root)), "utf8").catch(() => "");
  const out: Omit<GoldenRun, "results">[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn final line costs one record.
    }
  }
  return out;
}

/**
 * Score a set of results.
 *
 * recall@1 is the number that matters most and the one most easily flattered:
 * measured over PASSAGES rather than pages, a ranker that returns four
 * fragments of the right page scores four times for one correct answer. Rank is
 * therefore always the position of the page, deduplicated, which is what an
 * agent actually consumes.
 */
export function scoreRun(results: GoldenResult[]): Omit<GoldenRun, "results" | "at"> {
  const found = results.filter((r) => r.rank > 0);
  const ranks = found.map((r) => r.rank).sort((a, b) => a - b);
  const total = results.length || 1;

  return {
    cases: results.length,
    recallAt1: results.filter((r) => r.rank === 1).length / total,
    recallAt5: results.filter((r) => r.rank > 0 && r.rank <= 5).length / total,
    medianRank: ranks.length ? ranks[Math.floor(ranks.length / 2)] : 0,
    missed: results.length - found.length,
  };
}
