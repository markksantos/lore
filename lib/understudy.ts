import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, dropDb, dbSize, ftsLadder, hasTable, openForeignCopy, type Db } from "@/lib/signal-store";
import { scrub } from "@/lib/listen";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import { getActiveVault } from "@/lib/config";
import { getIndex } from "@/lib/wiki";
import { htmlToText, parseEmlx, tidy } from "@/lib/oracle-sources";
import {
  compareVoice,
  measureVoice,
  voiceBrief,
  wordsOf,
  type VoiceProfile,
  type VoiceStats,
} from "@/lib/voice-core";

/* Re-exported so callers keep importing "the voice feature" rather than
   having to know which half of it is pure. */
export { compareVoice, measureVoice, splitSentences, voiceBrief } from "@/lib/voice-core";
export type { VoiceProfile, VoiceStats } from "@/lib/voice-core";

/**
 * Understudy — writing that sounds like you, because it is measured from you.
 *
 * "Write in my voice" is the most-requested and least-delivered thing in this
 * whole category. The reason it fails is that everybody implements it as an
 * instruction — "write in a friendly, concise tone" — and an instruction is a
 * description of a voice, not the voice. The model reverts to its own register
 * within two sentences because nothing is holding it anywhere else.
 *
 * So Understudy does not describe. It MEASURES. Your median sentence is
 * fourteen words. You use a contraction 71% of the times you could. You open
 * with "Just" more than any other word and you never open with "I hope". You
 * write to clients in nineteen-word sentences and to your partner in eight.
 * Those are numbers, they go in the prompt as numbers, and afterwards the draft
 * is measured the same way and scored against them — so "sounds like me" stops
 * being a matter of opinion and becomes a diff you can look at.
 *
 * On top of the numbers sit real examples, retrieved by similarity to what you
 * are writing now. Numbers hold the shape; examples carry the idiom.
 *
 * IT NEVER LEAVES THE MACHINE. Not "we don't train on it" — there is no network
 * call in this module and the drafting path refuses any provider that is not
 * the local Ollama. Your private writing is the most sensitive corpus in this
 * entire product, and the only defensible design is one where it physically
 * cannot go anywhere.
 */

export type UnderstudySource = "wiki" | "sent-mail" | "messages" | "folders";

export const UNDERSTUDY_LABEL: Record<UnderstudySource, string> = {
  wiki: "Your wiki",
  "sent-mail": "Mail you sent",
  messages: "Messages you sent",
  folders: "Folders you choose",
};

export type UnderstudyConfig = {
  sources: Record<UnderstudySource, boolean>;
  folders: string[];
  /** Samples shorter than this are noise ("ok", "thanks"). */
  minWords: number;
  redact: boolean;
};

export const DEFAULT_UNDERSTUDY: UnderstudyConfig = {
  sources: { wiki: false, "sent-mail": false, messages: false, folders: false },
  folders: [],
  minWords: 25,
  redact: true,
};

const DIR = path.join(os.homedir(), ".lore", "understudy");
const CONFIG_FILE = path.join(DIR, "config.json");

export async function readUnderstudyConfig(): Promise<UnderstudyConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_UNDERSTUDY;
  try {
    const parsed = JSON.parse(raw) as Partial<UnderstudyConfig>;
    return {
      sources: { ...DEFAULT_UNDERSTUDY.sources, ...(parsed.sources ?? {}) },
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.filter((f): f is string => typeof f === "string" && f.startsWith("/")).slice(0, 16)
        : [],
      minWords: Math.min(200, Math.max(5, Number(parsed.minWords) || DEFAULT_UNDERSTUDY.minWords)),
      redact: parsed.redact !== false,
    };
  } catch {
    return DEFAULT_UNDERSTUDY;
  }
}

export async function writeUnderstudyConfig(config: UnderstudyConfig): Promise<UnderstudyConfig> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

// --------------------------------------------------------------------- store

