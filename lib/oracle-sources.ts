import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { columnsOf, foreignFingerprint, hasTable, openForeignCopy } from "@/lib/signal-store";

const gunzip = promisify(zlib.gunzip);

/**
 * Where Oracle gets its material.
 *
 * Seven adapters, one shape. Every one of them reads something macOS or another
 * application already keeps on this disk, and every one of them is written to
 * the same three rules:
 *
 *  PROBE BEFORE PROMISING. A source says whether it exists and, when it does
 *  not, why — "Messages has never been used on this Mac" and "macOS has not
 *  granted Full Disk Access" are different problems and only one of them is
 *  fixable by the person reading it.
 *
 *  STREAM, NEVER SLURP. `collect` is an async generator. A Mail folder with
 *  eighty thousand messages in it must cost one message of memory at a time,
 *  not eighty thousand.
 *
 *  DEGRADE, NEVER THROW. Apple renames its tables between releases and a
 *  half-migrated database is normal. Every schema assumption is checked, and a
 *  source that cannot understand what it finds yields nothing rather than
 *  taking the indexer down with it.
 *
 * None of these writes anything. Every foreign database is copied and opened
 * read-only (see openForeignCopy) so that Lore can never be the reason
 * somebody's Messages history is corrupt.
 */

export type OracleSource =
  | "files"
  | "mail"
  | "calendar"
  | "messages"
  | "notes"
  | "browser"
  | "photos";

export const ORACLE_SOURCES: OracleSource[] = [
  "files",
  "mail",
  "calendar",
  "messages",
  "notes",
  "browser",
  "photos",
];

export const ORACLE_LABEL: Record<OracleSource, string> = {
  files: "Files",
  mail: "Mail",
  calendar: "Calendar",
  messages: "Messages",
  notes: "Notes",
  browser: "Browser history",
  photos: "Photos",
};

export const ORACLE_WHERE: Record<OracleSource, string> = {
  files: "The folders you choose",
  mail: "~/Library/Mail",
  calendar: "~/Library/Calendars",
  messages: "~/Library/Messages/chat.db",
  notes: "Apple Notes' local database",
  browser: "Chrome, Brave, Edge, Arc and Safari history",
  photos: "The Photos library's own database",
};

/** Sources macOS puts behind Full Disk Access. */
export const NEEDS_FULL_DISK: OracleSource[] = ["mail", "messages", "notes", "photos", "browser"];

export type OracleItem = {
  /** Stable within a source, so re-indexing updates rather than duplicates. */
  nativeId: string;
  title: string | null;
  body: string;
  /** Sender, participants, author, attendees — whoever the item is "with". */
  who: string | null;
  at: number | null;
  /** Something openable: a file path, a URL, a message: link. */
  uri: string | null;
  meta?: Record<string, unknown>;
};

export type ProbeResult = { available: boolean; reason: string };

export type CollectContext = {
  /** Only items newer than this, where the source can tell. */
  since: number;
  /**
   * Only items OLDER than this — the backward walk through history.
   *
   * Zero means "not backfilling, use `since`". A source with no timeline to
   * walk (files, which walks a directory) ignores it and yields nothing, which
   * is how the indexer learns there is no history left to fetch.
   */
  before: number;
  /** Stop after this many items, so one pass is bounded. */
  limit: number;
  /** For `files`, the folders the user chose. */
  roots: string[];
  /** Ignore files bigger than this. */
  maxFileBytes: number;
};

export type Adapter = {
  id: OracleSource;
  probe(): Promise<ProbeResult>;
  collect(ctx: CollectContext): AsyncGenerator<OracleItem>;
  /**
   * A cheap value that changes when the source does.
   *
   * Optional, and only implemented by the sources backed by a foreign database
   * — those are the ones where finding out costs a several-hundred-megabyte
   * copy. A source that walks a directory has nothing cheaper than walking it.
   */
  fingerprint?(): Promise<string | null>;
};

const HOME = os.homedir();

/** Seconds between the Unix epoch and Apple's 2001 reference date. */
const APPLE_EPOCH_OFFSET = 978_307_200;
/** Seconds between 1601 (Windows/Chrome) and 1970. */
const CHROME_EPOCH_OFFSET = 11_644_473_600;

/**
 * Apple's Core Data timestamps, in whichever unit this row happens to use.
 *
 * Messages switched from seconds to nanoseconds in macOS 10.13 and did not
 * migrate the old rows, so a single database contains both. Reading a
 * nanosecond value as seconds dates a 2019 text message to the year 500 million
 * — which sorts to the end of every list and is the sort of bug that gets
 * called "Messages doesn't work" rather than "the epoch is wrong".
 */
export function appleTime(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  const seconds = Math.abs(value) > 1e11 ? value / 1e9 : value;
  const ms = Math.round((seconds + APPLE_EPOCH_OFFSET) * 1000);
  /*
   * Apple writes sentinels into date columns, and they are not small: a real
   * calendar on this Mac has rows whose start_date decodes to February 1604.
   * Those are "unset", not events from the reign of James I, and letting them
   * through puts four hundred years of empty timeline in front of anything
   * real. Anything before 1990 or more than a decade out is a sentinel.
   */
  if (ms < 631_152_000_000 || ms > Date.now() + 315_360_000_000) return null;
  return ms;
}

/** Chromium's microseconds-since-1601. */
export function chromeTime(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value / 1000 - CHROME_EPOCH_OFFSET * 1000);
}

/**
 * The WHERE fragment and bound value for one direction of a timeline walk.
 *
 * Every SQL-backed source needs the same three lines: forward from `since`,
 * or backward from `before`, in that source's own epoch. Writing it five times
 * is how one of them ends up with the comparison the wrong way round, which
 * looks exactly like "that source has no old data".
 *
 * @param toNative converts a millisecond timestamp into the column's own units.
 */
