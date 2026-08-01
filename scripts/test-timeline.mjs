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
writeFileSync(path.join(SCRATCH, "outside.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

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
insert.run("cap-evil-6666", base + 400, "../../../../outside.jpg", "Evil", "com.evil",
  "hostile row", "", DAY, null);
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
const { dwelledUrls, normaliseUrl, youtubeId, vttToText, extractArticle } =
  await import("../lib/enrich.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

const status = await timelineStatus();
check("status sees the planted store", status.installed && status.captures === 4, JSON.stringify(status));

const windowed = await around(Date.parse(`${DAY}T15:02:00`), 30);
check("around() returns the block with its note", windowed.blocks.length === 1 && windowed.blocks[0].note?.summary.includes("Rust"), JSON.stringify(windowed.blocks));
check("around() returns the frames", windowed.captures.length === 4, `got ${windowed.captures.length}`);

const found = await searchScreen("borrow checker");
check("screen FTS finds OCR text", found.length >= 1 && found[0].title.includes("Rust"), JSON.stringify(found.slice(0, 1)));

const good = await frameFor("cap-aaaa-1111");
check("frame served from inside the store", good !== null && good.includes("DesktopRecord"));
const evil = await frameFor("cap-evil-6666");
check("frame outside the store is REFUSED", evil === null, String(evil));
check("frame by garbage uuid refused", (await frameFor("../../etc/passwd")) === null);

const page = renderDayPage(DAY, await blocksForDay(DAY));
check("day page renders the note's summary", page.includes("Rust ownership"), page.slice(0, 200));
check("day page cites the site", page.includes("youtube.com"), "");

// ---- enrichment pure functions ---------------------------------------------
const dwell = dwelledUrls(windowed.captures, 60);
check("dwell: two frames 120s apart count, tracking param stripped",
  dwell.length === 1 && !dwell[0].url.includes("si="), JSON.stringify(dwell));

check("private URLs are never fetchable", normaliseUrl("http://192.168.1.10/admin") === null && normaliseUrl("http://localhost:4646/x") === null);
check("youtube id from watch and short urls",
  youtubeId("https://www.youtube.com/watch?v=abc123XYZ_-") === "abc123XYZ_-" &&
  youtubeId("https://youtu.be/qqq111WWW22") === "qqq111WWW22");

const text = vttToText("WEBVTT\n\n00:00.000 --> 00:02.000\nhello <c>world</c>\n\n00:02.000 --> 00:04.000\nhello world\n\n00:04.000 --> 00:06.000\nnext line");
check("vtt: tags stripped, scroll-repeats collapsed", text === "hello world next line", text);

const article = extractArticle(`<html><head><title>The Test — Site</title></head><body>
<nav>Home About</nav><article>${"<p>" + "This is a long paragraph of genuine article prose that goes on for quite a while to pass the length floor. ".repeat(2) + "</p>"}
<p>${"Second paragraph with enough substance to be kept by the extractor rather than dropped as boilerplate chrome. ".repeat(2)}</p></article>
<footer>© corp</footer></body></html>`);
check("article: prose extracted, nav and footer dropped",
  article !== null && article.text.includes("genuine article prose") && !article.text.includes("Home About"),
  article ? article.text.slice(0, 120) : "null");
const shell = extractArticle("<html><body><div id='root'></div><script>app()</script></body></html>");
check("article: a JS shell is a refusal, not a page", shell === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
