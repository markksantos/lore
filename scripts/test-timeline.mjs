#!/usr/bin/env node --experimental-strip-types --no-warnings
/**
 * The timeline reader and the enricher, against a planted recorder store.
 *
 * HOME is redirected before import, then a database with DesktopRecord's
 * exact schema is planted in the fake Application Support — so every query
 * runs against the real table shapes, and none of it goes anywhere near the
 * real screen history. The frame-containment test is the one that matters:
 * a path outside the store must never be served, whatever the DB says.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./scripts/alias-loader.mjs scripts/test-timeline.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

const SCRATCH = path.join(os.tmpdir(), `lore-timeline-test-${Date.now().toString(36)}`);
process.env.HOME = SCRATCH;
const STORE = path.join(SCRATCH, "Library", "Application Support", "DesktopRecord");
mkdirSync(path.join(STORE, "captures"), { recursive: true });

// ---- plant the store with the app's real schema ----------------------------
const db = new DatabaseSync(path.join(STORE, "desktoprecord.sqlite"));
db.exec(`
CREATE TABLE captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, timestamp REAL NOT NULL,
  image_path TEXT NOT NULL, thumbnail_path TEXT, active_app_name TEXT NOT NULL,
  active_app_bundle_id TEXT NOT NULL, active_window_title TEXT NOT NULL,
  ocr_text TEXT, day TEXT NOT NULL, phash INTEGER, browser_url TEXT, block_uuid TEXT);
CREATE VIRTUAL TABLE captures_fts USING fts5(ocr_text, active_window_title, active_app_name);
CREATE TABLE blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
  start_ts REAL NOT NULL, end_ts REAL NOT NULL, day TEXT NOT NULL,
  bundle_ids TEXT NOT NULL, urls TEXT NOT NULL, titles TEXT NOT NULL,
  representative_capture_uuid TEXT, merged_text TEXT NOT NULL DEFAULT '',
  capture_count INTEGER NOT NULL DEFAULT 0, synthesized INTEGER NOT NULL DEFAULT 0);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, block_uuid TEXT NOT NULL UNIQUE,
  day TEXT NOT NULL, summary TEXT NOT NULL, entities TEXT NOT NULL, facts TEXT NOT NULL,
  open_threads TEXT NOT NULL, created_ts REAL NOT NULL, filed INTEGER NOT NULL DEFAULT 0);
`);

const DAY = "2026-08-01";
const base = Date.parse(`${DAY}T15:00:00`) / 1000;

// A real frame inside the store, and a hostile row pointing outside it.
writeFileSync(path.join(STORE, "captures", "frame-a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
// The hostile targets EXIST, so the only thing that can refuse them is the
// containment check — not a stat() miss. This is what makes the test non-vacuous.
mkdirSync(path.join(SCRATCH, "secrets"), { recursive: true });
writeFileSync(path.join(SCRATCH, "secrets", "passwd.txt"), "root:x:0:0:secret\n");
// And a symlink planted inside the store pointing outside it.
try { symlinkSync(path.join(SCRATCH, "secrets"), path.join(STORE, "captures", "leak")); } catch {}

const insert = db.prepare(
  `INSERT INTO captures (uuid, timestamp, image_path, active_app_name, active_app_bundle_id,
   active_window_title, ocr_text, day, browser_url) VALUES (?,?,?,?,?,?,?,?,?)`,
);
insert.run("cap-aaaa-1111", base, "captures/frame-a.jpg", "Chrome", "com.google.Chrome",
  "Rust ownership explained - YouTube", "ownership borrow checker lifetimes", DAY,
  "https://www.youtube.com/watch?v=abc123XYZ_-&si=track");
insert.run("cap-bbbb-2222", base + 120, "captures/frame-a.jpg", "Chrome", "com.google.Chrome",
  "Rust ownership explained - YouTube", "ownership borrow checker lifetimes", DAY,
  "https://www.youtube.com/watch?v=abc123XYZ_-");
insert.run("cap-cccc-3333", base + 300, "captures/frame-a.jpg", "cmux", "com.cmux.app",
  "lore — panel fixes", "admission control gate", DAY, null);
insert.run("cap-evil-6666", base + 400, "../../secrets/passwd.txt", "Evil", "com.evil",
  "hostile row via ..", "", DAY, null);
insert.run("cap-link-7777", base + 410, "captures/leak/passwd.txt", "Evil", "com.evil",
  "hostile row via symlink", "", DAY, null);
db.prepare(
  `INSERT INTO captures_fts (rowid, ocr_text, active_window_title, active_app_name)
   SELECT id, ocr_text, active_window_title, active_app_name FROM captures`,
).run();

db.prepare(
  `INSERT INTO blocks (uuid, start_ts, end_ts, day, bundle_ids, urls, titles,
   representative_capture_uuid, capture_count, synthesized) VALUES (?,?,?,?,?,?,?,?,?,1)`,
).run("blk-1", base, base + 240, DAY, JSON.stringify(["com.google.Chrome"]),
  JSON.stringify(["https://www.youtube.com/watch?v=abc123XYZ_-"]),
  JSON.stringify(["Rust ownership explained - YouTube"]), "cap-aaaa-1111", 2);
db.prepare(
  `INSERT INTO notes (uuid, block_uuid, day, summary, entities, facts, open_threads, created_ts)
   VALUES (?,?,?,?,?,?,?,?)`,
).run("note-1", "blk-1", DAY, "Watched a video on Rust ownership.",
  JSON.stringify(["Rust"]), JSON.stringify(["The borrow checker enforces single mutable access."]),
  JSON.stringify([]), base + 300);
db.close();

// ---- now import the module under test (HOME already redirected) ------------
const { timelineStatus, around, searchScreen, frameFor, renderDayPage, blocksForDay } =
  await import("../lib/timeline.ts");
const { dwelledUrls, normaliseUrl, youtubeId, vttToText, extractArticle, isPrivateHostLiteral, isPublicHost } =
  await import("../lib/enrich.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

const status = await timelineStatus();
check("status sees the planted store", status.installed && status.captures === 5, JSON.stringify(status));

const windowed = await around(Date.parse(`${DAY}T15:02:00`), 30);
check("around() returns the block with its note", windowed.blocks.length === 1 && windowed.blocks[0].note?.summary.includes("Rust"), JSON.stringify(windowed.blocks));
check("around() returns the frames", windowed.captures.length === 5, `got ${windowed.captures.length}`);

const found = await searchScreen("borrow checker");
check("screen FTS finds OCR text", found.length >= 1 && found[0].title.includes("Rust"), JSON.stringify(found.slice(0, 1)));

const good = await frameFor("cap-aaaa-1111");
check("frame served from inside the store", good !== null && good.includes("DesktopRecord"));
const evil = await frameFor("cap-evil-6666");
check("frame outside the store via .. is REFUSED (target exists)", evil === null, String(evil));
const linked = await frameFor("cap-link-7777");
check("frame outside the store via SYMLINK is REFUSED", linked === null, String(linked));
check("frame by garbage uuid refused", (await frameFor("../../etc/passwd")) === null);

const page = renderDayPage(DAY, await blocksForDay(DAY));
check("day page renders the note's summary", page.includes("Rust ownership"), page.slice(0, 200));
check("day page cites the site", page.includes("youtube.com"), "");

// ---- enrichment pure functions ---------------------------------------------
const dwell = dwelledUrls(windowed.captures, 60);
check("dwell: two frames 120s apart count, tracking param stripped",
  dwell.length === 1 && !dwell[0].url.includes("si="), JSON.stringify(dwell));

check("private URLs are never fetchable", normaliseUrl("http://192.168.1.10/admin") === null && normaliseUrl("http://localhost:4646/x") === null);
// D3/m2: every alternate loopback/LAN encoding the review named.
check("SSRF literals all blocked (::1, 0.0.0.0, decimal, hex, CGNAT, metadata, .lan)",
  ["[::1]","0.0.0.0","127.1","2130706433","0x7f000001","169.254.169.254","100.64.0.1","nas.lan","fd00::1","fe80::1","printer.home.arpa"]
    .every((h) => isPrivateHostLiteral(h.replace(/^\[|\]$/g, ""))));
check("public hosts are allowed", isPrivateHostLiteral("example.com") === false && isPrivateHostLiteral("8.8.8.8") === false);
// D4: a public name resolving to loopback must be blocked by the DNS check.
check("SSRF: DNS-to-loopback is blocked (D4)", (await isPublicHost("localtest.me")) === false);
check("SSRF: a real public host resolves through", (await isPublicHost("example.com")) === true);
check("youtube id from watch and short urls",
  youtubeId("https://www.youtube.com/watch?v=abc123XYZ_-") === "abc123XYZ_-" &&
  youtubeId("https://youtu.be/qqq111WWW22") === "qqq111WWW22");

const text = vttToText("WEBVTT\n\n00:00.000 --> 00:02.000\nhello <c>world</c>\n\n00:02.000 --> 00:04.000\nhello world\n\n00:04.000 --> 00:06.000\nnext line");
check("vtt: tags stripped, scroll-repeats collapsed", text === "hello world next line", text);

const article = extractArticle(`<html><head><title>The Test — Site</title></head><body>
<nav>Home About</nav><article>${"<p>" + "This is a long paragraph of genuine article prose that goes on for quite a while to comfortably pass the length floor and read like a real page. ".repeat(3) + "</p>"}
<p>${"Second paragraph with enough substance to be kept by the extractor rather than dropped as boilerplate chrome, with several real sentences. ".repeat(3)}</p>
<p>${"A third paragraph so the multi-paragraph requirement is clearly met by genuine editorial content rather than a consent banner. ".repeat(2)}</p></article>
<footer>© corp</footer></body></html>`);
check("article: prose extracted, nav and footer dropped",
  article !== null && article.text.includes("genuine article prose") && !article.text.includes("Home About"),
  article ? article.text.slice(0, 120) : "null");
const shell = extractArticle("<html><body><div id='root'></div><script>app()</script></body></html>");
check("article: a JS shell is a refusal, not a page", shell === null);

// NEW-2 (introduced then fixed): a genuine short article that merely MENTIONS
// legal phrases must not be dropped as boilerplate. 2 mentions across ~720
// chars of real prose — the exact false negative the fix-verification found.
const shortLegal = extractArticle("<article><p>" +
  "A federal judge ruled today that the data broker violated consumer protection statutes when it sold location histories without disclosure, a decision legal scholars say reshapes how the industry treats its Privacy Policy obligations and what counts as informed consent under the law. The company argued its Terms of Service permitted the transfers, but the court found the language buried and unenforceable, ordering a full audit within ninety days." +
  "</p><p>" +
  "Industry groups warned the precedent could ripple across adjacent sectors, while privacy advocates called it overdue and urged regulators to press similar cases against larger platforms holding comparable troves of behavioral data over time." +
  "</p></article>");
check("article: a real short legal-news article is KEPT, not over-blocked", shortLegal !== null && /federal judge/.test(shortLegal.text));
// And a boilerplate-DENSE banner of similar length is still refused.
const denseBanner = extractArticle("<article><p>" +
  "We and our partners use cookies. Accept all cookies or manage your preferences. See our Privacy Policy and Terms of Service. Your consent is required under GDPR. Manage cookies. Cookie preferences. Please enable JavaScript. ".repeat(3) +
  "</p></article>");
check("article: a dense consent banner is still refused", denseBanner === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