function walkWindow(
  ctx: CollectContext,
  column: string,
  toNative: (ms: number) => number,
): { clause: string; bound: number; descending: boolean } {
  if (ctx.before) {
    return { clause: `${column} < ?`, bound: toNative(ctx.before), descending: true };
  }
  return { clause: `${column} > ?`, bound: ctx.since ? toNative(ctx.since) : 0, descending: true };
}

/** Collapse whitespace and cap length, so one item cannot dominate the index. */
export function tidy(text: string, max = 20_000): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

/**
 * Strip tags, scripts and entities out of an HTML body.
 *
 * The input is a marketing email, which is the most hostile well-formed text
 * this program handles: megabytes of nested tables, unclosed tags, and inline
 * style blocks. `<(script|style|head)[\s\S]*?<\/\1>` is the obvious pattern and
 * it backtracks quadratically on an UNCLOSED `<script`, because the lazy
 * `[\s\S]*?` extends one character at a time to the end of the document and
 * fails at each. One four-megabyte email of that shape blocks the event loop
 * for minutes — and this runs inside the server that also serves the wiki.
 *
 * Two changes. The body is capped first, because no email needs a megabyte of
 * markup to say what it says. And the pattern is bounded: `[^<]*` cannot cross
 * a `<`, so the scan is linear and an unclosed tag simply does not match.
 */
export function htmlToText(html: string): string {
  return html
    .slice(0, 400_000)
    .replace(/<(script|style|head)\b[^<]*(?:<(?!\/\1\s*>)[^<]*)*<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/[ \t]{2,}/g, " ");
}

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

async function readable(target: string): Promise<boolean> {
  try {
    const handle = await fs.open(target, "r");
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------- files

/** Extensions worth reading as text. Anything else is indexed by name only. */
const TEXTUAL = /\.(md|mdx|markdown|txt|rtf|csv|tsv|json|ya?ml|toml|ini|conf|log|tex|org|adoc|html?|xml|svg|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|fish|sql|graphql|vue|svelte|astro|css|scss|less)$/i;
const PDF = /\.pdf$/i;

/** Never walked. Build output and dependency trees are noise, in volume. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  "dist",
  "build",
  "target",
  "vendor",
  "Pods",
  ".Trash",
  "Library",
  ".gradle",
  ".terraform",
  "DerivedData",
]);

async function pdfText(file: string, maxPages = 40): Promise<string> {
  /*
   * pdfjs is already a dependency (the wiki renders PDF attachments), so
   * reading a PDF costs nothing new. It is imported here rather than at module
   * scope because it is several megabytes and most passes never touch a PDF.
   */
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  /* Same import dance as lib/ingest.ts: without pulling the worker into this
     module graph, pdfjs resolves a path on disk that does not survive Next's
     bundling and every PDF fails with a "fake worker" error. */
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs").catch(() => {});
  const data = new Uint8Array(await fs.readFile(file));
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  return pages.join("\n\n");
}

export const filesAdapter: Adapter = {
  id: "files",
  async probe() {
    return { available: true, reason: "" };
  },
  async *collect(ctx) {
    /* A directory is not a timeline. There is no "older than" to walk, so a
       backfill pass yields nothing and the indexer marks the backward
       direction exhausted — which is correct: one forward walk sees every
       file there is. */
    if (ctx.before) return;
    let yielded = 0;
    const walk = async function* (dir: string, depth: number): AsyncGenerator<OracleItem> {
      if (depth < 0 || yielded >= ctx.limit) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (yielded >= ctx.limit) return;
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          yield* walk(full, depth - 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const isText = TEXTUAL.test(entry.name);
        const isPdf = PDF.test(entry.name);
        if (!isText && !isPdf) continue;

        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        /*
         * Rounded on BOTH sides of the comparison.
         *
         * `at` is stored as `Math.round(mtimeMs)` and the cursor is the largest
         * `at` written, so comparing a raw float mtime against it re-reads
         * every file whose fraction rounded down — about half of them, on every
         * pass, forever. Harmless in the index (the unique key updates rather
         * than duplicates) and expensive in a mail archive.
         */
        if (Math.round(stat.mtimeMs) <= ctx.since) continue;
        if (stat.size > ctx.maxFileBytes) continue;

        let body = "";
        try {
          body = isPdf ? await pdfText(full) : await fs.readFile(full, "utf8");
        } catch {
          continue;
        }
        if (!body.trim()) continue;

        yielded++;
        yield {
          nativeId: full,
          title: entry.name,
          body: tidy(body, 60_000),
          who: null,
          at: Math.round(stat.mtimeMs),
          uri: full,
          meta: { bytes: stat.size, dir: path.dirname(full) },
        };
      }
    };

    for (const root of ctx.roots) {
      if (yielded >= ctx.limit) break;
      if (!(await exists(root))) continue;
      yield* walk(root, 8);
    }
  },
};

// ----------------------------------------------------------------------- mail

/**
 * One `.emlx` file.
 *
 * Apple's format is a byte count, a newline, an RFC 822 message, and an Apple
 * property list of metadata. Only the middle part is wanted, and the leading
 * count is what says where it ends — parsing to the first `<?xml` instead would
 * truncate any message that quotes one.
 */
export function parseEmlx(raw: string): {
  subject: string | null;
  from: string | null;
  to: string | null;
  date: number | null;
  body: string;
} | null {
  const firstBreak = raw.indexOf("\n");
  if (firstBreak === -1) return null;

  /*
   * The leading count is BYTES; `raw` is a JavaScript string.
   *
   * Slicing by that number treats it as UTF-16 code units, so any message with
   * a non-ASCII character in it — an accent, a curly quote, an emoji — gets cut
   * short or over-read by exactly the number of extra bytes. The over-read case
   * is the nasty one: it silently appends Apple's trailing property list to the
   * body, and every such email lands in the index with a chunk of XML on the
   * end of it.
   *
   * So the count is used as the hint it can be, and the plist is then removed
   * by its own marker. Belt and braces, because the count is also simply wrong
   * on some files Mail has rewritten.
   */
  const declared = Number(raw.slice(0, firstBreak).trim());
  let message =
    Number.isFinite(declared) && declared > 0
      ? raw.slice(firstBreak + 1, firstBreak + 1 + declared)
      : raw.slice(firstBreak + 1);

  const plist = message.search(/\n<\?xml[^\n]*\n?\s*<!DOCTYPE plist|\n<\?xml[^>]*\?>\s*<plist/);
  if (plist !== -1) message = message.slice(0, plist);

  const split = message.search(/\r?\n\r?\n/);
  if (split === -1) return null;
  const headerBlock = message.slice(0, split);
  let body = message.slice(split).replace(/^\r?\n\r?\n/, "");

  /* Unfold continuation lines before reading any header: a Subject wrapped
     across two lines is one header, and reading it line-by-line loses half of
     every long subject. */
  const headers = new Map<string, string>();
  for (const line of headerBlock.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }

  body = decodeBody(body, headers.get("content-transfer-encoding") ?? "");

  const type = (headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("multipart")) {
    /* Take the text/plain part when there is one and fall back to the HTML.
       Boundary parsing in full is a mail client's job; this needs the words. */
    const plain = body.match(
      /Content-Type:\s*text\/plain([\s\S]*?)\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\s*$)/i,
    );
    if (plain) {
      /*
       * A part carries its own Content-Transfer-Encoding, and it is usually not
       * the one on the outer message — a multipart wrapper is `7bit` while the
       * text part inside is base64. Decoding only the outer header left every
       * such message indexed as a wall of base64, which matches nothing and
       * reads as "Mail has no results".
       */
      body = decodeBody(plain[2], plain[1]);
    } else {
      body = htmlToText(body);
    }
  } else if (type.includes("html")) {
    body = htmlToText(body);
  }

  const parsedDate = headers.get("date") ? Date.parse(headers.get("date")!) : NaN;
  return {
    subject: decodeMimeWords(headers.get("subject") ?? "") || null,
    from: decodeMimeWords(headers.get("from") ?? "") || null,
    to: decodeMimeWords(headers.get("to") ?? "") || null,
    date: Number.isFinite(parsedDate) ? parsedDate : null,
    body: tidy(body, 24_000),
  };
}

