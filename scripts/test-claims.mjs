#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * Planted contradictions.
 *
 * The detector this replaces scored 0 of 9 on the real wiki and nobody knew,
 * because there was no case where the right answer was written down in
 * advance. Every case below states what the detector is supposed to say before
 * it runs, and half of them are traps — pairs that look like disagreements and
 * are not.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/test-claims.mjs
 */

import { extractClaims, findConflicts, conflictsWith } from "../lib/claims.ts";

const page = (relPath, body, mtime = Date.now()) => ({
  id: relPath,
  relPath,
  title: relPath.split("/").pop().replace(/\.md$/, "").replace(/-/g, " "),
  plain: body,
  mtime,
});

const CASES = [
  {
    name: "same subject, disagreeing timeout",
    expect: true,
    pages: [
      page("stack/deploy-pipeline.md", "# Deploy pipeline\n\nThe deploy pipeline timeout is 30 seconds before the job is killed.\n"),
      page("stack/deploy-notes.md", "# Deploy notes\n\nOur deploy pipeline timeout is 5 seconds, which is too aggressive.\n"),
    ],
  },
  {
    name: "same subject, disagreeing port",
    expect: true,
    pages: [
      page("apps/grimoire.md", "# Grimoire\n\nThe grimoire wiki viewer runs on port 4747 locally.\n"),
      page("apps/grimoire-setup.md", "# Grimoire setup\n\nStart it and the grimoire viewer listens on port 4646 instead.\n"),
    ],
  },
  {
    name: "different clients, different prices",
    expect: false,
    pages: [
      page("clients/acme/profile.md", "Charged 50 thumbnails per video order for this client.\n"),
      page("clients/globex/profile.md", "Charged 35 thumbnails per video order for this client.\n"),
    ],
  },
  {
    name: "history, not disagreement",
    expect: false,
    pages: [
      page("pricing/rates.md", "# Rates\n\nThe video edit floor is $150 per finished video.\n"),
      page("pricing/history.md", "# History\n\nThe video edit floor was previously $100 per finished video.\n"),
    ],
  },
  {
    name: "rate card, not disagreement",
    expect: false,
    pages: [
      page("pricing/card.md", "# Card\n\n| tier | price |\n| --- | --- |\n| short video | $100 |\n| long video | $400 |\n"),
      page("pricing/card-b.md", "# Card B\n\n| tier | price |\n| --- | --- |\n| short video | $250 |\n| long video | $900 |\n"),
    ],
  },
  {
    name: "generated profile headers",
    expect: false,
    pages: [
      page("clients/a/profile.md", "messages: 31\nupdated: 2026-08-01\ncurrent chat: 12 threads\n"),
      page("clients/b/profile.md", "messages: 27\nupdated: 2026-08-01\ncurrent chat: 9 threads\n"),
    ],
  },
  {
    name: "file sizes are not versions",
    expect: false,
    pages: [
      page("assets/a.md", "The export came out at 2.61 MB after compression.\n"),
      page("assets/b.md", "The export came out at 1.13 MB after compression.\n"),
    ],
  },
  {
    name: "same subject across folders, strong shared vocabulary",
    expect: true,
    cross: true,
    pages: [
      page("feedback/video-floor.md", "# Video floor\n\nThe fiverr video edit floor is $100 and never goes below it.\n"),
      page("pricing/fiverr-rates.md", "# Fiverr rates\n\nThe fiverr video edit floor is $150 for every order.\n"),
    ],
  },
];

let pass = 0;
let fail = 0;

for (const c of CASES) {
  const claims = c.pages.flatMap((p) => extractClaims(p));
  const found = findConflicts(claims, 20, c.cross === true);
  const got = found.length > 0;
  const ok = got === c.expect;
  if (ok) pass++;
  else fail++;
  const detail = found
    .map((f) => `${f.subject} [${[...new Set(f.claims.map((x) => x.value))].join(" vs ")}]`)
    .join("; ");
  console.log(
    `${ok ? "pass" : "FAIL"}  ${c.name}\n      expected ${c.expect ? "a conflict" : "no conflict"}, got ${found.length}${detail ? ` — ${detail}` : ""}`,
  );
}

/*
 * Write-time is a different question with a different bar: it fires while an
 * agent is waiting, so it must not fire on a page that merely mentions money.
 */
const existing = [
  ...extractClaims(page("pricing/rates.md", "# Rates\n\nThe video edit floor is $150 per finished video.\n")),
  ...extractClaims(page("stack/deploy.md", "# Deploy\n\nThe deploy pipeline timeout is 30 seconds.\n")),
];

const WRITE_CASES = [
  {
    name: "incoming contradicts the rate card",
    expect: true,
    body: "The video edit floor is $100 per finished video, agreed today.\n",
  },
  {
    name: "incoming agrees with the rate card",
    expect: false,
    body: "The video edit floor is $150 per finished video, confirmed.\n",
  },
  {
    name: "incoming is unrelated",
    expect: false,
    body: "Bought a monitor for $150 and it arrived in 2 days.\n",
  },
];

for (const c of WRITE_CASES) {
  const incoming = extractClaims(page("drafts/new-note.md", c.body));
  const hits = conflictsWith(incoming, existing);
  const ok = hits.length > 0 === c.expect;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "pass" : "FAIL"}  write-time: ${c.name}\n      expected ${c.expect ? "a warning" : "silence"}, got ${hits.length}` +
      (hits.length ? ` — ${hits[0].existing.relPath} says ${hits[0].existing.value}` : ""),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
