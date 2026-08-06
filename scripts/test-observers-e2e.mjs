/**
 * Oracle, Understudy and Prophet against scratch data.
 *
 * Every corpus here is written by this script into a temporary folder. The
 * user's own mail, messages and wiki are never enabled — partly because this
 * runs on a live stream, and partly because a test that depends on somebody's
 * real inbox is a test that passes on one machine.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const oracle = await import("@/lib/oracle.ts");
const understudy = await import("@/lib/understudy.ts");
const prophet = await import("@/lib/prophet.ts");
const observers = await import("@/lib/observers.ts");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};
const section = (name) => console.log(`\n${name}`);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "lore-e2e-"));
const docs = path.join(root, "docs");
const letters = path.join(root, "letters");
await fs.mkdir(docs, { recursive: true });
await fs.mkdir(letters, { recursive: true });

await fs.writeFile(
  path.join(docs, "rates.md"),
  "# Rates\n\nThe editing rate for a short film is 480 dollars. Colour grading is billed separately at 120 dollars an hour. Turnaround is four working days.\n",
);
await fs.writeFile(
  path.join(docs, "kickoff.md"),
  "# Kickoff\n\nWe agreed the delivery date is the fourteenth. Footage arrives on a hard drive. The client wants two cuts, one long and one for social.\n",
);
await fs.writeFile(path.join(docs, "unrelated.md"), "# Recipes\n\nBoil the pasta for eleven minutes.\n");

/* A consistent voice: short sentences, heavy contractions, no semicolons. */
for (let i = 0; i < 12; i++) {
  await fs.writeFile(
    path.join(letters, `note-${i}.md`),
    [
      "Hey — quick one.",
      "I've pushed the fix. It's live now, so you're clear to test.",
      "Didn't touch the pricing logic. That's still on me for Thursday.",
      "Let me know if anything looks off. I'll turn it round same day.",
      `Cheers, and sorry for the ${i} follow-ups.`,
    ].join(" "),
  );
}

const beforeObservers = await observers.readObservers();
const beforeOracle = await oracle.readOracleConfig();
const beforeUnderstudy = await understudy.readUnderstudyConfig();