/**
 * Undo a Content-Transfer-Encoding.
 *
 * `headerBlob` is anything that might contain the encoding declaration — a
 * header value, or the raw header block of a MIME part. Taking the blob rather
 * than a parsed value is what lets the multipart path reuse this for a part
 * whose encoding differs from its parent's, which is the common case and was
 * the bug.
 */
export function decodeBody(body: string, headerBlob: string): string {
  const encoding = headerBlob.toLowerCase();
  if (/base64/.test(encoding)) {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      /* Leave it as it was; unreadable is better than absent. */
      return body;
    }
  }
  if (/quoted-printable/.test(encoding)) {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
}

/** `=?UTF-8?B?…?=` encoded-words, which is how non-ASCII subjects arrive. */
export function decodeMimeWords(input: string): string {
  return input.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_whole, _charset: string, kind: string, text: string) => {
      try {
        if (kind.toLowerCase() === "b") return Buffer.from(text, "base64").toString("utf8");
        return text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (__, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      } catch {
        return text;
      }
    },
  );
}

export const mailAdapter: Adapter = {
  id: "mail",
  async probe() {
    const base = path.join(HOME, "Library", "Mail");
    if (!(await exists(base))) return { available: false, reason: "Apple Mail is not set up on this Mac." };
    const versions = await fs.readdir(base).catch(() => null);
    if (!versions) {
      return {
        available: false,
        reason: "macOS blocked the Mail folder. Full Disk Access is what unlocks it.",
      };
    }
    return { available: true, reason: "" };
  },
  async *collect(ctx) {
    const base = path.join(HOME, "Library", "Mail");
    let yielded = 0;

    const walk = async function* (dir: string, depth: number): AsyncGenerator<OracleItem> {
      if (depth < 0 || yielded >= ctx.limit) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (yielded >= ctx.limit) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          yield* walk(full, depth - 1);
          continue;
        }
        if (!entry.name.endsWith(".emlx")) continue;
        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        /* Rounded on both sides — see the files adapter. */
        if (ctx.before) {
          if (Math.round(stat.mtimeMs) >= ctx.before) continue;
        } else if (Math.round(stat.mtimeMs) <= ctx.since) {
          continue;
        }
        /* A 40MB .emlx is an attachment with a sentence attached. */
        if (stat.size > 4_000_000) continue;

        const raw = await fs.readFile(full, "utf8").catch(() => "");
        if (!raw) continue;
        const parsed = parseEmlx(raw);
        if (!parsed || (!parsed.body && !parsed.subject)) continue;

        yielded++;
        yield {
          nativeId: full,
          title: parsed.subject,
          body: parsed.body,
          who: [parsed.from, parsed.to].filter(Boolean).join(" → ") || null,
          at: parsed.date ?? Math.round(stat.mtimeMs),
          uri: full,
          meta: {
            mailbox: path.basename(path.dirname(path.dirname(full))),
            /*
             * Which way the message went, recorded because `who` cannot carry
             * it: mail stores "sender → recipient" and Messages stores the
             * counterparty in the same field for both directions, so anything
             * downstream that needs to know who spoke last has nothing to read.
             * Prophet's "waiting on a reply" card could never fire without it.
             *
             * The mailbox path is the signal — a message inside a Sent mailbox
             * is one this person sent — which is more reliable than matching
             * the From: header against a set of addresses Lore does not know.
             */
            fromMe: /(?:^|\/)Sent[^/]*\.mbox(?:\/|$)/i.test(full),
          },
        };
      }
    };

    yield* walk(base, 12);
  },
};

