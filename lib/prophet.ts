import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, dropDb, ftsLadder, type Db } from "@/lib/signal-store";
import { oracleDb, searchOracle } from "@/lib/oracle";
import { ADAPTERS, ORACLE_LABEL, type OracleSource } from "@/lib/oracle-sources";
import { twinDb } from "@/lib/twin";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import { getActiveVault } from "@/lib/config";
import { getIndex } from "@/lib/wiki";

/**
 * Prophet — the one that speaks first.
 *
 * Everything else in Lore waits to be asked. Prophet does not: it reads what
 * the other observers found, notices the things that are about to matter, and
 * says them before the moment passes. Your call is in twenty minutes and here
 * is what you said last time. You have not heard from this person in three
 * times as long as usual. The contractor has been quiet for six days and you
 * normally chase at four.
 *
 * The failure mode is not "it misses something". It is "it becomes noise" —
 * because an agent that speaks when it has nothing to say gets muted within a
 * week, and a muted agent is worth exactly nothing. Everything below is built
 * around that:
 *
 *   EVERY CARD HAS A WEIGHT, and the bar is deliberately high. Cards below it
 *   are computed, stored, and never shown.
 *
 *   DISMISSING TEACHES IT. Dismiss two cards of a kind and that kind's weight
 *   drops for good. Dismiss enough and it stops producing them entirely. This
 *   is the mute button, except it is per-kind and automatic.
 *
 *   NOTHING REPEATS. Every card has a dedupe key, so the same meeting does not
 *   produce a new card every ten minutes.
 *
 *   IT ONLY KNOWS WHAT IT WAS SHOWN. Prophet has no sources of its own. Every
 *   card is derived from an observer the user already switched on, so turning
 *   Oracle off silently removes half of what Prophet can say — which is right,
 *   and is stated in the UI rather than left to be discovered.
 */

export type CardKind =
  | "meeting-soon"
  | "meeting-prep"
  | "silent-contact"
  | "awaiting-reply"
  | "monthly-habit"
  | "twin-pattern"
  | "wiki-gap";

export const CARD_LABEL: Record<CardKind, string> = {
  "meeting-soon": "Coming up",
  "meeting-prep": "Before this meeting",
  "silent-contact": "Gone quiet",
  "awaiting-reply": "Waiting on a reply",
  "monthly-habit": "You usually do this now",
  "twin-pattern": "Twin noticed something",
  "wiki-gap": "Your wiki could not answer this",
};

export type ProphetConfig = {
  /** Cards below this weight are never shown. 0-1. */
  bar: number;
  /** Most cards shown at once. */
  maxCards: number;
  /** How far ahead a meeting counts as "coming up", in minutes. */
  meetingHorizonMinutes: number;
  kinds: Record<CardKind, boolean>;
  /** Post a desktop notification for cards at or above this weight. */
  notifyAbove: number;
};

export const DEFAULT_PROPHET: ProphetConfig = {
  bar: 0.45,
  maxCards: 6,
  meetingHorizonMinutes: 45,
  kinds: {
    "meeting-soon": true,
    "meeting-prep": true,
    "silent-contact": true,
    "awaiting-reply": true,
    "monthly-habit": true,
    "twin-pattern": true,
    "wiki-gap": true,
  },
  notifyAbove: 0.8,
};

const DIR = path.join(os.homedir(), ".lore", "prophet");
const CONFIG_FILE = path.join(DIR, "config.json");

export async function readProphetConfig(): Promise<ProphetConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_PROPHET;
  try {
    const parsed = JSON.parse(raw) as Partial<ProphetConfig>;
    return {
      bar: Math.min(0.95, Math.max(0, Number(parsed.bar) ?? DEFAULT_PROPHET.bar)),
      maxCards: Math.min(30, Math.max(1, Number(parsed.maxCards) || DEFAULT_PROPHET.maxCards)),
      meetingHorizonMinutes: Math.min(
        720,
        Math.max(5, Number(parsed.meetingHorizonMinutes) || DEFAULT_PROPHET.meetingHorizonMinutes),
      ),
      kinds: { ...DEFAULT_PROPHET.kinds, ...(parsed.kinds ?? {}) },
      notifyAbove: Math.min(1, Math.max(0, Number(parsed.notifyAbove) ?? DEFAULT_PROPHET.notifyAbove)),
    };
  } catch {
    return DEFAULT_PROPHET;
  }
}