const MIGRATIONS = [
  `
  CREATE TABLE samples (
    id       INTEGER PRIMARY KEY,
    source   TEXT NOT NULL,
    nativeId TEXT NOT NULL,
    /* Who it was written for. This is what makes the formality gradient
       possible: the same person writes differently to a client and a friend,
       and one averaged voice is nobody's. */
    audience TEXT,
    at       INTEGER,
    text     TEXT NOT NULL,
    words    INTEGER NOT NULL DEFAULT 0,
    uri      TEXT
  );
  CREATE UNIQUE INDEX samples_native ON samples(source, nativeId);
  CREATE INDEX samples_audience ON samples(audience);
  CREATE VIRTUAL TABLE samples_fts USING fts5(text, tokenize = 'porter unicode61');

  CREATE TABLE profile (
    id   INTEGER PRIMARY KEY CHECK (id = 1),
    at   INTEGER NOT NULL,
    json TEXT NOT NULL
  );

  CREATE TABLE drafts (
    id       TEXT PRIMARY KEY,
    at       INTEGER NOT NULL,
    brief    TEXT NOT NULL,
    audience TEXT,
    text     TEXT NOT NULL,
    match    REAL,
    model    TEXT
  );
  CREATE INDEX drafts_at ON drafts(at DESC);
  `,
];

export function understudyDb(): Db {
  return openDb("understudy", MIGRATIONS);
}

// ---------------------------------------------------------------- collection

function addSample(
  db: Db,
  source: UnderstudySource,
  nativeId: string,
  text: string,
  opts: { audience?: string | null; at?: number | null; uri?: string | null; redact: boolean; minWords: number },
): boolean {
  const cleaned = tidy(opts.redact ? scrub(text) : text, 20_000);
  const words = wordsOf(cleaned).length;
  if (words < opts.minWords) return false;

  const existing = db.get<{ id: number }>(
    "SELECT id FROM samples WHERE source = ? AND nativeId = ?",
    source,
    nativeId,
  );
  db.tx(() => {
    if (existing) {
      db.run(
        "UPDATE samples SET audience = ?, at = ?, text = ?, words = ?, uri = ? WHERE id = ?",
        opts.audience ?? null,
        opts.at ?? null,
        cleaned,
        words,
        opts.uri ?? null,
        existing.id,
      );
      db.run("UPDATE samples_fts SET text = ? WHERE rowid = ?", cleaned, existing.id);
    } else {
      const { lastInsertRowid } = db.run(
        "INSERT INTO samples (source, nativeId, audience, at, text, words, uri) VALUES (?,?,?,?,?,?,?)",
        source,
        nativeId,
        opts.audience ?? null,
        opts.at ?? null,
        cleaned,
        words,
        opts.uri ?? null,
      );
      db.run("INSERT INTO samples_fts (rowid, text) VALUES (?, ?)", lastInsertRowid, cleaned);
    }
  });
  return true;
}

/**
 * Strip the parts of an email that are not yours.
 *
 * A reply contains the message it is replying to, and indexing that as your
 * writing measures the other person's voice and calls it yours. Quoted blocks,
 * the "On … wrote:" attribution line and everything after a signature marker
 * all go.
 */
