#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * The listener, tested end to end without touching anything real.
 *
 * HOME is redirected to a scratch directory, so candidate discovery reads
 * planted transcripts instead of real ones; the wiki write is captured by a
 * throwaway HTTP server, so nothing lands in an actual vault. The distillation
 * test runs against the real local Ollama — that call being real is the point,
 * since the assertion that matters is "the planted secret never comes out".
 *
 * Run: node --experimental-strip-types --no-warnings --import ./scripts/alias-loader.mjs scripts/test-listen.mjs
 */

import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";

// HOME must move BEFORE the module under test computes its paths.
const SCRATCH = path.join(os.tmpdir(), `lore-listen-test-${Date.now().toString(36)}`);
process.env.HOME = SCRATCH;
mkdirSync(SCRATCH, { recursive: true });

const {
  scrub,
  turnsFromClaudeCode,
  turnsFromCodex,
  turnsFromChatGPTExport,
  renderTurns,
  distil,
  sweep,
  writeListenConfig,
  DEFAULT_LISTEN,
} = await import("../lib/listen.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

// ------------------------------------------------------------------ parsers

const claudeRaw = [
  JSON.stringify({ type: "user", message: { content: "We decided the video floor is $150." } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Noted: floor is $150, effective today." }] } }),
  JSON.stringify({ type: "user", message: { content: "<system-reminder>plumbing</system-reminder>" } }),
  "{torn json",
].join("\n");
const claudeTurns = turnsFromClaudeCode(claudeRaw);
check("claude-code parser: 2 turns, plumbing skipped", claudeTurns.length === 2, `got ${claudeTurns.length}`);

const codexRaw = [
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Use rebase, not merge." } }),
  JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "Agreed — rebase from now on." } }),
].join("\n");
const codexTurns = turnsFromCodex(codexRaw);
check("codex parser: 2 turns, events skipped", codexTurns.length === 2, `got ${codexTurns.length}`);

const chatgptTurns = turnsFromChatGPTExport(
  JSON.stringify([{ mapping: { a: { message: { author: { role: "user" }, content: { parts: ["Remember: deploys happen Fridays."] } } }, b: { message: { author: { role: "system" }, content: { parts: ["ignored"] } } } } }]),
);
check("chatgpt export parser: user kept, system dropped", chatgptTurns.length === 1, `got ${chatgptTurns.length}`);

// -------------------------------------------------------------------- scrub

const dirty = [
  "my key is sk-ant-abc123def456ghi789jkl012 ok",
  "header Bearer abcdefghijklmnopqrstuvwx sent",
  "postgres://admin:hunter2secret@db.internal/prod",
  "password: supersecret123",
  "ghp_abcdefghijklmnopqrstuvwxyz123456",
  // The shapes the review proved slipped through (D2/M4):
  "CLOUDFLARE_API_TOKEN=abcdef0123456789abcdef0123456789abcdef01",
  "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
  'DB_PASSWORD="correct horse battery staple"',
  "AIzaSyD-abcdefghijklmnopqrstuvwxyz012345",
  "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz1234567890",
  "token 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
].join("\n");
const clean = scrub(dirty);
check(
  "scrub removes every planted secret shape",
  !/(sk-ant-abc|hunter2|supersecret123|ghp_abcdef|abcdefghijklmnopqrstuvwx|abcdef0123456789|wJalrXUt|correct horse|AIzaSyD-abc|github_pat_11ABC|9f86d081884c)/.test(clean),
  clean,
);
check("scrub leaves ordinary text alone", scrub("the floor is $150 per video") === "the floor is $150 per video");

// D1: a PEM whose END marker is clipped away must still be redacted by the body.
const pem = "-----BEGIN RSA PRIVATE KEY-----\n" + "MIIEowIBAAKCAQEA" + "a".repeat(1500);
check("scrub redacts a private-key BODY even without its END marker",
  !scrub(pem).includes("MIIEowIBAAKCAQEA"), scrub(pem).slice(0, 60));

// D1 (order): a secret past the 700-char per-turn clip must still be redacted,
// because distil scrubs BEFORE renderTurns clips. Proven via the real path in
// the distil test below; here we assert renderTurns of a pre-scrubbed turn is
// clean.
const longTurn = { role: "user", text: "x".repeat(720) + " AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY" };
check("a secret beyond the clip window is caught by pre-clip scrub",
  !renderTurns([{ ...longTurn, text: scrub(longTurn.text) }]).includes("wJalrXUt"));

// ------------------------------------------------------------------ budget

