#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * What Lore says back to an agent that just wrote.
 *
 * The value of this channel is entirely in its precision — a warning that is
 * wrong once is a channel the model ignores forever — so every case below
 * states in advance which note is supposed to appear, and several state that
 * none should.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/test-write-feedback.mjs
 */

import { buildIndex, parsePage } from "../lib/index-core.ts";
import { reviewWrite } from "../lib/write-feedback.ts";

const VAULT = [
  [
    "pricing/rates.md",
    "---\ntype: reference\n---\n\n# Rates\n\nThe video edit floor is $150 per finished video. Nothing ships below it.\n",
  ],
  [
    "stack/deploy.md",
    "---\ntype: reference\n---\n\n# Deploy\n\nThe deploy pipeline timeout is 30 seconds. See [[pricing/rates]].\n",
  ],
  [
    "clients/acme.md",
    "---\ntype: project\n---\n\n# Acme\n\nAcme runs a weekly video series and pays on delivery.\n",
  ],
];

function indexOf(extra = []) {
  const pages = [...VAULT, ...extra].map(([relPath, raw]) =>
    parsePage(relPath, raw, Date.now()),
  );
  return buildIndex("/tmp/vault", pages);
}

const SCHEMA = `# Schema

| field | required | type |
| --- | --- | --- |
| type | yes | string |
| updated | yes | date |
`;

const CASES = [
  {
    name: "contradicts an existing number",
    relPath: "notes/pricing-call.md",
    content: "---\ntype: note\nupdated: 2026-08-01\n---\n\n# Pricing call\n\nThe video edit floor is $100 per finished video, agreed on the call.\n",
    expect: ["contradiction"],
  },
  {
    name: "duplicates a page that already exists",
    relPath: "pricing/rates-copy.md",
    content: "---\ntype: reference\nupdated: 2026-08-01\n---\n\n# Rates\n\nThe video edit floor is $150 per finished video. Nothing ships below it.\n",
    expect: ["duplicate"],
    // The duplicate note carries the suggestion; the contradiction cannot fire
    // because the numbers agree.
    forbid: ["contradiction"],
  },
  {
    name: "links to nothing",
    relPath: "notes/acme-meeting.md",
    content:
      "---\ntype: note\nupdated: 2026-08-01\n---\n\n# Acme meeting\n\nAcme confirmed the weekly series continues through the autumn, with the same " +
      "delivery cadence and the same review process as before. Nothing about the arrangement changes.\n",
    expect: ["link"],
  },
  {
    name: "missing required frontmatter",
    relPath: "notes/bare.md",
    content: "# Bare\n\nSomething happened worth writing down, at reasonable length so the page is not a stub.\n",
    schema: SCHEMA,
    expect: ["schema"],
  },
  {
    name: "states a price with no expiry",
    relPath: "notes/new-service.md",
    content: "---\ntype: note\nupdated: 2026-08-01\n---\n\n# New service\n\nThe rush surcharge for a same-day turnaround is $220 on top of the base fee.\n",
    expect: ["volatile"],
  },
  {
    name: "fragmenting the wiki",
    relPath: "notes/tenth.md",
    content: "---\ntype: note\nupdated: 2026-08-01\n---\n\n# Tenth\n\nA short note about scheduling that could have gone on an existing page.\n",
    sessionPages: Array.from({ length: 9 }, (_, i) => `notes/n${i}.md`),
    expect: ["consolidate"],
  },
  {
    name: "an ordinary, well-formed page",
    relPath: "notes/quiet.md",
    content:
      "---\ntype: note\nupdated: 2026-08-01\n---\n\n# Quiet\n\nThe review call moved to Thursday mornings. See [[stack/deploy]] for the release " +
      "steps that follow it, which are unchanged.\n",
    expect: [],
  },
];

let pass = 0;
let fail = 0;

for (const c of CASES) {
  const index = indexOf([[c.relPath, c.content]]);
  const { notes } = reviewWrite({
    index,
    relPath: c.relPath,
    content: c.content,
    schema: c.schema ?? null,
    sessionPages: c.sessionPages ?? [],
  });
  const kinds = notes.map((n) => n.kind);

  const missing = c.expect.filter((k) => !kinds.includes(k));
  const forbidden = (c.forbid ?? []).filter((k) => kinds.includes(k));
  const unexpected = c.expect.length === 0 && kinds.length > 0 ? kinds : [];
  const ok = !missing.length && !forbidden.length && !unexpected.length;

  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${c.name}\n      wanted [${c.expect.join(", ") || "nothing"}], got [${kinds.join(", ") || "nothing"}]`,
  );
  if (!ok && notes.length) for (const n of notes) console.log(`        ${n.kind}: ${n.text}`);
}

/*
 * Context sizing (see lib/ollama contextFor).
 *
 * Sizing num_ctx to the prompt took Ask from ~19s to ~9.5s, but the failure
 * mode if it is ever sized too SMALL is silent: Ollama truncates the prompt and
 * answers from a fragment, with no error. So the invariant under test is that
 * the window always exceeds a generous estimate of the prompt.
 */
const { contextFor } = await import("../lib/ollama.ts");
for (const chars of [200, 3_000, 12_000, 40_000, 90_000]) {
  const prompt = "x".repeat(chars);
  const window = contextFor(prompt, "system prompt here");
  // Even at a pessimistic 2 chars/token the window must still fit the prompt.
  const pessimistic = Math.ceil(chars / 2);
  const ok = window >= pessimistic || window === 131_072;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "pass" : "FAIL"}  contextFor(${chars} chars) = ${window} (fits pessimistic ${pessimistic})`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