export function ownWordsOnly(body: string): string {
  const lines = body.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .{5,80}\bwrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*$/.test(line)) break;
    if (/^\s*(?:_{5,}|-{5,})\s*$/.test(line)) break;
    if (/^\s*From:\s|^\s*Sent from my /i.test(line)) break;
    if (/^\s*Begin forwarded message/i.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export type CollectReport = { source: UnderstudySource; added: number; reason: string | null };

async function collectWiki(db: Db, config: UnderstudyConfig): Promise<CollectReport> {
  const vault = await getActiveVault();
  if (!vault) return { source: "wiki", added: 0, reason: "No wiki is linked." };
  const index = await getIndex(vault.root);
  let added = 0;
  for (const page of index.pages) {
    if (
      addSample(db, "wiki", page.relPath, page.plain, {
        audience: "wiki",
        at: page.mtime,
        uri: page.relPath,
        redact: config.redact,
        minWords: config.minWords,
      })
    ) {
      added++;
    }
  }
  return { source: "wiki", added, reason: null };
}

async function collectSentMail(db: Db, config: UnderstudyConfig): Promise<CollectReport> {
  const base = path.join(os.homedir(), "Library", "Mail");
  const entries = await fs.readdir(base).catch(() => null);
  if (!entries) {
    return {
      source: "sent-mail",
      added: 0,
      reason: "Apple Mail is not set up, or macOS blocked its folder (Full Disk Access).",
    };
  }

  /* Only Sent mailboxes. Walking all of Mail and filtering by From: would mean
     parsing a hundred thousand received messages to find the few thousand
     that are yours. */
  const sentDirs: string[] = [];
  const findSent = async (dir: string, depth: number): Promise<void> => {
    if (depth < 0 || sentDirs.length > 40) return;
    const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of list) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (/^Sent(\s|_|-|\.)?(Messages|Mail|Items)?\.mbox$/i.test(entry.name)) sentDirs.push(full);
      else await findSent(full, depth - 1);
    }
  };
  await findSent(base, 6);
  if (!sentDirs.length) {
    return { source: "sent-mail", added: 0, reason: "No Sent mailbox found under ~/Library/Mail." };
  }

  let added = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth < 0 || added >= 3_000) return;
    const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of list) {
      if (added >= 3_000) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth - 1);
        continue;
      }
      if (!entry.name.endsWith(".emlx")) continue;
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.size > 2_000_000) continue;
      const raw = await fs.readFile(full, "utf8").catch(() => "");
      if (!raw) continue;
      const parsed = parseEmlx(raw);
      if (!parsed) continue;
      const own = ownWordsOnly(htmlToText(parsed.body));
      if (!own) continue;
      /* The recipient is the audience. This is what produces the formality
         gradient: the same person's mail to a client and to a friend land in
         two buckets and get measured separately. */
      const audience = (parsed.to ?? "").match(/[\w.+-]+@[\w.-]+/)?.[0]?.toLowerCase() ?? "mail";
      if (
        addSample(db, "sent-mail", full, own, {
          audience,
          at: parsed.date ?? Math.round(stat.mtimeMs),
          uri: full,
          redact: config.redact,
          minWords: config.minWords,
        })
      ) {
        added++;
      }
    }
  };
  for (const dir of sentDirs) await walk(dir, 6);
  return { source: "sent-mail", added, reason: null };
}

async function collectMessages(db: Db, config: UnderstudyConfig): Promise<CollectReport> {
  const source = path.join(os.homedir(), "Library", "Messages", "chat.db");
  const opened = await openForeignCopy(source);
  if (!opened) {
    return {
      source: "messages",
      added: 0,
      reason: "Messages is unavailable, or macOS blocked chat.db (Full Disk Access).",
    };
  }
  try {
    const { db: chat } = opened;
    if (!hasTable(chat, "message")) return { source: "messages", added: 0, reason: "Unexpected schema." };

    /*
     * One message is not a writing sample.
     *
     * A text is six words long, and measuring six-word fragments would tell
     * Understudy that this person writes in six-word sentences to everybody.
     * Consecutive messages you sent to the same person inside ten minutes are
     * one utterance, so they are stitched into one sample before measuring.
     */
    const rows = chat.all<{ rowid: number; text: string | null; atMs: number | null; handle: string | null }>(
      `SELECT m.ROWID AS rowid, m.text AS text,
              CAST(((CASE WHEN ABS(m.date) > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END)
                    + 978307200) * 1000 AS INTEGER) AS atMs,
              h.id AS handle
         FROM message m
         LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE m.is_from_me = 1 AND m.text IS NOT NULL AND length(m.text) > 12
        ORDER BY m.date DESC
        LIMIT 20000`,
    );

    const threads = new Map<string, { at: number; parts: string[]; last: number }[]>();
    for (const row of rows) {
      const who = row.handle ?? "unknown";
      const at = row.atMs ?? 0;
      const list = threads.get(who) ?? [];
      const open = list[list.length - 1];
      if (open && Math.abs(open.last - at) < 10 * 60_000) {
        open.parts.push(row.text!);
        open.last = at;
      } else {
        list.push({ at, parts: [row.text!], last: at });
      }
      threads.set(who, list);
    }

    let added = 0;
    for (const [who, blocks] of threads) {
      for (const block of blocks) {
        if (added >= 4_000) break;
        if (
          addSample(db, "messages", `${who}:${block.at}`, block.parts.reverse().join("\n"), {
            audience: who,
            at: block.at,
            uri: null,
            redact: config.redact,
            minWords: config.minWords,
          })
        ) {
          added++;
        }
      }
    }
    return { source: "messages", added, reason: null };
  } finally {
    await opened.dispose();
  }
}