const many = Array.from({ length: 200 }, (_, i) => ({ role: "user", text: `turn ${i} ${"x".repeat(400)}` }));
const rendered = renderTurns(many, 5_000);
check("renderTurns respects the budget", rendered.length <= 5_200, `${rendered.length} chars`);
check("renderTurns keeps the newest turns", rendered.includes("turn 199"));

// ------------------------------------------------------------------- distil

const distilled = await distil([
  { role: "user", text: "Quick decision to record: from August we invoice clients on the 1st, not the 15th, because the 15th kept straddling card statement cycles and clients disputed charges. Also my API key is sk-ant-veryrealsecret12345678 — do not lose it. ".repeat(2) },
  { role: "assistant", text: "Understood. Invoicing moves to the 1st of each month, reason: statement-cycle disputes. I will not record the key." },
]);
if (distilled.state === "no-model") {
  console.log("skip  distil tests — no local model running");
} else {
  check("distil produced facts", distilled.state === "facts", distilled.state);
  if (distilled.state === "facts") {
    const joined = distilled.bullets.join("\n");
    check("distilled facts mention the invoicing change", /invoic/i.test(joined), joined);
    check("distilled facts NEVER contain the secret", !joined.includes("veryrealsecret"), joined);
  }
}

// ---------------------------------------------------------- sweep, isolated

// Plant a Claude Code transcript in the fake HOME, quiet since 10 minutes ago.
const projectDir = path.join(SCRATCH, ".claude", "projects", "-fake-project");
mkdirSync(projectDir, { recursive: true });
const transcript = path.join(projectDir, "session-abc.jsonl");
writeFileSync(
  transcript,
  [
    JSON.stringify({ type: "user", message: { content: "Decision: the staging server moves to port 5555 permanently, because 5000 collides with AirPlay on macOS and cost us an afternoon." } }),
    JSON.stringify({ type: "assistant", message: { content: "Recorded — staging on 5555, AirPlay collision on 5000 was the reason." } }),
  ].join("\n") + "\n",
);
const quiet = new Date(Date.now() - 10 * 60_000);
utimesSync(transcript, quiet, quiet);

// Capture the wiki write instead of performing one.
const writes = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    writes.push({ url: req.url, body: JSON.parse(body || "{}") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

await writeListenConfig("/fake/vault", {
  ...DEFAULT_LISTEN,
  enabled: true,
  sources: { "claude-code": true, codex: false, inbox: false },
  quietMinutes: 3,
});

const result = await sweep("/fake/vault", port);

if (result.skipped.noModel) {
  console.log("skip  sweep distillation — no local model running");
} else {
  check("sweep found the planted transcript", result.scanned >= 1, `scanned ${result.scanned}`);
  check("sweep filed facts through the write path", result.filed === 1 && writes.length === 1, `filed ${result.filed}`);
  if (writes.length) {
    const write = writes[0].body;
    check("filed under auto/claude-code/<date>", /^auto\/claude-code\/\d{4}-\d{2}-\d{2}\.md$/.test(write.path), write.path);
    check("append mode, attributed to the listener", write.mode === "append" && /^Auto-wiki/.test(write.agent), `${write.mode} ${write.agent}`);
    check("the fact survived distillation", /5555/.test(write.content), write.content.slice(0, 200));
  }
  // Second sweep: nothing new, nothing re-filed.
  const again = await sweep("/fake/vault", port);
  check("second sweep is a no-op", again.scanned === 0 && again.filed === 0, JSON.stringify(again));

  // M5: append two records after sweep 1; the first must not be eaten. Read the
  // filed content and confirm BOTH new facts survive the delta boundary.
  const fs2 = await import("node:fs");
  // The fact lives in the FIRST appended line — the one the old bug ate. If it
  // survives distillation, the delta boundary is correct.
  fs2.appendFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { content: "Important decision to record permanently: from now on we invoice every client using the number prefix MS-2000 instead of the old MS-1100, because MS-1100 collided with the legacy Bubble portal's own numbering and two clients were double-billed last month. This applies to all new invoices starting today." } }),
      JSON.stringify({ type: "assistant", message: { content: "Recorded: invoice number prefix is now MS-2000, replacing MS-1100, to stop the collision with the legacy Bubble numbering that caused double-billing." } }),
    ].join("\n") + "\n",
  );
  const later = new Date(Date.now() - 10 * 60_000);
  fs2.utimesSync(transcript, later, later);
  const before = writes.length;
  const third = await sweep("/fake/vault", port);
  const newWrite = writes[writes.length - 1];
  check("M5: a post-sweep append is not eaten at the delta boundary",
    third.filed === 1 && newWrite && /MS-2000/.test(newWrite.body.content), JSON.stringify(third));
}

server.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
