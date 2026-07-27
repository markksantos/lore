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
 *   lore health [--json] [--max-dead N] [--max-stale N] [--min-score N]
 *   lore verify <page-id>
 *   lore changes [--since ISO|ms]
 *   lore gaps
 *   lore context "<question>" [--budget N]
 *
 * Exit codes: 0 pass, 1 threshold breached, 2 could not run.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
            "  health   [--json] [--max-dead N] [--max-stale N] [--min-score N]",
            "  changes  [--since ISO|ms] [--json]",
            "  gaps     [--json]",
            "  context  \"<question>\" [--budget N]",
            "  verify   <page-id>",
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