async function collectFolders(db: Db, config: UnderstudyConfig): Promise<CollectReport> {
  if (!config.folders.length) {
    return { source: "folders", added: 0, reason: "No folders chosen." };
  }
  let added = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth < 0 || added >= 3_000) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (added >= 3_000) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth - 1);
        continue;
      }
      if (!/\.(md|markdown|txt|rtf)$/i.test(entry.name)) continue;
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.size > 2_000_000) continue;
      const text = await fs.readFile(full, "utf8").catch(() => "");
      if (!text.trim()) continue;
      if (
        addSample(db, "folders", full, text, {
          audience: path.basename(dir),
          at: Math.round(stat.mtimeMs),
          uri: full,
          redact: config.redact,
          minWords: config.minWords,
        })
      ) {
        added++;
      }
    }
  };
  for (const folder of config.folders) await walk(folder, 6);
  return { source: "folders", added, reason: null };
}

export async function learnVoice(): Promise<{ reports: CollectReport[]; profile: VoiceProfile }> {
  const config = await readUnderstudyConfig();
  const db = understudyDb();
  const reports: CollectReport[] = [];
  if (config.sources.wiki) reports.push(await collectWiki(db, config));
  if (config.sources["sent-mail"]) reports.push(await collectSentMail(db, config));
  if (config.sources.messages) reports.push(await collectMessages(db, config));
  if (config.sources.folders) reports.push(await collectFolders(db, config));
  return { reports, profile: rebuildProfile() };
}

/**
 * How many samples an audience needs before it gets its own measurements.
 *
 * Below this the numbers are noise dressed as insight — three emails to one
 * address would produce a "formality profile" for that person built on three
 * data points, and Understudy would then confidently write to them in a voice
 * derived from a rounding error.
 */
const AUDIENCE_MIN_SAMPLES = 8;

export function rebuildProfile(): VoiceProfile {
  const db = understudyDb();
  const all = db.all<{ text: string; audience: string | null }>("SELECT text, audience FROM samples");
  const overall = measureVoice(all.map((row) => row.text));

  const grouped = new Map<string, string[]>();
  for (const row of all) {
    if (!row.audience) continue;
    const list = grouped.get(row.audience) ?? [];
    list.push(row.text);
    grouped.set(row.audience, list);
  }

  const byAudience = [...grouped.entries()]
    .filter(([, texts]) => texts.length >= AUDIENCE_MIN_SAMPLES)
    .map(([audience, texts]) => ({ audience, stats: measureVoice(texts) }))
    .sort((a, b) => b.stats.samples - a.stats.samples)
    .slice(0, 24);

  const profile: VoiceProfile = { at: Date.now(), overall, byAudience };
  db.run(
    "INSERT INTO profile (id, at, json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, json = excluded.json",
    profile.at,
    JSON.stringify(profile),
  );
  return profile;
}

