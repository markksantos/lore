#!/usr/bin/env node
/**
 * The Lore CLI.
 *
 * Exists for the two places a GUI cannot go: a shell script, and CI.
 *
 * It deliberately reimplements nothing. Every check here is the same code the
 * app runs, reached over HTTP — a second implementation of "what counts as a
 * dead link" would drift from the first within a month, and then the gate that
 * blocks your pull request would disagree with the app that told you it was
 * fine.
 *
 * If Lore is already running it uses it. If not, it starts the standalone
 * server, does its work, and stops it again, so `lore health` works from a cold
 * checkout with nothing else set up.
 *
 *   lore brief [--days N] [--write [file]]
 *   lore ask "<question>"
 *   lore health [--json] [--max-dead N] [--max-stale N] [--min-score N]
 *   lore verify <page-id>
 *   lore changes [--since ISO|ms]
 *   lore gaps
 *   lore context "<question>" [--budget N]
 *
 * Exit codes: 0 pass, 1 threshold breached, 2 could not run.
 */

import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const BASE = process.env.LORE_URL ?? "http://127.0.0.1:4646";
const argv = process.argv.slice(2);
const command = argv[0];

function flag(name, fallback = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const json = argv.includes("--json");

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/**
 * What a session was about, from its transcript.
 *
 * Claude Code writes one JSONL record per message. The first human turn is the
 * closest thing to a stated goal, and the `file_path` of every write-shaped
 * tool call is what the session actually touched. Both are facts — no model
 * call, nothing to hallucinate, and it costs a single file read.
 */
async function summariseTranscript(file) {
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (!raw) return null;

  const files = new Set();
  let goal = "";

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // A torn line costs one record, not the summary.
    }

    const message = record.message ?? record;
    if (!goal && record.type === "user" && typeof message?.content === "string") {
      goal = message.content.replace(/\s+/g, " ").trim().slice(0, 120);
    }
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const part of content) {
      if (!goal && part?.type === "text" && record.type === "user") {
        goal = String(part.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      }
      if (part?.type !== "tool_use") continue;
      const target = part.input?.file_path ?? part.input?.path;
      if (typeof target === "string" && /Write|Edit|NotebookEdit/i.test(String(part.name))) {
        files.add(target.replace(os.homedir(), "~"));
      }
    }
  }

  return { goal, files: [...files] };
}

async function reachable(url) {
  try {
    const res = await fetch(`${url}/api/vault`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start the standalone server if nothing is listening.
 *
 * Returns an async stop function. The caller must await it, including on
 * failure — a CLI that leaves a server holding port 4646 breaks the next
 * invocation and the user has no idea why.
 *
 * Awaiting matters more than it looks. Sending SIGTERM and then calling
 * process.exit() immediately does not work: the signal is delivered but the
 * child is never reaped, and it reparents to init still holding the port. This
 * was observed, not theorised. So: terminate, wait for the exit event, and
 * escalate to SIGKILL if the child refuses.
 */
async function ensureServer() {
  if (await reachable(BASE)) return async () => {};

  const entry = path.join(root, ".next", "standalone", "server.js");
  if (!existsSync(entry)) {
    fail(
      `Lore is not running and there is no standalone build to start.\n` +
        `Run \`npm run build\` first, or start the app with \`npm run dev\`.`,
    );
  }

  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, PORT: "4646", HOSTNAME: "127.0.0.1", LORE_MODE: "local" },
    stdio: "ignore",
  });

  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const hard = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => {
        clearTimeout(hard);
        resolve();
      });
      child.kill("SIGTERM");
    });

  for (let i = 0; i < 60; i++) {
    if (await reachable(BASE)) return stop;
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  fail("Started the Lore server but it never became reachable.");
}

function fail(message) {
  process.stderr.write(`lore: ${message}\n`);
  process.exit(2);
}

async function get(pathname) {
  const res = await fetch(`${BASE}${pathname}`);
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      /* raw body is the best error available */
    }
    fail(message || `Lore returned ${res.status}`);
  }
  return text;
}

const num = (v, d) => (v === undefined || v === true ? d : Number(v));

