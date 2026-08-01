#!/usr/bin/env node
/**
 * Does Ask actually find the right page?
 *
 * Everything else in this repo is an opinion about whether Lore is useful. This
 * is the only file that produces a number, and the number decides it: if asking
 * the wiki does not reliably retrieve the page that holds the answer, then Ask
 * is a slower `grep` with a confident voice and should not exist.
 *
 * Method — synthetic QA, which needs no hand-labelled set and no judgement:
 *   1. Pick N real pages from the vault at random (skipping raw capture, which
 *      nobody asks questions about).
 *   2. Ask a local model to write a question that THIS page answers, using only
 *      the page's own text.
 *   3. Send that question to /api/ask.
 *   4. Score recall@k: did the source page come back among the retrieved
 *      passages, and at what rank.
 *
 * The trick that makes it honest is step 2's constraint: the model is told not
 * to reuse the page's distinctive wording. A question built by copying a rare
 * phrase is trivially retrievable by any string matcher and measures nothing.
 *
 *   node scripts/eval-retrieval.mjs [--n 30] [--base http://127.0.0.1:4848]
 *
 * Read-only. It asks questions and reads pages; it never writes to the vault.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE = flag("base", "http://127.0.0.1:4848");
const N = Number(flag("n", 30));
const OLLAMA = "http://127.0.0.1:11434";

const CAPTURE = /(^|\/)(raw|transcripts?|captures?|exports?|dumps?)(\/|$)|\.srt$/i;

/**
 * The baseline: what you already have for free.
 *
 * A number with no control measures nothing, and the first version of this file
 * reported "recall@1 0% -> 50%" against nothing but its own earlier self — a
 * fix to our own bug, graded by us. The honest question is not "did retrieval
 * improve" but "does it beat ripgrep on the same folder", because ripgrep is
 * already installed, already fast, and already what the alternative looks like.
 *
 * Same query, same corpus: grep every term, rank pages by how many distinct
 * query terms they contain, break ties by total hits. That is roughly what a
 * person or an agent gets from a couple of `rg` calls.
 */