export function readProfile(): VoiceProfile | null {
  const row = understudyDb().get<{ json: string }>("SELECT json FROM profile WHERE id = 1");
  if (!row) return null;
  try {
    return JSON.parse(row.json) as VoiceProfile;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- drafting

const DRAFT_SYSTEM = `You are drafting a message AS the user, not for them. The output is what they will send, with nothing around it.

Absolute rules:
- No preamble, no "here's a draft", no sign-off unless their examples use one.
- Match the measurements below. They were taken from thousands of words this person actually wrote; where the measurements and your instincts disagree, the measurements win.
- Match the examples' idiom, rhythm and vocabulary. Do not match their subject matter.
- Never use a word the examples and the characteristic-word list do not support. No "delve", "leverage", "streamline", "robust", "seamless", "elevate" unless they are in that list.
- Say only what the brief asks for. Do not add pleasantries, offers to help, or closing questions that were not requested.`;

export type DraftResult = {
  id: string;
  brief: string;
  audience: string | null;
  text: string;
  model: string | null;
  needsModel: boolean;
  /** 0-1: how closely the draft's own measurements match the profile. */
  match: number | null;
  deviations: { name: string; yours: string; draft: string }[];
  exemplars: { text: string; audience: string | null; at: number | null }[];
};

/**
 * Write something in the user's voice.
 *
 * Local model only, and not by configuration — by construction. Understudy's
 * corpus is the most private thing in the product, and the exemplars go into
 * the prompt verbatim. There is no code path here that reaches a network.
 */
export async function draft(brief: string, audience: string | null): Promise<DraftResult> {
  const db = understudyDb();
  const profile = readProfile() ?? rebuildProfile();
  const stats =
    (audience ? profile.byAudience.find((entry) => entry.audience === audience)?.stats : null) ??
    profile.overall;

  if (!stats.samples) {
    return {
      id: "",
      brief,
      audience,
      text: "",
      model: null,
      needsModel: false,
      match: null,
      deviations: [],
      exemplars: [],
    };
  }

  /*
   * Exemplars by similarity to the brief, restricted to the audience when one
   * is named. Similar SUBJECT is what carries idiom: how this person writes
   * about money is not how they write about scheduling.
   */
  const exemplars: { text: string; audience: string | null; at: number | null }[] = [];
  for (const match of ftsLadder(brief)) {
    const rows = db.all<{ text: string; audience: string | null; at: number | null }>(
      `SELECT s.text, s.audience, s.at FROM samples_fts
         JOIN samples s ON s.id = samples_fts.rowid
        WHERE samples_fts MATCH ? ${audience ? "AND s.audience = ?" : ""}
        ORDER BY -bm25(samples_fts) DESC LIMIT 4`,
      match,
      ...(audience ? [audience] : []),
    );
    if (rows.length) {
      exemplars.push(...rows);
      break;
    }
  }
  if (exemplars.length < 3) {
    /* Nothing on topic: fall back to the most recent writing for this audience,
       which still carries the register even if not the subject. */
    exemplars.push(
      ...db.all<{ text: string; audience: string | null; at: number | null }>(
        `SELECT text, audience, at FROM samples ${audience ? "WHERE audience = ?" : ""}
          ORDER BY at DESC LIMIT ?`,
        ...(audience ? [audience] : []),
        4 - exemplars.length,
      ),
    );
  }

  const detection = await detectOllama().catch(() => null);
  const model = detection?.running ? recommendModel(detection.models) : null;
  if (!model) {
    return {
      id: "",
      brief,
      audience,
      text: "",
      model: null,
      needsModel: true,
      match: null,
      deviations: [],
      exemplars,
    };
  }

  const examples = exemplars
    .slice(0, 4)
    .map((sample, i) => `Example ${i + 1}:\n${sample.text.slice(0, 1_500)}`)
    .join("\n\n");

  const text = (
    await generate(
      model,
      `How this person writes${audience ? ` to ${audience}` : ""}:\n${voiceBrief(stats)}\n\nThings they actually wrote:\n\n${examples}\n\nWrite this, as them:\n${brief}`,
      { system: DRAFT_SYSTEM, timeoutMs: 120_000, maxTokens: 1_000 },
    ).catch(() => "")
  ).trim();

  const { match, deviations } = compareVoice(stats, text);
  const id = `draft-${Date.now().toString(36)}`;
  if (text) {
    db.run(
      "INSERT INTO drafts (id, at, brief, audience, text, match, model) VALUES (?,?,?,?,?,?,?)",
      id,
      Date.now(),
      brief,
      audience,
      text,
      match,
      model,
    );
  }

  return { id, brief, audience, text, model, needsModel: false, match, deviations, exemplars };
}

export type UnderstudyStatus = {
  samples: number;
  words: number;
  bySource: { source: string; n: number; words: number }[];
  audiences: { audience: string; n: number }[];
  profileAt: number | null;
  diskBytes: number;
  drafts: number;
};

export async function understudyStatus(): Promise<UnderstudyStatus> {
  const db = understudyDb();
  const totals = db.get<{ n: number; words: number }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(words),0) AS words FROM samples",
  );
  return {
    samples: totals?.n ?? 0,
    words: totals?.words ?? 0,
    bySource: db.all(
      "SELECT source, COUNT(*) AS n, COALESCE(SUM(words),0) AS words FROM samples GROUP BY source ORDER BY n DESC",
    ),
    audiences: db.all(
      `SELECT audience, COUNT(*) AS n FROM samples WHERE audience IS NOT NULL
        GROUP BY audience HAVING n >= ${AUDIENCE_MIN_SAMPLES} ORDER BY n DESC LIMIT 24`,
    ),
    profileAt: db.get<{ at: number }>("SELECT at FROM profile WHERE id = 1")?.at ?? null,
    diskBytes: await dbSize("understudy"),
    drafts: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM drafts")?.n ?? 0,
  };
}

export async function forgetUnderstudy(): Promise<void> {
  await dropDb("understudy");
}