async function run() {
  const stop = await ensureServer();
  try {
    switch (command) {
      case "health": {
        const h = JSON.parse(await get("/api/health"));
        const limits = {
          dead: num(flag("max-dead"), Infinity),
          stale: num(flag("max-stale"), Infinity),
          score: num(flag("min-score"), 0),
        };

        if (json) {
          process.stdout.write(JSON.stringify(h, null, 2) + "\n");
        } else {
          process.stdout.write(
            [
              `score       ${h.score}/100`,
              `pages       ${h.pages}`,
              `dead links  ${h.unresolved.length}`,
              `orphans     ${h.orphans.length}`,
              `stale       ${h.stale.length}`,
              `untagged    ${h.untagged}`,
              "",
            ].join("\n"),
          );
        }

        const breaches = [];
        if (h.unresolved.length > limits.dead)
          breaches.push(`${h.unresolved.length} dead links exceeds --max-dead ${limits.dead}`);
        if (h.stale.length > limits.stale)
          breaches.push(`${h.stale.length} stale pages exceeds --max-stale ${limits.stale}`);
        if (h.score < limits.score)
          breaches.push(`score ${h.score} is below --min-score ${limits.score}`);

        if (breaches.length) {
          for (const b of breaches) process.stderr.write(`lore: ${b}\n`);
          return 1;
        }
        return 0;
      }

      /*
       * The brief, where you already are.
       *
       * Twelve of sixteen reviewers asked for the same thing and it did not
       * exist: the brief only lived on a screen at localhost:4646. A daily
       * habit that ships as a port number is a demo, not a habit. This puts it
       * in the terminal that is already open, and `--write` drops it on disk so
       * a cron job or a shell profile can surface it without anyone opening
       * anything.
       */
      case "brief": {
        const raw = flag("days");
        const days = raw === undefined || raw === true ? 1 : Number(raw) || 1;
        // `--peek` reads without marking anything seen, so a scripted preview
        // does not burn tomorrow's brief.
        const mark = flag("peek") ? "&mark=0" : "";
        const d = JSON.parse(await get(`/api/brief?days=${days}${mark}`));

        if (json) {
          process.stdout.write(JSON.stringify(d, null, 2) + "\n");
          return 0;
        }

        const lines = [];
        const when = days === 1 ? "today" : `the last ${days} days`;
        lines.push(`What your agents wrote ${when}\n`);
        if (!d.items.length) {
          lines.push("Nothing changed in this window.\n");
        } else {
          for (const item of d.items) {
            lines.push(`  • ${item.line}`);
            lines.push(`    ${item.title}${item.agent ? ` · ${item.agent}` : ""}\n`);
          }
          lines.push(`${d.events} writes across ${d.pagesTouched} pages.\n`);
        }
        const text = lines.join("\n");

        const target = flag("write");
        if (target) {
          const file =
            target === true
              ? path.join(os.homedir(), ".lore", "brief.md")
              : String(target);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, text, "utf8");
          process.stdout.write(`${file}\n`);
          return 0;
        }

        process.stdout.write(text);
        return 0;
      }

      case "ask": {
        const question = argv.filter((a) => !a.startsWith("--")).slice(1).join(" ");
        if (!question) {
          process.stderr.write("Usage: lore ask <question>\n");
          return 2;
        }
        const res = await fetch(`${BASE}/api/ask`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question }),
        });
        const d = await res.json();
        if (json) {
          process.stdout.write(JSON.stringify(d, null, 2) + "\n");
          return 0;
        }
        if (d.empty || (!d.answer && !d.passages?.length)) {
          process.stdout.write("Nothing in the wiki answers that.\n");
          return 0;
        }
        if (d.answer) process.stdout.write(`${d.answer}\n\n`);
        for (const p of (d.passages ?? []).slice(0, 6)) {
          process.stdout.write(`  [${p.n}] ${p.relPath}\n`);
        }
        return 0;
      }

      case "changes": {
        const raw = flag("since");
        const since =
          raw === undefined || raw === true
            ? Date.now() - 7 * 86_400_000
            : /^\d+$/.test(String(raw))
              ? Number(raw)
              : Date.parse(String(raw));
        const d = JSON.parse(await get(`/api/changes?since=${since}`));
        if (json) {
          process.stdout.write(JSON.stringify(d, null, 2) + "\n");
        } else {
          for (const c of d.changes) {
            process.stdout.write(
              `${c.relPath}  ${c.kinds.join("/")}  +${c.linesAdded}/-${c.linesRemoved}` +
                `${c.agent ? `  by ${c.agent}` : ""}\n`,
            );
          }
          process.stdout.write(`\n${d.changes.length} pages changed\n`);
        }
        return 0;
      }

      case "gaps": {
        const d = JSON.parse(await get("/api/usage?days=30"));
        if (json) {
          process.stdout.write(JSON.stringify(d.clusters, null, 2) + "\n");
        } else if (!d.clusters.length) {
          process.stdout.write("No unanswered searches in the last 30 days.\n");
        } else {
          for (const c of d.clusters) {
            process.stdout.write(`${String(c.misses).padStart(4)}  ${c.label}\n`);
          }
        }
        return 0;
      }

      case "context": {
        const query = argv[1];
        if (!query || query.startsWith("--")) fail('usage: lore context "<question>"');
        const budget = num(flag("budget"), 8000);
        process.stdout.write(
          await get(`/api/pack?format=md&budget=${budget}&q=${encodeURIComponent(query)}`),
        );
        process.stdout.write("\n");
        return 0;
      }


      /*
       * `lore install` — the command that makes everything else reachable.
       *
       * Measured over five days, 193 of 197 calls to this wiki came from the
       * human clicking Ask and 3 from an actual agent. Not because agents
       * cannot use it, but because wiring them up meant hand-editing four
       * config files in three formats. This does all of them.
       */
      case "install": {
        const only = flag("only");
        const res = await fetch(`${BASE}/api/install`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnesses:
              typeof only === "string"
                ? only.split(",").map((t) => t.trim()).filter(Boolean)
                : undefined,
            scope: typeof flag("scope") === "string" ? String(flag("scope")) : undefined,
            hooks: !flag("no-hooks"),
            dryRun: Boolean(flag("dry-run")),
            port: Number(new URL(BASE).port || 4646),
          }),
        });
        const body = await res.json();
        if (!res.ok || body.error) fail(body.error ?? `Lore returned ${res.status}`);

        const results = body.results ?? [];
        if (json) {
          process.stdout.write(JSON.stringify(results, null, 2) + "\n");
          return results.some((r) => r.state === "failed") ? 1 : 0;
        }
        if (!results.length) {
          process.stdout.write("No agent harnesses found on this machine.\n");
          return 0;
        }

        const MARK = { installed: "+", already: "=", skipped: "\u00b7", failed: "!" };
        for (const r of results) {
          process.stdout.write(`${MARK[r.state]} ${r.harness} — ${r.step}: ${r.detail}\n    ${r.path}\n`);
        }
        process.stdout.write(
          `\nRestart each app to pick up the change.${flag("dry-run") ? " (Nothing was written — this was a dry run.)" : ""}\n`,
        );
        return results.some((r) => r.state === "failed") ? 1 : 0;
      }

      /*
       * `lore capture` — the session-end half of the loop.
       *
       * Reads Claude Code's SessionEnd payload on stdin and writes one page
       * recording what the session touched. Deliberately mechanical: Lore
       * cannot make a model choose to document its work, and pretending
       * otherwise is the same mistake as the approval queue this product
       * already removed. What it CAN do is make sure the facts nobody disputes
       * — which files, under what goal, in which session — land in the wiki
       * every time, attributed, without anyone remembering to.
       */
      case "capture": {
        const payload = await readStdin();
        if (!payload) return 0;

        let hook = {};
        try {
          hook = JSON.parse(payload);
        } catch {
          return 0; // Not our payload shape; do nothing rather than guess.
        }

        const session = String(hook.session_id ?? hook.sessionId ?? "").slice(0, 12);
        const transcript = hook.transcript_path ?? hook.transcriptPath;
        const summary = transcript ? await summariseTranscript(transcript) : null;

        // A session that touched nothing is not worth a page. Writing one
        // anyway is how a wiki fills with noise nobody can retrieve from.
        if (!summary || (!summary.files.length && !summary.goal)) return 0;

        const day = new Date().toISOString().slice(0, 10);
        const body = [
          `## ${new Date().toISOString().slice(11, 16)} — ${summary.goal || "session"}`,
          "",
          summary.files.length
            ? `Touched: ${summary.files.slice(0, 12).map((f) => `\`${f}\``).join(", ")}`
            : null,
          session ? `Session: ${session}` : null,
          "",
        ]
          .filter((line) => line !== null)
          .join("\n");

        const res = await fetch(`${BASE}/api/page`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: `sessions/${day}.md`,
            content: body,
            mode: "append",
            agent: "Claude Code",
            session,
          }),
        });
        if (!res.ok) return 0;
        return 0;
      }

      /*
       * `lore eval` — did that change make retrieval better or worse?
       *
       * The synthetic harness cannot answer this: its questions are different
       * every run, so a worse ranker on an easier set scores higher and says
       * nothing. This runs the fixed golden set, compares against the previous
       * run, and exits non-zero on a regression, which makes it usable as a
       * gate rather than a thing you read and forget.
       */
      case "eval": {
        const res = await fetch(`${BASE}/api/golden`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "run", rerank: Boolean(flag("rerank")) }),
        });
        const body = await res.json();
        if (!res.ok || body.error) fail(body.error ?? `Lore returned ${res.status}`);
        if (!body.run) {
          process.stdout.write(
            "The golden set is empty. Add cases from Ask, or seed one with:\n" +
              "  node scripts/eval-retrieval.mjs --n 20 --save-golden\n",
          );
          return 0;
        }

        const run = body.run;
        if (json) {
          process.stdout.write(JSON.stringify(run, null, 2) + "\n");
          return 0;
        }

        const pct = (v) => `${Math.round(v * 100)}%`;
        process.stdout.write(
          [
            `${run.cases} cases`,
            `  recall@1     ${pct(run.recallAt1)}`,
            `  recall@5     ${pct(run.recallAt5)}`,
            `  median rank  ${run.medianRank || "—"}`,
            `  never found  ${run.missed}`,
            "",
          ].join("\n"),
        );

        const failures = run.results.filter((r) => r.rank !== 1);
        if (failures.length) {
          process.stdout.write("Not at rank 1:\n");
          for (const f of failures.slice(0, 15)) {
            process.stdout.write(
              `  ${f.rank === 0 ? "miss" : `#${f.rank}`}  ${f.case.question}\n` +
                `        want ${f.case.pageId}\n` +
                `        got  ${f.got.slice(0, 3).join(", ") || "nothing"}\n`,
            );
          }
          process.stdout.write("\n");
        }

        // Compare against the run before this one, which the API has already
        // appended — so index -2 is the previous state of the world.
        const history = JSON.parse(await get("/api/golden")).history ?? [];
        const previous = history[history.length - 2];
        if (previous) {
          const delta = run.recallAt1 - previous.recallAt1;
          const arrow = delta > 0.001 ? "up" : delta < -0.001 ? "DOWN" : "unchanged";
          process.stdout.write(
            `recall@1 ${arrow} from ${pct(previous.recallAt1)} (${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} points)\n`,
          );
          const threshold = Number(flag("max-drop", 5)) / 100;
          if (delta < -threshold) {
            process.stderr.write(`\nRegression: recall@1 fell more than ${Math.round(threshold * 100)} points.\n`);
            return 1;
          }
        }
        return 0;
      }

      case "verify": {
        const pageId = argv[1];
        if (!pageId || pageId.startsWith("--")) fail("usage: lore verify <page-id>");
        const res = await fetch(`${BASE}/api/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "verify", pageId }),
        });
        const body = await res.json();
        if (!res.ok || body.error) fail(body.error ?? `Lore returned ${res.status}`);
        process.stdout.write(`verified ${pageId}\n`);
        return 0;
      }

      default:
        process.stdout.write(
          [
            "lore <command>",
            "",
            "  brief    [--days N] [--write [file]]",
            "  ask      \"<question>\"",
            "  health   [--json] [--max-dead N] [--max-stale N] [--min-score N]",
            "  changes  [--since ISO|ms] [--json]",
            "  gaps     [--json]",
            "  context  \"<question>\" [--budget N]",
            "  verify   <page-id>",
            "  install  [--only a,b] [--scope prefix] [--no-hooks] [--dry-run]",
            "  capture  (reads a SessionEnd hook payload on stdin)",
            "  eval     [--json] [--rerank] [--max-drop N]   run the golden set",
            "",
            "Exit 1 when a health threshold is breached, so it can gate CI.",
            "",
          ].join("\n"),
        );
        return command ? 2 : 0;
    }
  } finally {
    await stop();
  }
}

run().then(
  (code) => process.exit(code ?? 0),
  (error) => fail(error instanceof Error ? error.message : String(error)),
);