// ------------------------------------------------------------------- calendar

/**
 * An iCalendar file, reduced to its events.
 *
 * Only the fields a person would search on. Recurrence is deliberately not
 * expanded: "every Tuesday" becomes one item that says so, rather than four
 * hundred identical rows that bury everything else in the index.
 */
export function parseIcs(raw: string): {
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  attendees: string[];
  start: number | null;
  end: number | null;
  recurring: boolean;
}[] {
  /* Unfold first: iCalendar wraps at 75 octets and continues with a leading
     space, so a description read line-by-line is shredded into fragments. */
  const text = raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const events: ReturnType<typeof parseIcs> = [];
  const blocks = text.split(/BEGIN:VEVENT/).slice(1);

  for (const block of blocks) {
    const body = block.split(/END:VEVENT/)[0];
    const field = (name: string): string | null => {
      const match = body.match(new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, "im"));
      return match ? unescapeIcs(match[1].trim()) : null;
    };
    const time = (name: string): number | null => {
      const match = body.match(new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, "im"));
      if (!match) return null;
      return parseIcsTime(match[1].trim());
    };
    const attendees = [...body.matchAll(/^ATTENDEE(?:;[^:\n]*)?:(.*)$/gim)]
      .map((m) => m[1].replace(/^mailto:/i, "").trim())
      .filter(Boolean);

    const uid = field("UID");
    if (!uid) continue;
    events.push({
      uid,
      summary: field("SUMMARY"),
      description: field("DESCRIPTION"),
      location: field("LOCATION"),
      attendees,
      start: time("DTSTART"),
      end: time("DTEND"),
      recurring: /^RRULE/im.test(body),
    });
  }
  return events;
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** `20260805T140000Z`, `20260805T140000`, or an all-day `20260805`. */
export function parseIcsTime(value: string): number | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) {
    const fallback = Date.parse(value);
    return Number.isFinite(fallback) ? fallback : null;
  }
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = match;
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  /* A floating (no-Z) time means "in whatever zone the reader is in", which is
     exactly what the local constructor does. Treating it as UTC would slide
     every calendar entry by the machine's offset. */
  return z ? Date.UTC(...parts) : new Date(...parts).getTime();
}

/**
 * Where macOS actually keeps the calendar.
 *
 * There are two stores and which one a Mac has depends on its vintage and its
 * accounts. Modern macOS keeps everything in one `Calendar.sqlitedb` under a
 * group container; older versions, and some CalDAV accounts, drop `.ics` files
 * into `.calendar` bundles under ~/Library/Calendars.
 *
 * A first pass at this checked only the bundles, and reported "Calendar has no
 * locally cached events" on a machine with six thousand of them sitting in the
 * database next door. Both are read, database first.
 */
const CALENDAR_DB = path.join(
  HOME,
  "Library",
  "Group Containers",
  "group.com.apple.calendar",
  "Calendar.sqlitedb",
);

export const calendarAdapter: Adapter = {
  id: "calendar",
  fingerprint: () => foreignFingerprint(CALENDAR_DB),
  async probe() {
    if (await exists(CALENDAR_DB)) {
      if (!(await readable(CALENDAR_DB))) {
        return {
          available: false,
          reason: "macOS blocked the Calendar database. Full Disk Access unlocks it.",
        };
      }
      return { available: true, reason: "" };
    }
    const base = path.join(HOME, "Library", "Calendars");
    if (!(await exists(base))) return { available: false, reason: "No local calendars on this Mac." };
    const entries = await fs.readdir(base).catch(() => null);
    if (!entries) {
      return { available: false, reason: "macOS blocked the Calendars folder. Full Disk Access unlocks it." };
    }
    if (!entries.some((name) => name.endsWith(".calendar"))) {
      return {
        available: false,
        reason: "Calendar has no locally cached events — its accounts may be server-only.",
      };
    }
    return { available: true, reason: "" };
  },
  async *collect(ctx) {
    let fromDatabase = 0;
    for await (const item of collectCalendarDb(ctx)) {
      fromDatabase++;
      yield item;
    }
    /* The bundles are a fallback, not a supplement: reading both on a Mac that
       has both would index every event twice under two different ids. */
    if (fromDatabase > 0) return;

    const base = path.join(HOME, "Library", "Calendars");
    const calendars = (await fs.readdir(base, { withFileTypes: true }).catch(() => [])).filter(
      (entry) => entry.isDirectory() && entry.name.endsWith(".calendar"),
    );
    let yielded = 0;

    for (const calendar of calendars) {
      if (yielded >= ctx.limit) return;
      const eventsDir = path.join(base, calendar.name, "Events");
      const files = await fs.readdir(eventsDir).catch(() => []);
      const calendarName = await calendarTitle(path.join(base, calendar.name));

      for (const name of files) {
        if (yielded >= ctx.limit) return;
        if (!name.endsWith(".ics")) continue;
        const full = path.join(eventsDir, name);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        if (ctx.before) {
          if (Math.round(stat.mtimeMs) >= ctx.before) continue;
        } else if (Math.round(stat.mtimeMs) <= ctx.since) {
          continue;
        }
        const raw = await fs.readFile(full, "utf8").catch(() => "");
        if (!raw) continue;

        for (const event of parseIcs(raw)) {
          if (yielded >= ctx.limit) return;
          const parts = [event.description, event.location && `Location: ${event.location}`]
            .filter(Boolean)
            .join("\n\n");
          yielded++;
          yield {
            nativeId: `${calendar.name}/${event.uid}`,
            title: event.summary,
            body: tidy(parts, 8_000),
            who: event.attendees.join(", ") || null,
            at: event.start ?? Math.round(stat.mtimeMs),
            uri: full,
            meta: {
              calendar: calendarName,
              end: event.end,
              location: event.location,
              recurring: event.recurring,
            },
          };
        }
      }
    }
  },
};