async function ripgrepRank(root, terms, limit = 40) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const perTerm = await Promise.all(
    terms.map(async (term) => {
      const out = await run("rg", ["-il", "--glob", "*.md", "--", term, root], {
        maxBuffer: 32 * 1024 * 1024,
      })
        .then((r) => r.stdout)
        .catch(() => "");
      return new Set(
        out.split("\n").filter(Boolean).map((f) => f.replace(`${root}/`, "").replace(/\.mdx?$/i, "")),
      );
    }),
  );

  const score = new Map();
  for (const set of perTerm) {
    for (const id of set) score.set(id, (score.get(id) ?? 0) + 1);
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

const STOP = new Set(["the","and","for","are","was","what","when","where","which","who","how","why","did","does","is","it","that","this","with","from","have","has","had","about","into","than","then","their","they","you","your","our","not","but","can","could","would","should","will","may","any","all","some","most","more","much","many"]);

const queryTerms = (q) =>
  q.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((t) => (t.length > 2 || /\d/.test(t)) && !STOP.has(t));

const QUESTION_SYSTEM = `You write one question that a specific document answers.

Rules:
- Output ONLY the question. No preamble, no quotes, no numbering.
- The question must be answerable from the document alone.
- Ask about the SUBSTANCE — a fact, a decision, a number, a person, a rule.
- Write it the way the document's owner would ask it months later, from memory.
- NAME THE SUBJECT. Say who or what it is about — the client, the project, the tool.
  "What was the client's budget?" is unanswerable across a wiki with 700 clients and
  measures nothing; "What was Dylan's budget for the wedding edit?" is a real question.
- Do NOT copy the document's distinctive phrasing verbatim; paraphrase the rest. A
  question built from a rare phrase tests string matching, not retrieval — but the
  subject's NAME is not a trick, it is how people ask.
- If the document is too thin or too generic to ask anything specific about, output exactly: SKIP`;

async function json(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function pickModel() {
  const tags = await json(`${OLLAMA}/api/tags`).catch(() => null);
  if (!tags?.models?.length) return null;
  // Prefer a small fast model for question writing; this runs N times.
  const names = tags.models.map((m) => m.name);
  return (
    names.find((n) => /gemma.*12b|gemma.*4b|qwen.*7b|llama.*8b/i.test(n)) ?? names[0]
  );
}

async function writeQuestion(model, page, text) {
  const body = {
    model,
    system: QUESTION_SYSTEM,
    prompt: `Document title: ${page.title}\n\nDocument:\n${text.slice(0, 2500)}\n\nQuestion:`,
    stream: false,
    think: false,
    options: { temperature: 0.3 },
  };
  const out = await json(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const q = (out?.response ?? "").trim().split("\n")[0].replace(/^["']|["']$/g, "").trim();
  if (!q || /^skip$/i.test(q) || q.length < 15) return null;
  return q;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  const model = await pickModel();
  if (!model) {
    console.error("No Ollama model available — this eval needs one to write questions.");
    process.exit(2);
  }

  const index = await json(`${BASE}/api/pages`);
  const candidates = index.pages.filter(
    (p) => !CAPTURE.test(p.relPath) && p.words > 120 && p.words < 4000,
  );
  if (candidates.length < N) {
    console.error(`Only ${candidates.length} eligible pages; lower --n.`);
    process.exit(2);
  }

  // Deterministic sample so re-runs are comparable across code changes.
  const step = Math.floor(candidates.length / N);
  const sample = Array.from({ length: N }, (_, i) => candidates[i * step]);

  console.log(`model: ${model}`);
  console.log(`corpus: ${index.pages.length} pages, ${candidates.length} eligible`);
  console.log(`sampling ${N}\n`);

  const ranks = [];
  const rgRanks = [];
  const misses = [];
  let asked = 0;
  let skipped = 0;
  let answered = 0;

  /*
   * `--save-golden` turns this run into a fixed set.
   *
   * The synthetic harness cannot detect a regression, because the questions
   * change every run — a worse ranker on an easier question set scores better
   * and nothing says so. Saving one run's questions, paired with the pages that
   * are supposed to answer them, converts it into a set that can be re-run
   * after every ranking change and compared honestly.
   */
  const saveGolden = args.includes("--save-golden");
  const golden = [];

  for (const page of sample) {
    const full = await json(
      `${BASE}/api/page?path=${encodeURIComponent(page.relPath)}`,
    ).catch(() => null);
    if (!full?.raw) {
      skipped++;
      continue;
    }

    const question = await writeQuestion(model, page, full.raw);
    if (!question) {
      skipped++;
      continue;
    }
    asked++;

    if (saveGolden) golden.push({ question, pageId: page.id });

    const result = await json(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }).catch(() => null);

    /*
     * Rank among DISTINCT PAGES, not among passages.
     *
     * The first version of this scored position in the passage array, which is
     * not comparable across ranking changes: when passages got smaller, one
     * page started occupying six slots and every page's index inflated, so a
     * strictly better ranker scored worse. The question is "how far down the
     * list of pages is the right one", and that is what this measures.
     */
    const hits = result?.passages ?? [];
    const seen = [];
    for (const h of hits) if (!seen.includes(h.pageId)) seen.push(h.pageId);
    const rank = seen.indexOf(page.id);
    if (result?.answer) answered++;

    // Same question, ripgrep on the same folder.
    const rgHits = await ripgrepRank(index.root, queryTerms(question)).catch(() => []);
    const rgRank = rgHits.indexOf(page.id);
    if (rgRank !== -1) rgRanks.push(rgRank + 1);

    if (rank === -1) {
      misses.push({ page: page.relPath, question, got: hits.slice(0, 3).map((h) => h.relPath) });
      process.stdout.write("·");
    } else {
      ranks.push(rank + 1);
      process.stdout.write(rank === 0 ? "1" : rank < 5 ? "5" : "+");
    }
  }

  const at = (k) => ranks.filter((r) => r <= k).length;
  const pct = (n) => `${Math.round((100 * n) / Math.max(asked, 1))}%`;

  console.log("\n\n─── retrieval ───────────────────────────────");
  if (saveGolden) {
    for (const g of golden) {
      await fetch(`${BASE}/api/golden`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", source: "manual", ...g }),
      }).catch(() => {});
    }
    console.log(`saved ${golden.length} cases to the golden set\n`);
  }

  console.log(`questions asked        ${asked}   (${skipped} skipped as unaskable)`);
  console.log(`recall@1               ${pct(at(1))}  ${at(1)}/${asked}`);
  console.log(`recall@5               ${pct(at(5))}  ${at(5)}/${asked}`);
  console.log(`recall@20              ${pct(at(20))}  ${at(20)}/${asked}`);
  console.log(`found anywhere         ${pct(ranks.length)}  ${ranks.length}/${asked}`);
  console.log(`median rank when found ${median(ranks) ?? "—"}`);
  console.log(`answered by the model  ${pct(answered)}`);

  const rgAt = (k) => rgRanks.filter((r) => r <= k).length;
  console.log("\n─── ripgrep baseline, same questions ───────");
  console.log(`recall@1               ${pct(rgAt(1))}  ${rgAt(1)}/${asked}`);
  console.log(`recall@5               ${pct(rgAt(5))}  ${rgAt(5)}/${asked}`);
  console.log(`found anywhere         ${pct(rgRanks.length)}  ${rgRanks.length}/${asked}`);
  console.log(`median rank when found ${median(rgRanks) ?? "—"}`);

  if (misses.length) {
    console.log("\n─── misses (the source page never came back) ───");
    for (const m of misses.slice(0, 10)) {
      console.log(`\n  want: ${m.page}`);
      console.log(`  q:    ${m.question}`);
      console.log(`  got:  ${m.got.join(", ") || "(nothing)"}`);
    }
    if (misses.length > 10) console.log(`\n  …and ${misses.length - 10} more`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
