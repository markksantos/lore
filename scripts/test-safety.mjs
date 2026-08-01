#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * The read-only boundary must list every route that can write the vault.
 *
 * D5 in the adversarial review: /api/undo overwrote pages with writeRaw and was
 * NOT in VAULT_WRITERS, so read-only mode did not stop it. The list is derived
 * by hand, so this test derives the TRUTH from the source — every route that
 * imports writeRaw / createPage / deletePage — and asserts the hand list covers
 * it. If a future route writes and forgets to register, this fails loudly.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const { VAULT_WRITERS, auditGap } = await import("../lib/safety.ts");

const API = path.join(process.cwd(), "app", "api");
const WRITERS = /\b(writeRaw|createPage|deletePage)\b/;
// Routes that write via an internal fetch to /api/page (already gated there),
// not by importing a writer directly — they are covered transitively.
const INDIRECT = new Set(["/api/timeline", "/api/listen", "/api/enrich"]);

const writing = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name === "route.ts") {
      const src = await readFile(full, "utf8");
      if (WRITERS.test(src)) {
        const route = "/api/" + path.relative(API, dir).split(path.sep).join("/");
        writing.push(route);
      }
    }
  }
}
await walk(API);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

const direct = writing.filter((r) => !INDIRECT.has(r));
const gap = auditGap(direct);
check("every direct vault-writing route is in VAULT_WRITERS", gap.length === 0, `unlisted: ${gap.join(", ")}`);
check("/api/undo is gated (D5 regression)", "/api/undo" in VAULT_WRITERS);
check("/api/review is gated", "/api/review" in VAULT_WRITERS);
console.log(`\nroutes that write directly: ${direct.join(", ")}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