try {
  // ------------------------------------------------------------------ Oracle
  section("Oracle");
  await oracle.forgetOracle();
  await oracle.writeOracleConfig({
    ...beforeOracle,
    sources: { files: true, mail: false, calendar: false, messages: false, notes: false, browser: false, photos: false },
    roots: [docs],
  });
  await observers.setObserver("oracle", true);

  const first = await oracle.reindexOracle(["files"]);
  const filesPass = first.passes.find((p) => p.source === "files");
  check("the file source indexes", (filesPass?.added ?? 0) === 3, JSON.stringify(filesPass));
  check("a bounded pass reports completion", filesPass?.complete === true);

  const hits = oracle.searchOracle("colour grading");
  check("full-text search finds the page", hits.hits.length >= 1);
  check("the snippet marks the matched words", hits.hits[0]?.snippet.includes("«"));

  const filtered = oracle.searchOracle("grading", { sources: ["mail"] });
  check("a source filter excludes non-matching sources", filtered.hits.length === 0);

  const second = await oracle.reindexOracle(["files"]);
  const secondPass = second.passes.find((p) => p.source === "files");
  check("re-indexing unchanged files adds nothing", (secondPass?.added ?? 0) === 0);

  /* mtime moves forward, so the file is seen again and UPDATED rather than
     duplicated — the unique index on (source, nativeId) is what guarantees it. */
  await fs.writeFile(path.join(docs, "rates.md"), "# Rates\n\nThe editing rate is now 520 dollars.\n");
  await new Promise((r) => setTimeout(r, 1100));
  const third = await oracle.reindexOracle(["files"]);
  const thirdPass = third.passes.find((p) => p.source === "files");
  check("a changed file updates rather than duplicates", (thirdPass?.updated ?? 0) === 1 && (thirdPass?.added ?? 0) === 0, JSON.stringify(thirdPass));
  check("the index total did not grow", (await oracle.oracleStatus()).items === 3);

  const status = await oracle.oracleStatus();
  check("every source is probed even when off", status.sources.length === 7);
  check("a disabled-but-present source still reports availability", typeof status.sources[0].available === "boolean");

  // -------------------------------------------------------------- Understudy
  section("Understudy");
  await understudy.forgetUnderstudy();
  await understudy.writeUnderstudyConfig({
    ...beforeUnderstudy,
    sources: { wiki: false, "sent-mail": false, messages: false, folders: true },
    folders: [letters],
    minWords: 20,
  });
  await observers.setObserver("understudy", true);

  const learned = await understudy.learnVoice();
  const folders = learned.reports.find((r) => r.source === "folders");
  check("samples are collected", (folders?.added ?? 0) === 12, JSON.stringify(folders));
  check("a profile is built", learned.profile.overall.samples === 12);

  const voice = learned.profile.overall;
  check("the measured voice is terse", voice.sentenceMedian <= 10, `median ${voice.sentenceMedian}`);
  check("the measured voice uses contractions", voice.contractionRate > 0.7, `rate ${voice.contractionRate}`);
  check("the measured voice avoids semicolons", voice.semicolonRate === 0);
  check("characteristic words are found", voice.signature.length > 0);

  const brief = understudy.voiceBrief(voice);
  check("the brief states the median", brief.includes(`median ${voice.sentenceMedian} words`));
  check("the brief is shown in full, not summarised", brief.split("\n").length >= 8);

  /* The scorer must be able to tell this voice from its opposite. */
  const formal = "I am writing to inform you that the aforementioned deliverables have been completed; consequently, the remaining items shall follow in due course.";
  const scoredFormal = understudy.compareVoice(voice, formal);
  const scoredOwn = understudy.compareVoice(voice, "Hey — quick one. I've pushed it. It's live, so you're clear.");
  check("a matching draft scores higher than a mismatched one", scoredOwn.match > scoredFormal.match, `${scoredOwn.match} vs ${scoredFormal.match}`);
  check("a mismatched draft names its deviations", scoredFormal.deviations.length > 0);

  // ----------------------------------------------------------------- Prophet
  section("Prophet");
  await prophet.forgetProphet();
  await observers.setObserver("prophet", true);
  const thought = await prophet.think();
  check("thinking completes without throwing", typeof thought.considered === "number");
  const cards = await prophet.currentCards();
  check("cards are a list", Array.isArray(cards));
  const pstatus = await prophet.prophetStatus();
  check("status reports which sources are live", typeof pstatus.sources.oracle === "boolean");
  check("Oracle is seen as a live source", pstatus.sources.oracle === true);

  /* Dismissing must actually turn the volume down for that kind. */
  const db = prophet.prophetDb();
  db.run(
    "INSERT INTO cards (id, kind, at, until, weight, title, body, evidence, state) VALUES (?,?,?,?,?,?,?,?,0)",
    "test:1", "silent-contact", Date.now(), null, 0.9, "A test card", null, "[]",
  );
  const beforeMultiplier = prophet.kindMultiplier(db, "silent-contact");
  prophet.respond("test:1", "dismiss");
  prophet.respond("test:1", "dismiss");
  const afterMultiplier = prophet.kindMultiplier(db, "silent-contact");
  check("dismissing lowers the weight of that kind", afterMultiplier < beforeMultiplier, `${beforeMultiplier} → ${afterMultiplier}`);
  check("a dismissed card is not shown", !(await prophet.currentCards()).some((c) => c.id === "test:1"));
} finally {
  await oracle.forgetOracle();
  await understudy.forgetUnderstudy();
  await prophet.forgetProphet();
  await oracle.writeOracleConfig(beforeOracle);
  await understudy.writeUnderstudyConfig(beforeUnderstudy);
  for (const id of ["oracle", "understudy", "prophet"]) {
    await observers.setObserver(id, beforeObservers.observers[id].enabled);
  }
  await fs.rm(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