export async function writeProphetConfig(config: ProphetConfig): Promise<ProphetConfig> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

// --------------------------------------------------------------------- store

const MIGRATIONS = [
  `
  CREATE TABLE cards (
    id       TEXT PRIMARY KEY,
    kind     TEXT NOT NULL,
    at       INTEGER NOT NULL,
    /* When this stops being worth saying — a meeting that has started, a reply
       that arrived. Expired cards are deleted rather than shown greyed out. */
    until    INTEGER,
    weight   REAL NOT NULL DEFAULT 0,
    title    TEXT NOT NULL,
    body     TEXT,
    evidence TEXT,
    /* 0 new, 1 seen, 2 snoozed, 3 dismissed, 4 acted on. */
    state    INTEGER NOT NULL DEFAULT 0,
    snoozeUntil INTEGER,
    notified INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX cards_state ON cards(state, weight DESC);
  CREATE INDEX cards_kind ON cards(kind);

  /* How the user has reacted to each kind, which is how Prophet learns to shut
     up about the things this person does not care about. */
  CREATE TABLE feedback (
    kind      TEXT PRIMARY KEY,
    shown     INTEGER NOT NULL DEFAULT 0,
    dismissed INTEGER NOT NULL DEFAULT 0,
    acted     INTEGER NOT NULL DEFAULT 0
  );
  `,
];

export function prophetDb(): Db {
  return openDb("prophet", MIGRATIONS);
}

export type Card = {
  id: string;
  kind: CardKind;
  at: number;
  until: number | null;
  weight: number;
  title: string;
  body: string | null;
  evidence: { label: string; detail: string; uri?: string | null }[];
  state: number;
  snoozeUntil: number | null;
  notified: number;
};

function hydrate(row: Record<string, unknown>): Card {
  let evidence: Card["evidence"] = [];
  if (typeof row.evidence === "string") {
    try {
      evidence = JSON.parse(row.evidence) as Card["evidence"];
    } catch {
      evidence = [];
    }
  }
  return {
    id: String(row.id),
    kind: row.kind as CardKind,
    at: Number(row.at),
    until: (row.until as number | null) ?? null,
    weight: Number(row.weight) || 0,
    title: String(row.title),
    body: (row.body as string | null) ?? null,
    evidence,
    state: Number(row.state),
    snoozeUntil: (row.snoozeUntil as number | null) ?? null,
    notified: Number(row.notified),
  };
}

/**
 * How much a kind has earned the right to speak.
 *
 * Starts at 1 and falls as the user dismisses. Two dismissals halve it; six
 * take it near zero, which puts every card of that kind under the bar
 * permanently. Acting on a card pulls it back up, so a kind that is usually
 * useful survives one bad card.
 */
export function kindMultiplier(db: Db, kind: CardKind): number {
  const row = db.get<{ shown: number; dismissed: number; acted: number }>(
    "SELECT shown, dismissed, acted FROM feedback WHERE kind = ?",
    kind,
  );
  if (!row) return 1;
  const penalty = row.dismissed - row.acted * 2;
  if (penalty <= 0) return 1;
  return Math.max(0.05, 1 / (1 + penalty * 0.5));
}

// -------------------------------------------------------------------- inputs

/** Events starting soon, straight from the calendar rather than via Oracle. */
async function upcomingEvents(horizonMs: number): Promise<
  { id: string; title: string; at: number; who: string | null; body: string; location: string | null }[]