/** Events out of macOS's own calendar database. */
async function* collectCalendarDb(ctx: CollectContext): AsyncGenerator<OracleItem> {
  if (!(await exists(CALENDAR_DB))) return;
  const opened = await openForeignCopy(CALENDAR_DB);
  if (!opened) return;
  try {
    const { db } = opened;
    if (!hasTable(db, "CalendarItem")) return;
    const columns = columnsOf(db, "CalendarItem");
    if (!columns.has("start_date") || !columns.has("summary")) return;
    const hasParticipants = hasTable(db, "Participant");
    const hasLocation = hasTable(db, "Location");
    const hasCalendar = hasTable(db, "Calendar");
    const calendarWindow = walkWindow(ctx, "ci.start_date", (ms) => ms / 1000 - APPLE_EPOCH_OFFSET);

    const rows = db.all<{
      id: number;
      uid: string | null;
      summary: string | null;
      description: string | null;
      start: number | null;
      end: number | null;
      allDay: number | null;
      recurring: number | null;
      calendar: string | null;
      location: string | null;
      attendees: string | null;
    }>(
      `SELECT ci.ROWID AS id,
              ${columns.has("unique_identifier") ? "ci.unique_identifier" : "NULL"} AS uid,
              ci.summary AS summary,
              ${columns.has("description") ? "ci.description" : "NULL"} AS description,
              ci.start_date AS start,
              ${columns.has("end_date") ? "ci.end_date" : "NULL"} AS end,
              ${columns.has("all_day") ? "ci.all_day" : "0"} AS allDay,
              ${columns.has("has_recurrences") ? "ci.has_recurrences" : "0"} AS recurring,
              ${hasCalendar ? "c.title" : "NULL"} AS calendar,
              ${hasLocation ? "l.title" : "NULL"} AS location,
              ${hasParticipants ? "(SELECT group_concat(p.email, ', ') FROM Participant p WHERE p.owner_id = ci.ROWID AND p.email IS NOT NULL)" : "NULL"} AS attendees
         FROM CalendarItem ci
         ${hasCalendar ? "LEFT JOIN Calendar c ON c.ROWID = ci.calendar_id" : ""}
         ${hasLocation ? "LEFT JOIN Location l ON l.ROWID = ci.location_id" : ""}
        WHERE ${calendarWindow.clause}
        ORDER BY ci.start_date DESC
        LIMIT ?`,
      calendarWindow.bound,
      ctx.limit,
    );

    for (const row of rows) {
      if (!row.summary && !row.description) continue;
      const body = [
        row.description,
        row.location ? `Location: ${row.location}` : null,
        row.attendees ? `With: ${row.attendees}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      yield {
        nativeId: row.uid ?? `db:${row.id}`,
        title: row.summary,
        body: tidy(body, 8_000),
        who: row.attendees,
        at: appleTime(row.start),
        uri: null,
        meta: {
          calendar: row.calendar,
          end: appleTime(row.end),
          location: row.location,
          allDay: Boolean(row.allDay),
          recurring: Boolean(row.recurring),
        },
      };
    }
  } finally {
    await opened.dispose();
  }
}

/** The human name of a `.calendar` bundle, from its Info.plist. */
async function calendarTitle(dir: string): Promise<string> {
  const raw = await fs.readFile(path.join(dir, "Info.plist"), "utf8").catch(() => "");
  const match = raw.match(/<key>Title<\/key>\s*<string>([^<]*)<\/string>/);
  return match?.[1] ?? path.basename(dir, ".calendar");
}

// ------------------------------------------------------------------- messages

/**
 * iMessage and SMS.
 *
 * Two schema hazards, both handled by probing rather than assuming. Newer rows
 * put the text in `attributedBody` — an NSKeyedArchiver blob — and leave `text`
 * null, so a naive reader finds every recent message empty. And the timestamp
 * unit changed in 10.13 without migrating old rows, which `appleTime` covers.
 */
export const messagesAdapter: Adapter = {
  id: "messages",
  fingerprint: () => foreignFingerprint(path.join(HOME, "Library", "Messages", "chat.db")),
  async probe() {
    const file = path.join(HOME, "Library", "Messages", "chat.db");
    if (!(await exists(file))) return { available: false, reason: "Messages has never been used on this Mac." };
    if (!(await readable(file))) {
      return {
        available: false,
        reason: "macOS blocked chat.db. Grant Full Disk Access to the app running Lore.",
      };
    }
    return { available: true, reason: "" };
  },
  async *collect(ctx) {
    const opened = await openForeignCopy(path.join(HOME, "Library", "Messages", "chat.db"));
    if (!opened) return;
    try {
      const { db } = opened;
      if (!hasTable(db, "message")) return;
      const columns = columnsOf(db, "message");
      const hasAttributed = columns.has("attributedBody");
      /*
       * `date` is nanoseconds since 2001 on a modern Mac and whole seconds on
       * rows written before 10.13, in the SAME column. So the comparison
       * normalises the column to nanoseconds and the bound is expressed in
       * nanoseconds — a bound in the wrong unit silently selects everything or
       * nothing, and both look like a working query.
       */
      const NORMALISED = "(CASE WHEN ABS(m.date) > 100000000000 THEN m.date ELSE m.date * 1000000000.0 END)";
      const window = walkWindow(ctx, NORMALISED, (ms) => (ms / 1000 - APPLE_EPOCH_OFFSET) * 1e9);

      /*
       * The epoch conversion happens in SQL, not in JavaScript.
       *
       * `message.date` on a modern Mac is nanoseconds since 2001 — around
       * 8.1 × 10^17, which is two orders of magnitude past the largest integer
       * a JavaScript number can hold exactly. node:sqlite does not silently
       * round it; it refuses the row outright with "Value is too large to be
       * represented as a JavaScript number", which took the entire Messages
       * source down with one throw. Dividing inside SQLite hands back a
       * millisecond timestamp that fits comfortably, and the CASE covers the
       * pre-10.13 rows still stored in whole seconds in the same column.
       */
      const rows = db.all<{
        rowid: number;
        text: string | null;
        attributedBody: Uint8Array | null;
        atMs: number | null;
        is_from_me: number;
        handle: string | null;
        chatName: string | null;
        service: string | null;
      }>(
        `SELECT m.ROWID AS rowid,
                m.text AS text,
                ${hasAttributed ? "m.attributedBody" : "NULL"} AS attributedBody,
                CAST(((CASE WHEN ABS(m.date) > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END)
                      + ${APPLE_EPOCH_OFFSET}) * 1000 AS INTEGER) AS atMs,
                m.is_from_me AS is_from_me,
                h.id AS handle,
                COALESCE(c.display_name, c.chat_identifier) AS chatName,
                m.service AS service
           FROM message m
           LEFT JOIN handle h ON h.ROWID = m.handle_id
           LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
           LEFT JOIN chat c ON c.ROWID = cmj.chat_id
          WHERE ${window.clause}
          ORDER BY m.date DESC
          LIMIT ?`,
        window.bound,
        ctx.limit,
      );

      for (const row of rows) {
        const text = (row.text ?? "").trim() || decodeAttributedBody(row.attributedBody);
        if (!text) continue;
        const who = row.is_from_me ? "You" : (row.handle ?? "Unknown");
        yield {
          nativeId: String(row.rowid),
          title: row.chatName ? `Message · ${row.chatName}` : "Message",
          body: tidy(text, 8_000),
          who,
          at: row.atMs && row.atMs > 0 ? row.atMs : null,
          uri: null,
          meta: {
            chat: row.chatName,
            handle: row.handle,
            fromMe: Boolean(row.is_from_me),
            service: row.service,
          },
        };
      }
    } finally {
      await opened.dispose();
    }
  },
};

/**
 * Pull the readable string out of an NSKeyedArchiver blob.
 *
 * Decoding the archive properly means implementing a binary property list
 * reader and walking an object graph, for a single string that is sitting in
 * the bytes in plain UTF-8. What is wanted here is the message text, so the
 * blob is scanned for its longest run of printable characters — which is that
 * text, because the rest of the archive is class names and short keys.
 *
 * Deliberately crude, and correct for the job: a message that decodes to
 * nothing is skipped rather than indexed as gibberish.
 */
export function decodeAttributedBody(blob: Uint8Array | null | undefined): string {
  if (!blob || blob.length === 0) return "";
  const text = Buffer.from(blob).toString("utf8");
  const runs = text.match(/[\x20-\x7E -￿\n\t]{4,}/g);
  if (!runs) return "";
  /* The archive's own vocabulary. Without this the "longest run" is reliably
     `NSDictionary` plus whatever followed it in memory. */
  const noise =
    /^(NS|__k|streamtyped|bplist|NSObject|NSString|NSAttributedString|NSMutableString|NSNumber|NSValue|iI|\+|\$)/;
  const candidates = runs
    .map((run) => run.trim())
    .filter((run) => run.length > 3 && !noise.test(run))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? "";
}

// ---------------------------------------------------------------------- notes

export const notesAdapter: Adapter = {
  id: "notes",
  fingerprint: () => foreignFingerprint(notesStorePath()),
  async probe() {
    const file = notesStorePath();
    if (!(await exists(file))) return { available: false, reason: "Apple Notes has no local store on this Mac." };
    if (!(await readable(file))) {
      return {
        available: false,
        reason: "macOS blocked the Notes database. Full Disk Access unlocks it.",
      };
    }
    return { available: true, reason: "" };
  },
  async *collect(ctx) {
    const opened = await openForeignCopy(notesStorePath());
    if (!opened) return;
    try {
      const { db } = opened;
      if (!hasTable(db, "ZICCLOUDSYNCINGOBJECT") || !hasTable(db, "ZICNOTEDATA")) return;
      const columns = columnsOf(db, "ZICCLOUDSYNCINGOBJECT");
      if (!columns.has("ZTITLE1") || !columns.has("ZNOTEDATA")) return;
      const hasFolder = columns.has("ZFOLDER");
      const notesWindow = walkWindow(ctx, "COALESCE(o.ZMODIFICATIONDATE1, 0)", (ms) => ms / 1000 - APPLE_EPOCH_OFFSET);

      const rows = db.all<{
        id: number;
        title: string | null;
        created: number | null;
        modified: number | null;
        data: Uint8Array | null;
        folder: string | null;
      }>(
        `SELECT o.Z_PK AS id,
                o.ZTITLE1 AS title,
                o.ZCREATIONDATE1 AS created,
                o.ZMODIFICATIONDATE1 AS modified,
                d.ZDATA AS data,
                ${hasFolder ? "f.ZTITLE2" : "NULL"} AS folder
           FROM ZICCLOUDSYNCINGOBJECT o
           JOIN ZICNOTEDATA d ON d.Z_PK = o.ZNOTEDATA
           ${hasFolder ? "LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON f.Z_PK = o.ZFOLDER" : ""}
          WHERE o.ZTITLE1 IS NOT NULL
            AND COALESCE(o.ZMODIFICATIONDATE1, 0) ${notesWindow.clause}
          ORDER BY o.ZMODIFICATIONDATE1 DESC
          LIMIT ?`,
        notesWindow.bound,
        ctx.limit,
      );

      for (const row of rows) {
        const body = await decodeNoteData(row.data);
        if (!row.title && !body) continue;
        yield {
          nativeId: String(row.id),
          title: row.title,
          body: tidy(body, 30_000),
          who: null,
          at: appleTime(row.modified) ?? appleTime(row.created),
          uri: null,
          meta: { folder: row.folder },
        };
      }
    } finally {
      await opened.dispose();
    }
  },
};

function notesStorePath(): string {
  return path.join(
    HOME,
    "Library",
    "Group Containers",
    "group.com.apple.notes",
    "NoteStore.sqlite",
  );
}

/**
 * A note body, out of a gzipped protobuf.
 *
 * Notes stores each note as a protocol buffer, gzipped, in a blob. Writing a
 * protobuf parser for a schema Apple does not publish and changes without
 * notice would be a maintenance liability for one field; the note's text is a
 * UTF-8 length-delimited string inside it, so after decompression it is simply
 * there. Extracting the printable runs is stable across every schema change
 * that keeps the text as text.
 */
export async function decodeNoteData(blob: Uint8Array | null | undefined): Promise<string> {
  if (!blob || blob.length === 0) return "";
  let raw: Buffer;
  try {
    raw = await gunzip(Buffer.from(blob));
  } catch {
    /* Not every row is gzipped — an unencrypted small note can be stored flat. */
    raw = Buffer.from(blob);
  }
  const text = raw.toString("utf8");
  const runs = text.match(/[\x20-\x7E -￿\n\t]{3,}/g);
  if (!runs) return "";
  return runs
    .map((run) => run.trim())
    .filter((run) => run.length > 2 && !/^[\x00-\x1F]*$/.test(run))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// -------------------------------------------------------------------- browser

type BrowserProfile = { name: string; file: string; kind: "chromium" | "safari" };

async function browserProfiles(): Promise<BrowserProfile[]> {
  const support = path.join(HOME, "Library", "Application Support");
  const chromium: [string, string][] = [
    ["Chrome", path.join(support, "Google", "Chrome")],
    ["Brave", path.join(support, "BraveSoftware", "Brave-Browser")],
    ["Edge", path.join(support, "Microsoft Edge")],
    ["Vivaldi", path.join(support, "Vivaldi")],
    ["Chromium", path.join(support, "Chromium")],
    ["Arc", path.join(support, "Arc", "User Data")],
    ["Dia", path.join(support, "Dia", "User Data")],
  ];

  const found: BrowserProfile[] = [];
  for (const [name, base] of chromium) {
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      /* Chromium calls them "Default", "Profile 1", "Profile 2"… — anything
         else in User Data is cache, crash dumps or component updaters. */
      if (entry.name !== "Default" && !/^Profile \d+$/.test(entry.name)) continue;
      const file = path.join(base, entry.name, "History");
      if (await exists(file)) {
        found.push({
          name: entry.name === "Default" ? name : `${name} · ${entry.name}`,
          file,
          kind: "chromium",
        });
      }
    }
  }

  const safari = path.join(HOME, "Library", "Safari", "History.db");
  if (await exists(safari)) found.push({ name: "Safari", file: safari, kind: "safari" });
  return found;
}

export const browserAdapter: Adapter = {
  id: "browser",
  /* Every profile's History file at once — any of them changing means there is
     something new to read, and none changing means copying all of them would
     find nothing. */
  async fingerprint() {
    const profiles = await browserProfiles();
    const parts = await Promise.all(profiles.map((profile) => foreignFingerprint(profile.file)));
    return parts.filter(Boolean).join("~") || null;
  },
  async probe() {
    const profiles = await browserProfiles();
    if (!profiles.length) return { available: false, reason: "No browser history found on this Mac." };
    const anyReadable = await Promise.all(profiles.map((p) => readable(p.file)));
    if (!anyReadable.some(Boolean)) {
      return {
        available: false,
        reason:
          "Browser history exists but macOS blocked it. Safari always needs Full Disk Access; Chromium browsers need Lore to be closed out of their profile lock.",
      };
    }
    return { available: true, reason: "" };
  },
  async *collect(ctx) {
    const profiles = await browserProfiles();
    const perProfile = Math.max(50, Math.floor(ctx.limit / Math.max(1, profiles.length)));

    for (const profile of profiles) {
      const opened = await openForeignCopy(profile.file);
      if (!opened) continue;
      try {
        const { db } = opened;
        if (profile.kind === "chromium") {
          if (!hasTable(db, "urls")) continue;
          const chromeWindow = walkWindow(ctx, "last_visit_time", (ms) => (ms / 1000 + CHROME_EPOCH_OFFSET) * 1e6);
          /* Converted in SQL for the same reason as Messages: Chromium counts
             microseconds from 1601, which is ~1.34 × 10^16 — past the exact
             integer range, and node:sqlite throws rather than rounding. */
          const rows = db.all<{ id: number; url: string; title: string | null; atMs: number; count: number }>(
            `SELECT id, url, title,
                    CAST(last_visit_time / 1000.0 - ${CHROME_EPOCH_OFFSET * 1000} AS INTEGER) AS atMs,
                    visit_count AS count
               FROM urls WHERE ${chromeWindow.clause} ORDER BY last_visit_time DESC LIMIT ?`,
            chromeWindow.bound,
            perProfile,
          );
          for (const row of rows) {
            if (!row.url || row.url.startsWith("chrome://")) continue;
            yield {
              nativeId: `${profile.name}:${row.id}`,
              title: row.title || row.url,
              /* The URL is the body as well as the link: people search for a
                 domain far more often than a page title they never read. */
              body: row.url,
              who: profile.name,
              at: row.atMs && row.atMs > 0 ? row.atMs : null,
              uri: row.url,
              meta: { browser: profile.name, visits: row.count },
            };
          }
        } else {
          if (!hasTable(db, "history_items") || !hasTable(db, "history_visits")) continue;
          const safariWindow = walkWindow(ctx, "v.visit_time", (ms) => ms / 1000 - APPLE_EPOCH_OFFSET);
          const rows = db.all<{ id: number; url: string; title: string | null; visit: number }>(
            `SELECT i.id AS id, i.url AS url, v.title AS title, MAX(v.visit_time) AS visit
               FROM history_items i JOIN history_visits v ON v.history_item = i.id
              WHERE ${safariWindow.clause}
              GROUP BY i.id ORDER BY visit DESC LIMIT ?`,
            safariWindow.bound,
            perProfile,
          );
          for (const row of rows) {
            if (!row.url) continue;
            yield {
              nativeId: `Safari:${row.id}`,
              title: row.title || row.url,
              body: row.url,
              who: "Safari",
              at: appleTime(row.visit),
              uri: row.url,
              meta: { browser: "Safari" },
            };
          }
        }
      } finally {
        await opened.dispose();
      }
    }
  },
};

// --------------------------------------------------------------------- photos

export const photosAdapter: Adapter = {
  id: "photos",
  async fingerprint() {
    const file = await photosStorePath();
    return file ? foreignFingerprint(file) : null;
  },
  async probe() {
    const file = await photosStorePath();
    if (!file) return { available: false, reason: "No Photos library found in ~/Pictures." };
    if (!(await readable(file))) {
      return {
        available: false,
        reason: "The Photos library is present but macOS blocked its database. Full Disk Access unlocks it.",
      };
    }
    return { available: true, reason: "" };
  },
  async *collect(ctx) {
    const file = await photosStorePath();
    if (!file) return;
    const opened = await openForeignCopy(file);
    if (!opened) return;
    try {
      const { db } = opened;
      if (!hasTable(db, "ZASSET")) return;
      const asset = columnsOf(db, "ZASSET");
      /*
       * Photos' column names carry a version suffix that changes with every
       * macOS release — ZDIRECTORY on one, ZDIRECTORY1 on the next. Picking the
       * one that exists is the difference between working on this Mac and
       * working on Macs.
       */
      const pick = (...names: string[]) => names.find((name) => asset.has(name)) ?? null;
      const dateColumn = pick("ZDATECREATED", "ZDATECREATED1");
      const nameColumn = pick("ZFILENAME", "ZORIGINALFILENAME");
      const dirColumn = pick("ZDIRECTORY", "ZDIRECTORY1");
      const latColumn = pick("ZLATITUDE");
      const lonColumn = pick("ZLONGITUDE");
      if (!dateColumn || !nameColumn) return;
      const photosWindow = walkWindow(ctx, `a.${dateColumn}`, (ms) => ms / 1000 - APPLE_EPOCH_OFFSET);

      const hasExtra = hasTable(db, "ZADDITIONALASSETATTRIBUTES");
      const extra = hasExtra ? columnsOf(db, "ZADDITIONALASSETATTRIBUTES") : new Set<string>();
      const titleColumn = hasExtra ? (extra.has("ZTITLE") ? "x.ZTITLE" : null) : null;
      const captionColumn = hasExtra
        ? extra.has("ZACCESSIBILITYDESCRIPTION")
          ? "x.ZACCESSIBILITYDESCRIPTION"
          : null
        : null;

      const rows = db.all<{
        id: number;
        name: string | null;
        dir: string | null;
        at: number | null;
        title: string | null;
        caption: string | null;
        lat: number | null;
        lon: number | null;
      }>(
        `SELECT a.Z_PK AS id,
                a.${nameColumn} AS name,
                ${dirColumn ? `a.${dirColumn}` : "NULL"} AS dir,
                a.${dateColumn} AS at,
                ${titleColumn ?? "NULL"} AS title,
                ${captionColumn ?? "NULL"} AS caption,
                ${latColumn ? `a.${latColumn}` : "NULL"} AS lat,
                ${lonColumn ? `a.${lonColumn}` : "NULL"} AS lon
           FROM ZASSET a
           ${hasExtra ? "LEFT JOIN ZADDITIONALASSETATTRIBUTES x ON x.ZASSET = a.Z_PK" : ""}
          WHERE ${photosWindow.clause}
          ORDER BY a.${dateColumn} DESC
          LIMIT ?`,
        photosWindow.bound,
        ctx.limit,
      );

      for (const row of rows) {
        const words = [row.title, row.caption, row.name, row.dir].filter(Boolean).join(" · ");
        if (!words) continue;
        yield {
          nativeId: String(row.id),
          title: row.title || row.name,
          body: words,
          who: null,
          at: appleTime(row.at),
          uri: null,
          meta: {
            filename: row.name,
            /* Only kept when Photos recorded a real fix. Its "unknown" is
               -180/-180, which would otherwise land every photo off Antarctica. */
            lat: row.lat && row.lat > -90 ? row.lat : null,
            lon: row.lon && row.lon > -180 ? row.lon : null,
          },
        };
      }
    } finally {
      await opened.dispose();
    }
  },
};

async function photosStorePath(): Promise<string | null> {
  const pictures = path.join(HOME, "Pictures");
  const entries = await fs.readdir(pictures, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.name.endsWith(".photoslibrary")) continue;
    const candidate = path.join(pictures, entry.name, "database", "Photos.sqlite");
    if (await exists(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------- index

export const ADAPTERS: Record<OracleSource, Adapter> = {
  files: filesAdapter,
  mail: mailAdapter,
  calendar: calendarAdapter,
  messages: messagesAdapter,
  notes: notesAdapter,
  browser: browserAdapter,
  photos: photosAdapter,
};
