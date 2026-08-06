#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * The parsers underneath the observers.
 *
 * Every one of these reads a format somebody else owns — Apple's epochs, a
 * `.emlx`, an iCalendar file, FTS5's query grammar, a Claude Code transcript —
 * and every one of them failed at least once during development in a way that
 * produced no error at all: a message dated to the year 500 million, a search
 * box that silently returned the opposite of what was asked, a session list
 * where nine titles in ten were the same injected preamble.
 *
 * That is what makes these worth pinning. A parser that throws gets noticed; a
 * parser that quietly returns something plausible does not.
 */
const { ftsQuery, ftsLadder } = await import("../lib/signal-store.ts");
const {
  appleTime,
  chromeTime,
  decodeAttributedBody,
  decodeMimeWords,
  htmlToText,
  parseEmlx,
  parseIcs,
  parseIcsTime,
} = await import("../lib/oracle-sources.ts");
const { hashBmp, hammingDistance, parseWhen, splitDescription } = await import("../lib/ghost.ts");
const { titleFromTurns, extractExportedConversation } = await import("../lib/ledger.ts");
const { extractDissents } = await import("../lib/chorus.ts");
const { splitSentences, measureVoice, compareVoice } = await import("../lib/voice-core.ts");
const { parseOracleWhen, inferSources } = await import("../lib/oracle.ts");
const { proposalFor, describeRule, SEP } = await import("../lib/twin.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};
const section = (name) => console.log(`\n${name}`);

// --------------------------------------------------------------- FTS queries

section("FTS5 query building");

/*
 * The characters below are FTS5 SYNTAX. Passing a human sentence through
 * unescaped either throws on the apostrophe or reinterprets "not found" as a
 * boolean negation and returns the opposite of what was asked — and both look
 * identical from the UI: no results.
 */
check("quotes every token", ftsQuery("hello world") === '"hello" AND "world"');
check("any-mode uses OR", ftsQuery("hello world", "any") === '"hello" OR "world"');
check(
  "an embedded quote is doubled, not escaped out",
  ftsQuery('say "hi"') === '"say" AND "hi"',
);
check(
  "a bare NOT becomes a literal, not an operator",
  ftsQuery("not found") === '"not" AND "found"',
);
check("hyphens do not become negation", ftsQuery("re-index") === '"re" AND "index"');
check(
  "the prefix star sits outside the quotes",
  ftsQuery("cloudf", "all", true) === '"cloudf"*',
);
check("punctuation alone yields nothing", ftsQuery("?!!...") === null);
check("empty input yields nothing", ftsQuery("   ") === null);
check("a single digit survives tokenising", ftsQuery("r2") === '"r2"');
check(
  "the ladder degrades from AND to OR",
  JSON.stringify(ftsLadder("a bucket name")) ===
    JSON.stringify(['"bucket" AND "name"', '"bucket" OR "name"']),
);
check("a one-token ladder has no duplicate rung", ftsLadder("bucket").length === 1);

// ------------------------------------------------------------------- epochs

section("Apple and Chromium epochs");

const KNOWN = Date.UTC(2026, 0, 15, 12, 0, 0);
const appleSeconds = KNOWN / 1000 - 978_307_200;

check("seconds since 2001 round-trip", appleTime(appleSeconds) === KNOWN);
check("nanoseconds since 2001 round-trip", appleTime(appleSeconds * 1e9) === KNOWN);
check(
  "chromium microseconds since 1601 round-trip",
  chromeTime((KNOWN / 1000 + 11_644_473_600) * 1e6) === KNOWN,
);
check("zero is not a date", appleTime(0) === null);
check("null is not a date", appleTime(null) === null);
/* A real calendar on a real Mac has rows decoding to February 1604. Those are
   "unset", and letting them through puts four centuries of empty timeline in
   front of everything real. */
check("a 1604 sentinel is rejected", appleTime(-12_500_000_000) === null);
check("a far-future sentinel is rejected", appleTime(appleSeconds + 40 * 31_557_600) === null);
check("a plausible near-future event is kept", appleTime(appleSeconds + 86_400 * 30) !== null);

// --------------------------------------------------------------------- mail

section("Apple Mail .emlx");

const emlx = [
  "213",
  "Subject: =?UTF-8?B?SGVsbG8gdGhlcmU=?=",
  "From: Someone <a@example.com>",
  "To: Another <b@example.com>",
  "Date: Thu, 15 Jan 2026 12:00:00 +0000",
  "Content-Type: text/plain",
  "",
  "The body of the message.",
  "<?xml version=\"1.0\"?><plist></plist>",
].join("\n");

const mail = parseEmlx(emlx);
check("subject is decoded from an encoded-word", mail?.subject === "Hello there");
check("from survives", mail?.from?.includes("a@example.com") === true);
check("the date parses", typeof mail?.date === "number" && mail.date > 0);
check("the body is the body", mail?.body.includes("The body of the message.") === true);
check("the trailing plist is not in the body", mail?.body.includes("<?xml") === false);
check("a file with no header break is refused", parseEmlx("12\nnot a message") === null);

/* A Subject wrapped across two lines is one header. Reading headers
   line-by-line loses half of every long subject. */
const folded = ["60", "Subject: A subject that", "  continues here", "", "body"].join("\n");
check("folded headers are unfolded", parseEmlx(folded)?.subject === "A subject that continues here");

check(
  "quoted-printable is decoded",
  decodeMimeWords("=?utf-8?Q?caf=C3=A9?=").includes("caf"),
);

check(
  "html becomes readable text",
  htmlToText("<p>Hi <b>there</b></p><script>evil()</script>").includes("Hi") &&
    !htmlToText("<p>Hi</p><script>evil()</script>").includes("evil"),
);

// ----------------------------------------------------------------- calendar

section("iCalendar");

const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:abc-123",
  "SUMMARY:A meeting with a very long name that wraps",
  " across two lines",
  "DESCRIPTION:Line one\\nLine two",
  "LOCATION:Somewhere",
  "ATTENDEE;CN=Someone:mailto:a@example.com",
  "DTSTART:20260115T120000Z",
  "DTEND:20260115T130000Z",
  "RRULE:FREQ=WEEKLY",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const [event] = parseIcs(ics);
check("uid is read", event?.uid === "abc-123");
check("a folded SUMMARY is unfolded", event?.summary?.endsWith("across two lines") === true);
check("escaped newlines are real newlines", event?.description?.includes("\n") === true);
check("attendees lose their mailto:", event?.attendees[0] === "a@example.com");
check("recurrence is noticed", event?.recurring === true);
check("a UTC DTSTART parses as UTC", parseIcsTime("20260115T120000Z") === Date.UTC(2026, 0, 15, 12));
/* A floating time means "in the reader's zone", which is what the local
   constructor does. Treating it as UTC slides every entry by the offset. */
check(
  "a floating DTSTART parses as local",
  parseIcsTime("20260115T120000") === new Date(2026, 0, 15, 12, 0, 0).getTime(),
);
check("an all-day DTSTART parses", parseIcsTime("20260115") === new Date(2026, 0, 15).getTime());
check("garbage yields null", parseIcsTime("not-a-date") === null);

// ----------------------------------------------------------------- messages

section("NSAttributedString blobs");

/* Newer Messages rows leave `text` null and put the message in an archive. A
   naive reader finds every recent message empty. */
const blob = Buffer.concat([
  Buffer.from("streamtypedNSMutableAttributedStringNSAttributedStringNSObject", "utf8"),
  Buffer.from([0x00, 0x84, 0x01]),
  Buffer.from("Can we push the deadline to Friday?", "utf8"),
  Buffer.from([0x00, 0x00]),
  Buffer.from("NSDictionary", "utf8"),
]);
check(
  "the message text is recovered from the archive",
  decodeAttributedBody(blob) === "Can we push the deadline to Friday?",
);
check("an empty blob yields nothing", decodeAttributedBody(new Uint8Array()) === "");
check("null yields nothing", decodeAttributedBody(null) === "");

// -------------------------------------------------------------------- ghost

section("Ghost");

/** A 24-bit BMP of one flat colour, top-down, as sips writes them. */
function flatBmp(value, size = 16) {
  const stride = Math.floor((size * 3 + 3) / 4) * 4;
  const header = Buffer.alloc(54);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(54, 10);
  header.writeInt32LE(size, 18);
  header.writeInt32LE(-size, 22);
  header.writeUInt16LE(24, 28);
  const pixels = Buffer.alloc(stride * size, value);
  return Buffer.concat([header, pixels]);
}

check("a flat image hashes to 16 hex characters", hashBmp(flatBmp(120)).length === 16);
check("identical images hash identically", hashBmp(flatBmp(120)) === hashBmp(flatBmp(120)));
check("a non-BMP buffer hashes to nothing", hashBmp(Buffer.from("not a bmp")) === "");
check("a truncated BMP hashes to nothing", hashBmp(flatBmp(120).subarray(0, 40)) === "");
check("distance to itself is zero", hammingDistance("abcd1234", "abcd1234") === 0);
check("a missing hash is maximally distant", hammingDistance("", "abcd1234") === 64);
check("differing lengths are maximally distant", hammingDistance("ab", "abcd") === 64);
check("one differing bit measures one", hammingDistance("0", "1") === 1);

const now = Date.UTC(2026, 0, 15, 15, 0, 0);
const twenty = parseWhen("what was that error 20 minutes ago?", now);
check("“20 minutes ago” produces a window", twenty !== null);
check("the window contains the moment named", twenty.from <= now - 20 * 60_000 && twenty.to >= now - 20 * 60_000);
check("the window does not run into the future", twenty.to <= now);
check("“today” starts at midnight", new Date(parseWhen("what did I do today", now).from).getHours() === 0);
check("“yesterday” ends at today's midnight", parseWhen("yesterday", now).to <= now);
check("“last 2 hours” spans two hours", (() => {
  const w = parseWhen("in the last 2 hours", now);
  return w !== null && Math.round((w.to - w.from) / 3_600_000) === 2;
})());
check("a question naming no time has no window", parseWhen("what is my client rate", now) === null);

const described = splitDescription("WHAT: Editing a file in Cursor.\nTEXT: TypeError at line 12");
check("the summary is split out", described.summary === "Editing a file in Cursor.");
check("the verbatim text is split out", described.body === "TypeError at line 12");
const drifted = splitDescription("Editing a file.\nSome other text.");
check("an unlabelled reply still splits", drifted.summary === "Editing a file.");

// ------------------------------------------------------------------- ledger

section("Ledger");

/*
 * The first user turn is usually a slash command, a skill preamble or a hook
 * announcement. Titling from it produced eight consecutive rows reading "Base
 * directory for this skill: …", which identifies the skill and not one of the
 * eight conversations.
 */
check(
  "command wrappers are stripped",
  titleFromTurns([
    { role: "user", text: "<command-name>/model</command-name> <command-message>model</command-message>" },
    { role: "user", text: "Make the header sticky on scroll." },
  ]) === "Make the header sticky on scroll.",
);
check(
  "a skill preamble is skipped",
  titleFromTurns([
    { role: "user", text: "Base directory for this skill: /Users/x/.claude/skills/thing" },
    { role: "user", text: "Draft the reply to the client." },
  ]) === "Draft the reply to the client.",
);
check(
  "a resumed-session caveat is skipped",
  titleFromTurns([
    { role: "user", text: "Caveat: The messages below were generated by the user while running local commands." },
    { role: "user", text: "Fix the failing test." },
  ]) === "Fix the failing test.",
);
check(
  "an all-machinery session falls back to the assistant",
  titleFromTurns([
    { role: "user", text: "continue" },
    { role: "assistant", text: "I have finished migrating the storage layer to SQLite." },
  ])?.startsWith("I have finished") === true,
);
check("a session with nothing in it has no title", titleFromTurns([]) === null);

const chatgpt = extractExportedConversation({
  title: "A conversation",
  create_time: 1_700_000_000,
  mapping: {
    a: { message: { author: { role: "user" }, create_time: 1_700_000_001, content: { parts: ["Hello"] } } },
    b: { message: { author: { role: "assistant" }, create_time: 1_700_000_002, content: { parts: ["Hi"] } } },
    c: { message: { author: { role: "system" }, content: { parts: ["ignored"] } } },
  },
});
check("a ChatGPT export is understood", chatgpt?.turns.length === 2);
check("system turns are dropped", !chatgpt?.turns.some((turn) => turn.text === "ignored"));
check("ChatGPT turns come out in time order", chatgpt?.turns[0].text === "Hello");

const claude = extractExportedConversation({
  uuid: "u-1",
  name: "Another conversation",
  created_at: "2026-01-15T12:00:00Z",
  chat_messages: [
    { sender: "human", text: "Question?" },
    { sender: "assistant", content: [{ type: "text", text: "Answer." }] },
  ],
});
check("a Claude.ai export is understood", claude?.turns.length === 2);
check("content blocks are flattened", claude?.turns[1].text === "Answer.");
check("something that is neither is refused", extractExportedConversation({ nope: true }) === null);

// ------------------------------------------------------------------- chorus

section("Chorus");

check(
  "a labelled dissent section is extracted",
  extractDissents(
    "THE ANSWER\nUse one database.\n\nWHERE THE PANEL SPLIT\n- One held that sharing couples deploys.\n- Another held the coupling is already there.",
  ).length === 2,
);
check(
  "an explicit agreement is not a dissent",
  extractDissents("THE ANSWER\nYes.\n\nWHERE THE PANEL SPLIT\nNone — the panel agreed.").length === 0,
);
check("no section means no dissents", extractDissents("Just an answer.").length === 0);
check("an empty synthesis means no dissents", extractDissents("").length === 0);
check(
  "a markdown heading is still matched",
  extractDissents("## WHERE THE PANEL SPLIT\n- They disagreed about the index strategy entirely.").length === 1,
);

// -------------------------------------------------------------------- voice

section("Understudy stylometry");

/*
 * The abbreviation guard is the load-bearing part. Treating "e.g." as a
 * sentence end halves the measured sentence length, which is the single number
 * everything else in the profile is scaled against.
 */
check(
  "an abbreviation is not a sentence end",
  splitSentences("Ask Dr. Smith about it. Then send the invoice.").length === 2,
);
check(
  "a decimal is not a sentence end",
  splitSentences("It costs 1.50 per unit. That is fine.").length === 2,
);
check("plain sentences split", splitSentences("One. Two! Three?").length === 3);

const terse = measureVoice([
  "Sent it. Let me know.\n\nIt's done, so we're clear. I'll follow up Friday.",
]);
check("sentence length is measured", terse.sentenceMean > 0);
check("contractions are counted as a rate", terse.contractionRate > 0.5);
check("words are counted", terse.words > 10);
check("no samples means an empty profile", measureVoice([]).samples === 0);

const formal = measureVoice([
  "I am writing to confirm that the deliverables have been completed in accordance with the agreed schedule; the remaining items will follow.",
]);
check("a formal sample records no contractions", formal.contractionRate === 0);
check(
  "a semicolon habit is measured per thousand words",
  formal.semicolonRate > 0,
);

const { match, deviations } = compareVoice(terse, "I am writing to inform you that the matter has been concluded satisfactorily.");
check("a mismatched draft scores below one", match !== null && match < 0.95);
check("a mismatched draft names its deviations", deviations.length > 0);
check("an empty draft cannot be scored", compareVoice(terse, "").match === null);

// ------------------------------------------------------------------- oracle

section("Oracle question parsing");

const then = Date.UTC(2026, 4, 15, 12, 0, 0);
check("“last month” produces a window", parseOracleWhen("invoices from last month", then) !== null);
check("a bare year produces that year", (() => {
  const w = parseOracleWhen("what did I send in 2024", then);
  return w !== null && new Date(w.from).getFullYear() === 2024;
})());
check("no time reference means no window", parseOracleWhen("what is the client rate", then) === null);
check("“last quarter” is three months", (() => {
  const w = parseOracleWhen("invoices last quarter", then);
  return w !== null && w.to > w.from;
})());

check("an email question infers mail", inferSources("what did she say in that email")?.includes("mail") === true);
check("a text question infers messages", inferSources("what did he text me")?.includes("messages") === true);
check("a neutral question infers nothing", inferSources("the client rate for editing") === null);

// --------------------------------------------------------------------- twin

section("Twin proposals");

/*
 * The signature is joined with the unit separator, not a space — these fields
 * are paths, and `~/Documents/Client Work` would split into three. The test
 * imports the constant rather than repeating it, so a change to the separator
 * cannot leave this passing against the old one.
 */
const movePattern = {
  id: `move:${["/a", "/b", ".pdf"].join(SEP)}`,
  kind: "move",
  signature: ["/a", "/b", ".pdf"].join(SEP),
  count: 12,
  firstAt: 1,
  lastAt: 2,
  sample: "/a/x.pdf → /b/x.pdf",
  summary: null,
  state: 0,
};
const spec = proposalFor(movePattern);
check("a move pattern becomes a rule", spec !== null);
check("the trigger is the source folder", spec?.trigger.dir === "/a");
check("the action is a move to the destination", spec?.actions[0].kind === "move" && spec.actions[0].to === "/b");
check(
  "the rule reads as a sentence",
  describeRule(spec.trigger, spec.actions).startsWith("When a .pdf file appears in"),
);
check(
  "a routine is reported, never automated",
  proposalFor({ ...movePattern, kind: "routine", signature: ["Mail", "Slack"].join(SEP) }) === null,
);

// -------------------------------------------------------------- direction

section("Message direction");

/*
 * `who` cannot carry direction and two features needed it.
 *
 * Messages writes the counterparty into `who` for BOTH directions; Mail writes
 * "sender → recipient" and never "You". Any downstream code deriving "did I
 * speak last" from that string is wrong in a way that produces no error — it
 * simply never fires. Prophet's awaiting-reply card was dead for exactly this
 * reason. The adapters record it in `meta.fromMe` instead, and these pin that.
 */
const SENT = "/Users/x/Library/Mail/V10/ACC/Sent Messages.mbox/Data/1/Messages/9.emlx";
const INBOX = "/Users/x/Library/Mail/V10/ACC/INBOX.mbox/Data/1/Messages/9.emlx";
const sentPattern = /(?:^|\/)Sent[^/]*\.mbox(?:\/|$)/i;
check("a Sent mailbox path is recognised as outgoing", sentPattern.test(SENT));
check("an INBOX path is not", !sentPattern.test(INBOX));
check(
  "a mailbox merely containing the word is not enough",
  !sentPattern.test("/Users/x/Library/Mail/V10/ACC/Presentation.mbox/Data/1/Messages/9.emlx"),
);
check("a Sent Items mailbox is recognised", sentPattern.test("/m/Sent Items.mbox/Data/1/x.emlx"));

// ------------------------------------------------------- published claims

section("Claims the marketing makes about the code");

/*
 * Numbers on a landing page rot silently.
 *
 * The hero shot said "four tools" while the MCP server served twelve, and the
 * FAQ said "eight". Nobody owns a figure like that, so it stays wrong for
 * years. These assertions give it an owner.
 */
const fsp = await import("node:fs/promises");
const read = (f) => fsp.readFile(new URL(`../${f}`, import.meta.url), "utf8");

const server = await read("mcp/server.mjs");
const toolNames = [...server.matchAll(/^ {4}name: "([a-z_]+)",/gm)].map((m) => m[1]);
const wikiTools = toolNames.filter((n) => n.startsWith("wiki_"));
const machineTools = toolNames.filter((n) => n.startsWith("machine_"));
check("the MCP server serves the tools the docs describe", toolNames.length === 12, String(toolNames.length));
check("nine of them are wiki tools", wikiTools.length === 9, String(wikiTools.length));
check("three reach this machine", machineTools.length === 3, String(machineTools.length));

/*
 * Read the copy wherever it lives, not from one named file.
 *
 * The first version of these three checks pointed at landing.tsx and
 * hero-simulator.tsx, and both went red the day the FAQ moved to lib/faq.ts and
 * the Connections pane moved to demo-panes.tsx — with every claim still correct
 * and still on the page. A guard that fails when the copy is *moved* rather
 * than when it is *wrong* trains you to delete the guard.
 */
const SURFACES = [
  "components/marketing/landing.tsx",
  "components/marketing/demo-panes.tsx",
  "components/marketing/feature-cards.tsx",
  "components/marketing/hero-simulator.tsx",
  "components/marketing/machine-section.tsx",
  "lib/faq.ts",
];
const published = (await Promise.all(SURFACES.map(read))).join("\n");

check(
  "the landing page no longer claims a build with no upload code",
  !/no upload code in it at all/.test(published),
);
check(
  "and no longer claims nothing runs while you are not looking",
  !/nothing that runs while you are not looking/.test(published),
);
check(
  `the published copy names ${wikiTools.length} wiki tools`,
  published.includes("Nine tools for the wiki"),
);
/* Twice: once where an agent is told how to connect, once in the FAQ. A single
   mention means one of the two surfaces quietly lost it. */
check(
  "it says so in both places that promise it",
  (published.match(/Nine tools for the wiki/g) ?? []).length >= 2,
  String((published.match(/Nine tools for the wiki/g) ?? []).length),
);

const readme = await read("README.md");
check(
  "the README no longer claims Chorus is the only socket",
  !/only module in the project that opens a socket/.test(readme),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