> {
  const probe = await ADAPTERS.calendar.probe();
  if (!probe.available) return [];
  const now = Date.now();
  const out: { id: string; title: string; at: number; who: string | null; body: string; location: string | null }[] = [];
  /*
   * `since` means "newer than", not "from", and the adapter yields newest-first.
   *
   * A first version passed `now - 1h` here reasoning about it as the start of a
   * window, which is the same expression and a different meaning: it excluded
   * everything older than an hour ago, which for a calendar is every event that
   * has not yet been rescheduled — and the imminent meeting whose start_date is
   * in ten minutes is newer than that bound only by luck. Zero asks for
   * everything the adapter has, newest first, and the filter below picks the
   * window. 400 rows is generous for a calendar that stores recurrences
   * expanded years ahead.
   */
  for await (const item of ADAPTERS.calendar.collect({
    since: 0,
    before: 0,
    limit: 400,
    roots: [],
    maxFileBytes: 0,
  })) {
    if (!item.at || item.at < now - 600_000 || item.at > now + horizonMs) continue;
    out.push({
      id: item.nativeId,
      title: item.title ?? "Untitled event",
      at: item.at,
      who: item.who,
      body: item.body,
      location: (item.meta?.location as string | null) ?? null,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Everything Oracle has about a person, most recent first. */
function historyWith(who: string, limit = 6): { at: number | null; source: OracleSource; title: string | null; snippet: string }[] {
  try {
    const db = oracleDb();
    for (const match of ftsLadder(who)) {
      const rows = db.all<{ at: number | null; source: OracleSource; title: string | null; snippet: string }>(
        `SELECT i.at, i.source, i.title, snippet(items_fts, 1, '', '', '…', 24) AS snippet
           FROM items_fts JOIN items i ON i.id = items_fts.rowid
          WHERE items_fts MATCH ?
          ORDER BY i.at DESC LIMIT ?`,
        match,
        limit,
      );
      if (rows.length) return rows;
    }
  } catch {
    /* Oracle is not set up. Prophet says less; it does not fail. */
  }
  return [];
}

// -------------------------------------------------------------------- miners

type Draft = {
  id: string;
  kind: CardKind;
  weight: number;
  title: string;
  body: string | null;
  until: number | null;
  evidence: Card["evidence"];
};

async function meetingCards(config: ProphetConfig): Promise<Draft[]> {
  const events = await upcomingEvents(config.meetingHorizonMinutes * 60_000);
  const drafts: Draft[] = [];

  for (const event of events.slice(0, 4)) {
    const minutes = Math.round((event.at - Date.now()) / 60_000);
    const when = minutes <= 0 ? "now" : `in ${minutes} minute${minutes === 1 ? "" : "s"}`;

    /*
     * Urgency is the weight. A meeting an hour out is worth mentioning; one
     * five minutes out is worth interrupting for, and the difference has to be
     * in the number or the bar cannot tell them apart.
     */
    const urgency = Math.max(0.4, 1 - Math.max(0, minutes) / config.meetingHorizonMinutes);
    drafts.push({
      id: `meeting-soon:${event.id}`,
      kind: "meeting-soon",
      weight: urgency,
      title: `${event.title} ${when}`,
      body: [event.location, event.who].filter(Boolean).join(" · ") || null,
      until: event.at + 30 * 60_000,
      evidence: [],
    });

    /* Context is a separate card from the reminder, because the reminder is
       useful in two seconds and the context takes a minute to read. */
    const attendees = (event.who ?? "")
      .split(/[,;]\s*/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 3)
      .slice(0, 3);
    const prior = attendees.flatMap((who) => historyWith(who, 3));
    if (prior.length) {
      drafts.push({
        id: `meeting-prep:${event.id}`,
        kind: "meeting-prep",
        weight: Math.min(0.95, urgency * 0.9 + 0.1),
        title: `What you have with ${attendees[0]}`,
        body: null,
        until: event.at + 30 * 60_000,
        evidence: prior.slice(0, 6).map((row) => ({
          label: `${ORACLE_LABEL[row.source]}${row.at ? ` · ${new Date(row.at).toLocaleDateString()}` : ""}`,
          detail: (row.title ?? row.snippet).slice(0, 200),
        })),
      });
    }
  }
  return drafts;
}

/**
 * People you talk to on a rhythm, who have broken it.
 *
 * The measurement is the median gap between contacts, not the mean: one
 * three-month silence in an otherwise weekly correspondence would drag a mean
 * far enough that nothing ever looks late. A gap of three medians is the
 * threshold, and it takes at least five contacts before there is a rhythm at
 * all — below that the "usual" is a guess.
 */
function silentContactCards(): Draft[] {
  const drafts: Draft[] = [];
  let rows: { who: string; at: number }[];
  try {
    rows = oracleDb().all<{ who: string; at: number }>(
      `SELECT who, at FROM items
        WHERE who IS NOT NULL AND who <> '' AND at IS NOT NULL
          AND source IN ('mail','messages') AND at > ?
        ORDER BY at ASC`,
      Date.now() - 365 * 86_400_000,
    );
  } catch {
    return [];
  }

  const byPerson = new Map<string, number[]>();
  for (const row of rows) {
    const who = row.who.replace(/^You\s*→\s*/, "").split(/[,;]/)[0].trim().toLowerCase();
    if (!who || who === "you" || who === "unknown") continue;
    const list = byPerson.get(who) ?? [];
    list.push(row.at);
    byPerson.set(who, list);
  }

  for (const [who, times] of byPerson) {
    if (times.length < 5) continue;
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    /* Sub-daily rhythms are conversation, not correspondence — flagging a
       four-hour silence with someone you text constantly is noise. */
    if (median < 86_400_000) continue;
    const silence = Date.now() - times[times.length - 1];
    if (silence < median * 3) continue;

    const days = Math.round(silence / 86_400_000);
    const usual = Math.round(median / 86_400_000);
    drafts.push({
      id: `silent-contact:${who}`,
      kind: "silent-contact",
      /* Grows with how unusual the silence is, capped so one dormant contact
         cannot outrank a meeting starting in five minutes. */
      weight: Math.min(0.85, 0.4 + (silence / (median * 3) - 1) * 0.15),
      title: `${days} days since ${who}`,
      body: `You normally exchange something about every ${usual} day${usual === 1 ? "" : "s"}.`,
      until: null,
      evidence: historyWith(who, 3).map((row) => ({
        label: `${ORACLE_LABEL[row.source]}${row.at ? ` · ${new Date(row.at).toLocaleDateString()}` : ""}`,
        detail: (row.title ?? row.snippet).slice(0, 180),
      })),
    });
  }
  return drafts.sort((a, b) => b.weight - a.weight).slice(0, 4);
}

/**
 * Threads where you spoke last and nobody answered.
 *
 * Only for people who normally DO answer, and only past the time they normally
 * take. "Nobody replied to the newsletter I sent" is not a thing worth saying.
 */
function awaitingReplyCards(): Draft[] {
  let rows: { who: string; at: number; fromMe: number; title: string | null }[];
  try {
    rows = oracleDb().all<{ who: string; at: number; fromMe: number; title: string | null }>(
      `SELECT who, at, title,
              CASE WHEN who = 'You' OR who LIKE 'You →%' THEN 1 ELSE 0 END AS fromMe
         FROM items
        WHERE source IN ('mail','messages') AND at > ? AND who IS NOT NULL
        ORDER BY at ASC`,
      Date.now() - 120 * 86_400_000,
    );
  } catch {
    return [];
  }

  /*
   * Messages record the counterparty in `who` even for outgoing ones ("You"),
   * so the correspondent has to come from the chat rather than the sender.
   * Mail records "you → them". Both collapse to: strip the arrow, take what is
   * left, and remember which direction it went.
   */
  const threads = new Map<string, { at: number; fromMe: boolean; title: string | null }[]>();
  for (const row of rows) {
    const counterparty = row.who.replace(/^You\s*→\s*/, "").split(/[,;]/)[0].trim().toLowerCase();
    if (!counterparty || counterparty === "you") continue;
    const list = threads.get(counterparty) ?? [];
    list.push({ at: row.at, fromMe: row.fromMe === 1, title: row.title });
    threads.set(counterparty, list);
  }

  const drafts: Draft[] = [];
  for (const [who, entries] of threads) {
    if (entries.length < 4) continue;
    const last = entries[entries.length - 1];
    if (!last.fromMe) continue;

    /* Their usual latency: the gap between each of your messages and their
       next reply. No replies at all means no expectation to violate. */
    const latencies: number[] = [];
    for (let i = 0; i < entries.length - 1; i++) {
      if (entries[i].fromMe && !entries[i + 1].fromMe) {
        latencies.push(entries[i + 1].at - entries[i].at);
      }
    }
    if (latencies.length < 3) continue;
    latencies.sort((a, b) => a - b);
    const typical = latencies[Math.floor(latencies.length / 2)];
    const waiting = Date.now() - last.at;
    if (waiting < Math.max(typical * 2.5, 2 * 86_400_000)) continue;

    const days = Math.round(waiting / 86_400_000);
    const usualHours = Math.max(1, Math.round(typical / 3_600_000));
    drafts.push({
      id: `awaiting-reply:${who}`,
      kind: "awaiting-reply",
      weight: Math.min(0.9, 0.5 + (waiting / (typical * 2.5) - 1) * 0.12),
      title: `${who} has not replied in ${days} day${days === 1 ? "" : "s"}`,
      body: `They usually answer within about ${usualHours} hour${usualHours === 1 ? "" : "s"}.`,
      until: null,
      evidence: last.title ? [{ label: "Your last message", detail: last.title.slice(0, 180) }] : [],
    });
  }
  return drafts.sort((a, b) => b.weight - a.weight).slice(0, 4);
}

/**
 * "You usually invoice on the 1st."
 *
 * Activity clustered on a particular day of the month, which is what a monthly
 * obligation looks like from the outside. Needs at least three months of it, on
 * a day that is genuinely dominant rather than merely the busiest.
 */
function monthlyHabitCards(): Draft[] {
  let rows: { at: number; title: string | null; source: OracleSource }[];
  try {
    rows = oracleDb().all<{ at: number; title: string | null; source: OracleSource }>(
      `SELECT at, title, source FROM items
        WHERE at > ? AND source IN ('mail','calendar','files') AND title IS NOT NULL`,
      Date.now() - 400 * 86_400_000,
    );
  } catch {
    return [];
  }

  /* Grouped by a keyword from the title so "Invoice #123" and "Invoice #124"
     are the same habit. First real word, lowercased, is crude and works. */
  const habits = new Map<string, { days: number[]; months: Set<string>; sample: string }>();
  for (const row of rows) {
    const word = (row.title ?? "").toLowerCase().match(/[a-z]{4,}/)?.[0];
    if (!word) continue;
    const date = new Date(row.at);
    const entry = habits.get(word) ?? { days: [], months: new Set<string>(), sample: row.title ?? "" };
    entry.days.push(date.getDate());
    entry.months.add(`${date.getFullYear()}-${date.getMonth()}`);
    habits.set(word, entry);
  }

  const today = new Date().getDate();
  const drafts: Draft[] = [];
  for (const [word, entry] of habits) {
    if (entry.months.size < 3 || entry.days.length < 3) continue;
    const counts = new Map<number, number>();
    for (const day of entry.days) counts.set(day, (counts.get(day) ?? 0) + 1);
    const [day, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    /* Dominant, not merely most common: half of all occurrences on one day of
       the month, across at least three different months. */
    if (n < entry.months.size || n / entry.days.length < 0.5) continue;
    /* Only worth saying on the day itself or the two after it. */
    if (today < day || today > day + 2) continue;

    drafts.push({
      id: `monthly-habit:${word}:${new Date().getFullYear()}-${new Date().getMonth()}`,
      kind: "monthly-habit",
      weight: Math.min(0.8, 0.45 + entry.months.size * 0.05),
      title: `You usually deal with "${word}" around the ${day}${ordinal(day)}`,
      body: `Seen in ${entry.months.size} of the last 13 months. Today is the ${today}${ordinal(today)}.`,
      until: Date.now() + 3 * 86_400_000,
      evidence: [{ label: "For example", detail: entry.sample.slice(0, 160) }],
    });
  }
  return drafts.sort((a, b) => b.weight - a.weight).slice(0, 2);
}

const ordinal = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][Math.min(n % 10, 4)] ?? "th";
};

/** Twin found something and nobody has looked at it. */
function twinCards(): Draft[] {
  try {
    const rows = twinDb().all<{ id: string; summary: string | null; count: number; sample: string | null }>(
      "SELECT id, summary, count, sample FROM patterns WHERE state IN (0,1) ORDER BY count DESC LIMIT 2",
    );
    return rows
      .filter((row) => row.summary)
      .map((row) => ({
        id: `twin-pattern:${row.id}`,
        kind: "twin-pattern" as const,
        weight: Math.min(0.75, 0.45 + row.count * 0.01),
        title: row.summary!,
        body: "Twin can take this over for you.",
        until: null,
        evidence: row.sample ? [{ label: "For example", detail: row.sample.slice(0, 200) }] : [],
      }));
  } catch {
    return [];
  }
}

/** Questions the wiki was asked and could not answer. */
async function wikiGapCards(): Promise<Draft[]> {
  const vault = await getActiveVault();
  if (!vault) return [];
  try {
    const { readAsked } = await import("@/lib/asked");
    /* `readAsked` takes only a root; the whole log comes back and the recent
       slice is taken here. Passing a limit compiled to a silently-ignored second
       argument, which is the shape of bug that survives review. */
    const turns = (await readAsked(vault.root)).slice(-200);
    const misses = turns.filter((turn) => !turn.answer || !turn.sources?.length);
    if (misses.length < 3) return [];
    return [
      {
        id: `wiki-gap:${new Date().toISOString().slice(0, 10)}`,
        kind: "wiki-gap" as const,
        weight: Math.min(0.7, 0.4 + misses.length * 0.02),
        title: `${misses.length} questions your wiki could not answer`,
        body: "Each one is a page that does not exist yet.",
        until: Date.now() + 3 * 86_400_000,
        evidence: misses.slice(0, 5).map((turn) => ({
          label: new Date(turn.at).toLocaleDateString(),
          detail: turn.question.slice(0, 160),
        })),
      },
    ];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------- think

export type ThinkResult = { created: number; updated: number; expired: number; considered: number };

/** Look at everything and decide whether there is anything worth saying. */
export async function think(): Promise<ThinkResult> {
  const config = await readProphetConfig();
  const db = prophetDb();

  /* Gone before anything else runs, so an expired meeting card can never be
     "updated" back into visibility by a miner that still sees the event. */
  const expired = db.run("DELETE FROM cards WHERE until IS NOT NULL AND until < ?", Date.now()).changes;

  const drafts: Draft[] = [];
  if (config.kinds["meeting-soon"] || config.kinds["meeting-prep"]) {
    drafts.push(...(await meetingCards(config)));
  }
  if (config.kinds["silent-contact"]) drafts.push(...silentContactCards());
  if (config.kinds["awaiting-reply"]) drafts.push(...awaitingReplyCards());
  if (config.kinds["monthly-habit"]) drafts.push(...monthlyHabitCards());
  if (config.kinds["twin-pattern"]) drafts.push(...twinCards());
  if (config.kinds["wiki-gap"]) drafts.push(...(await wikiGapCards()));

  let created = 0;
  let updated = 0;

  for (const item of drafts) {
    if (!config.kinds[item.kind]) continue;
    const weight = item.weight * kindMultiplier(db, item.kind);
    if (weight < config.bar) continue;

    const existing = db.get<{ state: number }>("SELECT state FROM cards WHERE id = ?", item.id);
    if (existing) {
      /* A dismissed card stays dismissed. Re-raising something the user has
         already waved away is the single fastest way to become noise. */
      if (existing.state === 3) continue;
      db.run(
        "UPDATE cards SET weight = ?, title = ?, body = ?, evidence = ?, until = ? WHERE id = ?",
        weight,
        item.title,
        item.body,
        JSON.stringify(item.evidence),
        item.until,
        item.id,
      );
      updated++;
    } else {
      db.run(
        "INSERT INTO cards (id, kind, at, until, weight, title, body, evidence, state) VALUES (?,?,?,?,?,?,?,?,0)",
        item.id,
        item.kind,
        Date.now(),
        item.until,
        weight,
        item.title,
        item.body,
        JSON.stringify(item.evidence),
      );
      db.run(
        `INSERT INTO feedback (kind, shown) VALUES (?, 1)
         ON CONFLICT(kind) DO UPDATE SET shown = feedback.shown + 1`,
        item.kind,
      );
      created++;
    }
  }

  return { created, updated, expired, considered: drafts.length };
}

/** What Prophet wants to say right now. */
export async function currentCards(): Promise<Card[]> {
  const config = await readProphetConfig();
  const db = prophetDb();
  return db
    .all(
      `SELECT * FROM cards
        WHERE state IN (0,1)
          AND (snoozeUntil IS NULL OR snoozeUntil < ?)
          AND weight >= ?
        ORDER BY weight DESC, at DESC
        LIMIT ?`,
      Date.now(),
      config.bar,
      config.maxCards,
    )
    .map(hydrate);
}

/** Cards worth interrupting for that have not been announced yet. */
export async function pendingNotifications(): Promise<Card[]> {
  const config = await readProphetConfig();
  const db = prophetDb();
  return db
    .all(
      `SELECT * FROM cards WHERE state = 0 AND notified = 0 AND weight >= ?
         AND (snoozeUntil IS NULL OR snoozeUntil < ?)
        ORDER BY weight DESC LIMIT 3`,
      config.notifyAbove,
      Date.now(),
    )
    .map(hydrate);
}

export function markNotified(ids: string[]): void {
  const db = prophetDb();
  for (const id of ids) db.run("UPDATE cards SET notified = 1 WHERE id = ?", id);
}

export function respond(
  id: string,
  response: "seen" | "snooze" | "dismiss" | "acted",
  snoozeMinutes = 60,
): Card | null {
  const db = prophetDb();
  const card = db.get<{ kind: CardKind }>("SELECT kind FROM cards WHERE id = ?", id);
  if (!card) return null;

  if (response === "seen") db.run("UPDATE cards SET state = 1 WHERE id = ?", id);
  if (response === "snooze") {
    db.run(
      "UPDATE cards SET state = 2, snoozeUntil = ? WHERE id = ?",
      Date.now() + Math.max(1, snoozeMinutes) * 60_000,
      id,
    );
  }
  if (response === "dismiss") {
    db.run("UPDATE cards SET state = 3 WHERE id = ?", id);
    db.run(
      `INSERT INTO feedback (kind, dismissed) VALUES (?, 1)
       ON CONFLICT(kind) DO UPDATE SET dismissed = feedback.dismissed + 1`,
      card.kind,
    );
  }
  if (response === "acted") {
    db.run("UPDATE cards SET state = 4 WHERE id = ?", id);
    db.run(
      `INSERT INTO feedback (kind, acted) VALUES (?, 1)
       ON CONFLICT(kind) DO UPDATE SET acted = feedback.acted + 1`,
      card.kind,
    );
  }
  const row = db.get("SELECT * FROM cards WHERE id = ?", id);
  return row ? hydrate(row) : null;
}

/**
 * A short brief for the next meeting, written from what Prophet found.
 *
 * Generated on demand rather than during `think`, because it costs a model call
 * and most cards are read at a glance and never opened.
 */
export async function briefFor(id: string): Promise<{ card: Card; brief: string | null; needsModel: boolean } | null> {
  const db = prophetDb();
  const row = db.get("SELECT * FROM cards WHERE id = ?", id);
  if (!row) return null;
  const card = hydrate(row);
  if (!card.evidence.length) return { card, brief: null, needsModel: false };

  const detection = await detectOllama().catch(() => null);
  const model = detection?.running ? recommendModel(detection.models) : null;
  if (!model) return { card, brief: null, needsModel: true };

  const brief = await generate(
    model,
    `Subject: ${card.title}\n\nWhat is on record:\n\n${card.evidence
      .map((item, i) => `[${i + 1}] ${item.label}\n${item.detail}`)
      .join("\n\n")}\n\nBrief:`,
    {
      system: `Write a briefing of at most four bullets from the records given.

Rules:
- Only what the records say. No advice, no speculation, no "you should".
- Each bullet names a fact and when it happened.
- If something is clearly unresolved, put it last and mark it "Open:".
- No preamble.`,
      timeoutMs: 60_000,
      maxTokens: 400,
    },
  ).catch(() => "");

  return { card, brief: brief.trim() || null, needsModel: false };
}

export type ProphetStatus = {
  cards: number;
  live: number;
  dismissed: number;
  byKind: { kind: CardKind; shown: number; dismissed: number; acted: number; multiplier: number }[];
  sources: { oracle: boolean; twin: boolean; calendar: boolean; wiki: boolean };
};

export async function prophetStatus(): Promise<ProphetStatus> {
  const db = prophetDb();
  const feedback = db.all<{ kind: CardKind; shown: number; dismissed: number; acted: number }>(
    "SELECT kind, shown, dismissed, acted FROM feedback",
  );
  const calendar = await ADAPTERS.calendar.probe().catch(() => ({ available: false, reason: "" }));

  const count = (sql: string, ...params: (string | number)[]) =>
    db.get<{ n: number }>(sql, ...params)?.n ?? 0;

  return {
    cards: count("SELECT COUNT(*) AS n FROM cards"),
    live: count("SELECT COUNT(*) AS n FROM cards WHERE state IN (0,1)"),
    dismissed: count("SELECT COUNT(*) AS n FROM cards WHERE state = 3"),
    byKind: feedback.map((row) => ({ ...row, multiplier: kindMultiplier(db, row.kind) })),
    /* What Prophet can currently see. Half its cards need Oracle, and a user
       wondering why it never mentions anyone should be told this rather than
       left to guess. Each probe is against that feature's OWN database — an
       earlier version asked Prophet's database for an `items` table, which does
       not exist there and threw on the status endpoint. */
    sources: {
      oracle: hasOracleItems(),
      twin: hasTwinPatterns(),
      calendar: calendar.available,
      wiki: Boolean(await getActiveVault()),
    },
  };
}

function hasOracleItems(): boolean {
  try {
    return (oracleDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM items")?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

function hasTwinPatterns(): boolean {
  try {
    return (twinDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM patterns")?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function forgetProphet(): Promise<void> {
  await dropDb("prophet");
}

/** Look at every wiki page mentioning a name — used by the meeting brief. */
export async function wikiMentions(name: string, limit = 4): Promise<{ relPath: string; title: string }[]> {
  const vault = await getActiveVault();
  if (!vault) return [];
  const index = await getIndex(vault.root);
  const needle = name.toLowerCase();
  return index.pages
    .filter((page) => page.plain.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((page) => ({ relPath: page.relPath, title: page.title }));
}

/** Re-exported so the API layer can search Oracle without importing two modules. */
export { searchOracle };
