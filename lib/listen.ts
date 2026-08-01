import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";
import { detectOllama, generate, recommendModel } from "@/lib/ollama";
import { askGate } from "@/lib/gate";

/**
 * Auto-wiki — the listener.
 *
 * The wiki's founding bargain is that agents write down what they learn. In
 * practice they learn most of it in conversations, and conversations evaporate:
 * the decision made in a Claude Code session at 2pm exists nowhere at 3pm
 * except a JSONL file nobody will ever open. The listener watches those files,
 * distils what was durable with a local model, and files it — so talking to an
 * AI becomes, quietly, writing your wiki.
 *
 * Three design decisions carry all the weight:
 *
 * OPT-IN, and per source. This reads private conversations. It is off until a
 * person turns it on, each source is its own switch, and everything runs
 * locally — the transcript goes to the Ollama on this machine and nowhere
 * else.
 *
 * DISTIL OR NOTHING. A raw transcript dump is exactly the noise this product
 * exists to prevent — the model extracts decisions, corrections, constraints
 * and setups, or writes nothing at all. Without a local model the listener
 * does not degrade to dumping; it says it needs one and waits. And the model
 * only sees a SCRUBBED transcript: secrets are redacted before distillation,
 * because the one thing worse than a leaked key is a leaked key neatly filed
 * under "key facts".
 *
 * SOURCES ARE WHAT THEY ARE. Claude Code and Codex keep readable transcripts
 * on disk, so they stream in automatically. ChatGPT and the Claude desktop app
 * keep theirs where no local tool can honestly reach — for those there is the
 * inbox: drop an export (conversations.json, or any pasted .md/.txt) into
 * ~/.lore/inbox and it is distilled the same way. Claiming to "listen to
 * ChatGPT" without this caveat would be vaporware; the inbox is the version
 * that is true.
 */

export type ListenSource = "claude-code" | "codex" | "inbox";

export type ListenConfig = {
  enabled: boolean;
  sources: Record<ListenSource, boolean>;
  /** A transcript must be untouched this long before it is read. */
  quietMinutes: number;
};

export const DEFAULT_LISTEN: ListenConfig = {
  enabled: false,
  sources: { "claude-code": true, codex: true, inbox: true },
  quietMinutes: 3,
};

const DIR = path.join(os.homedir(), ".lore");
export const INBOX_DIR = path.join(DIR, "inbox");
const configPath = (key: string) => path.join(DIR, `listen-${key}.json`);
const statePath = (key: string) => path.join(DIR, `listen-state-${key}.json`);

export async function readListenConfig(root: string): Promise<ListenConfig> {
  const raw = await fs.readFile(configPath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return DEFAULT_LISTEN;
  try {
    const parsed = JSON.parse(raw) as Partial<ListenConfig>;
    return {
      enabled: parsed.enabled === true,
      sources: { ...DEFAULT_LISTEN.sources, ...(parsed.sources ?? {}) },
      quietMinutes: Math.max(1, Number(parsed.quietMinutes) || DEFAULT_LISTEN.quietMinutes),
    };
  } catch {
    return DEFAULT_LISTEN;
  }
}

export async function writeListenConfig(root: string, config: ListenConfig): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath(vaultKey(root)), JSON.stringify(config, null, 2), "utf8");
}

// ---------------------------------------------------------------------- state

/** Per absolute file path: how many bytes have already been distilled. */
type ListenState = Record<string, { bytes: number; at: number }>;

async function readState(key: string): Promise<ListenState> {
  const raw = await fs.readFile(statePath(key), "utf8").catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ListenState;
  } catch {
    return {};
  }
}

async function writeState(key: string, state: ListenState): Promise<void> {
  // Bounded: a file that vanished from disk stops occupying the state file.
  const entries = Object.entries(state);
  const kept = entries.length > 2_000 ? entries.slice(-2_000) : entries;
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(statePath(key), JSON.stringify(Object.fromEntries(kept)), "utf8");
}

// ---------------------------------------------------------------------- scrub

/**
 * Secrets never reach the model, let alone the wiki.
 *
 * People paste keys into AI chats constantly — that is half of what debugging
 * a deploy looks like. The transcript is scrubbed before distillation, so even
 * a model that wanted to file "the important fact" of an API key never sees
 * it. Patterns over perfection: this catches the shapes keys actually take,
 * and a missed exotic secret is still caught by the instruction to the model
 * plus the fact that distilled output is bullets about decisions, not config.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Prefixed API keys: sk-…, pk-…, sk-ant-…, sk-proj-…, sk_live_…, github_pat_…
  /\b(sk|pk|rk)[-_](?:live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprsce]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  // Google API keys.
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}\b/gi,
  // A private key BODY, not the whole armoured block: the BEGIN/END markers can
  // be clipped apart in a long transcript, so this catches the base64 payload
  // that follows a BEGIN line even when the END never arrives.
  /-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\n]*-----|$)/g,
  /\bMII[A-Za-z0-9+/=\s]{100,}/g,
  // Assignments. The old \b before the name could not match after an
  // underscore, so CLOUDFLARE_API_TOKEN= — the single most common shape a
  // secret takes in a transcript — was never touched. This keys on the
  // OPERATOR and the value: any KEY = "value" / KEY: value where the key name
  // signals a secret. Quoted values may contain spaces; unquoted may not.
  /(?<![\w-])([\w-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE|APIKEY|ACCESS[_-]?KEY)[\w-]*)\s*[:=]\s*(?:"[^"]{4,}"|'[^']{4,}'|[^\s"']{6,})/gi,
  // Bare high-entropy hex/base64-ish tokens of key length. Anchored on being a
  // standalone run so it does not eat commit hashes mid-word or ordinary prose.
  /(?<![\w-])[A-Fa-f0-9]{40,64}(?![\w-])/g,
  // Connection strings with an inline password.
  /\b\w+:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/g,
  // ssh private key one-liners occasionally pasted.
  /\b(ssh-rsa|ssh-ed25519)\s+[A-Za-z0-9+/=]{40,}/g,
];

export function scrub(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

// ------------------------------------------------------------------- extract

export type Turn = { role: "user" | "assistant"; text: string };

/** Claude Code session JSONL → turns. Tolerates torn lines and tool noise. */
export function turnsFromClaudeCode(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record: { type?: string; message?: { content?: unknown } };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== "user" && record.type !== "assistant") continue;
    const content = record.message?.content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      text = content
        .filter((p): p is { type: string; text: string } => p?.type === "text")
        .map((p) => p.text)
        .join("\n");
    }
    text = text.trim();
    // System-reminder blocks and hook output are plumbing, not conversation.
    if (!text || text.startsWith("<system-reminder>") || text.startsWith("<local-command")) continue;
    turns.push({ role: record.type, text });
  }
  return turns;
}

/** Codex rollout JSONL → turns. */
export function turnsFromCodex(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record: { type?: string; payload?: { type?: string; message?: string } };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== "event_msg") continue;
    const payload = record.payload;
    if (payload?.type === "user_message" && payload.message) {
      turns.push({ role: "user", text: payload.message.trim() });
    } else if (payload?.type === "agent_message" && payload.message) {
      turns.push({ role: "assistant", text: payload.message.trim() });
    }
  }
  return turns;
}

/** A ChatGPT export's conversations.json → turns, flattened across chats. */
export function turnsFromChatGPTExport(raw: string): Turn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const conversations = Array.isArray(parsed) ? parsed : [parsed];
  const turns: Turn[] = [];
  for (const conversation of conversations) {
    const mapping = (conversation as { mapping?: Record<string, unknown> })?.mapping;
    if (!mapping) continue;
    for (const node of Object.values(mapping)) {
      const message = (node as { message?: { author?: { role?: string }; content?: { parts?: unknown[] } } })
        ?.message;
      const role = message?.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = (message?.content?.parts ?? [])
        .filter((p): p is string => typeof p === "string")
        .join("\n")
        .trim();
      if (text) turns.push({ role, text });
    }
  }
  return turns;
}

/** Anything else in the inbox is treated as a plain-text conversation. */
export function turnsFromText(raw: string): Turn[] {
  const text = raw.trim();
  return text ? [{ role: "user", text }] : [];
}

// -------------------------------------------------------------------- distil

const DISTIL_SYSTEM = `You read a transcript between a person and an AI assistant, and extract ONLY what belongs in the person's permanent wiki.

Keep: decisions and their reasons, corrections of fact, durable preferences, how something is set up or configured, constraints discovered the hard way, prices, deadlines, names and roles agreed on.
Discard: progress narration, code being written, debugging back-and-forth, pleasantries, anything true only today.

Rules:
- Each fact is one self-contained bullet starting with "- ". A reader a month from now must understand it with no other context.
- Never include secrets, keys, tokens or passwords, even redacted ones.
- Maximum 8 bullets. Fewer is better.
- If nothing qualifies, reply with exactly: NOTHING`;

/**
 * Render a turn window the model can actually read.
 *
 * Long sessions are mostly tool output and code; the durable content lives in
 * what the person asked and what the assistant concluded. Each turn is capped,
 * and the window keeps the newest turns because a delta's earlier context was
 * already distilled last sweep.
 */
export function renderTurns(turns: Turn[], budgetChars = 12_000): string {
  const parts: string[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const clipped = turn.text.length > 700 ? `${turn.text.slice(0, 700)}…` : turn.text;
    const block = `${turn.role === "user" ? "PERSON" : "ASSISTANT"}: ${clipped}`;
    if (used + block.length > budgetChars) break;
    parts.unshift(block);
    used += block.length;
  }
  return parts.join("\n\n");
}

export type DistilResult =
  | { state: "facts"; bullets: string[] }
  | { state: "nothing" }
  | { state: "no-model" }
  | { state: "busy" };

export async function distil(turns: Turn[]): Promise<DistilResult> {
  if (!turns.length) return { state: "nothing" };

  const detection = await detectOllama().catch(() => null);
  const model = detection?.running
    ? (recommendModel(detection.models) ?? detection.models[0]?.name ?? null)
    : null;
  if (!model) return { state: "no-model" };

  // Scrub BEFORE the turn budget clips anything, so a secret whose armour or
  // context is longer than the 700-char per-turn clip is still redacted while
  // the pattern can see the whole thing. renderTurns then clips the already-
  // clean text, and scrub runs once more on the model's OUTPUT below.
  const scrubbedTurns = turns.map((t) => ({ ...t, text: scrub(t.text) }));
  const transcript = renderTurns(scrubbedTurns);
  if (transcript.trim().length < 200) return { state: "nothing" };

  /*
   * tryRun, not run: the listener is background work, and background work
   * never queues in front of a person's question. A busy slot means this file
   * keeps its place in the state and is distilled on the next sweep.
   */
  const reply = await askGate.tryRun(
    () =>
      generate(model, `Transcript:\n\n${transcript}\n\nFacts:`, {
        system: DISTIL_SYSTEM,
        timeoutMs: 60_000,
      }).catch(() => null),
    "BUSY" as string | null,
  );

  if (reply === "BUSY") return { state: "busy" };
  if (reply === null) return { state: "busy" };
  if (/^\s*NOTHING\s*$/i.test(reply)) return { state: "nothing" };

  const bullets = reply
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    // The scrub runs on the OUTPUT too — belt and braces against a model that
    // quotes something the input patterns missed.
    .map((line) => scrub(line))
    .slice(0, 8);

  return bullets.length ? { state: "facts", bullets } : { state: "nothing" };
}

// --------------------------------------------------------------------- sweep

type Candidate = {
  source: ListenSource;
  file: string;
  /** Distil from this byte onwards. */
  from: number;
  size: number;
  mtime: number;
  label: string;
  session?: string;
};

/** Transcript files that have grown since last distilled and gone quiet. */
async function findCandidates(config: ListenConfig, state: ListenState): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const quietMs = config.quietMinutes * 60_000;
  const now = Date.now();
  const home = os.homedir();

  const consider = (source: ListenSource, file: string, size: number, mtime: number, label: string, session?: string) => {
    const seen = state[file]?.bytes ?? 0;
    if (size <= seen) return;
    if (now - mtime < quietMs) return;
    // A transcript idle for a month is history, not news; skip rather than
    // flood the wiki with a backlog nobody asked for on first enable.
    if (now - mtime > 14 * 86_400_000) return;
    out.push({ source, file, from: seen, size, mtime, label, session });
  };

  if (config.sources["claude-code"]) {
    const base = path.join(home, ".claude", "projects");
    const projects = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const dir = path.join(base, project.name);
      const files = await fs.readdir(dir).catch(() => []);
      for (const name of files) {
        if (!name.endsWith(".jsonl")) continue;
        const file = path.join(dir, name);
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile()) continue;
        consider(
          "claude-code",
          file,
          stat.size,
          stat.mtimeMs,
          `Claude Code · ${project.name.split("-").slice(-1)[0] || "session"}`,
          name.replace(/\.jsonl$/, "").slice(0, 12),
        );
      }
    }
  }

  if (config.sources.codex) {
    for (const base of [path.join(home, ".codex", "sessions"), path.join(home, ".codex", "archived_sessions")]) {
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 3) return;
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full, depth + 1);
          else if (entry.name.endsWith(".jsonl")) {
            const stat = await fs.stat(full).catch(() => null);
            if (stat?.isFile()) {
              consider("codex", full, stat.size, stat.mtimeMs, "Codex", entry.name.slice(8, 20));
            }
          }
        }
      };
      await walk(base, 0);
    }
  }

  if (config.sources.inbox) {
    await fs.mkdir(INBOX_DIR, { recursive: true, mode: 0o700 }).catch(() => {});
    const files = await fs.readdir(INBOX_DIR).catch(() => []);
    for (const name of files) {
      if (name.startsWith(".") || name === "done") continue;
      const file = path.join(INBOX_DIR, name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) continue;
      // Inbox files are whole documents, not growing logs — no quiet period
      // beyond a few seconds of not-still-being-copied.
      if (Date.now() - stat.mtimeMs < 10_000) continue;
      out.push({
        source: "inbox",
        file,
        from: 0,
        size: stat.size,
        mtime: stat.mtimeMs,
        label: `Inbox · ${name}`,
      });
    }
  }

  // Oldest first: the backlog drains in order, and a hot file that keeps
  // growing does not starve the others.
  return out.sort((a, b) => a.mtime - b.mtime);
}

export type SweepResult = {
  scanned: number;
  distilled: number;
  filed: number;
  skipped: { busy: number; nothing: number; noModel: boolean };
  wrote: string[];
};

/** How many model calls one sweep may spend. The rest wait for the next. */
const MAX_DISTILS_PER_SWEEP = 3;
/** Never read more than this much new transcript per file per sweep. */
const MAX_DELTA_BYTES = 512 * 1024;

/**
 * One pass: find grown transcripts, distil the new part, file the facts.
 *
 * Filing goes through the same POST /api/page path as every other agent write
 * — attribution, journal, write-time feedback, canon checks, auto-commit —
 * because the listener IS an agent writing to the wiki, and a side door for
 * our own feature is how side doors start.
 */
export async function sweep(root: string, port: number): Promise<SweepResult> {
  const key = vaultKey(root);
  const config = await readListenConfig(root);
  const result: SweepResult = {
    scanned: 0,
    distilled: 0,
    filed: 0,
    skipped: { busy: 0, nothing: 0, noModel: false },
    wrote: [],
  };
  if (!config.enabled) return result;

  const state = await readState(key);
  const candidates = await findCandidates(config, state);
  result.scanned = candidates.length;

  for (const candidate of candidates) {
    if (result.distilled >= MAX_DISTILS_PER_SWEEP) break;

    /*
     * A ChatGPT export is one JSON document, not a growing log.
     *
     * The line-delta machinery below is for JSONL transcripts that grow by
     * appending records. A `conversations.json` is a single object, so reading
     * "the trailing 512KB" of it and JSON.parsing that fragment fails, yields
     * zero turns, and — worst of all — advanced the offset and archived the
     * file as "processed", silently destroying the user's entire history while
     * reporting success. Whole-document sources are read whole (to a sane
     * ceiling) and never offset-clamped.
     */
    const isWholeDoc = candidate.source === "inbox" && candidate.file.endsWith(".json");
    const MAX_WHOLE_DOC = 32 * 1024 * 1024;

    if (isWholeDoc && candidate.size > MAX_WHOLE_DOC) {
      // Too large to parse safely. Do NOT mark it processed — leave it in the
      // inbox and report it, rather than archive an unread file as done.
      result.skipped.nothing += 1;
      continue;
    }

    const handle = await fs.open(candidate.file, "r").catch(() => null);
    if (!handle) continue;
    let delta: string;
    let clamped = false;
    try {
      const from = isWholeDoc
        ? 0
        : (() => {
            const c = candidate.size - MAX_DELTA_BYTES;
            if (c > candidate.from) {
              clamped = true;
              return c;
            }
            return candidate.from;
          })();
      const length = candidate.size - from;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, from);
      delta = buffer.toString("utf8");
      /*
       * Only trim a genuinely torn first line.
       *
       * The stored offset is always a byte a previous sweep saw as end-of-file,
       * which is a line boundary — trimming there ate a whole valid record on
       * every sweep after the first. A trim is needed ONLY when the read was
       * clamped to the trailing window and therefore started mid-line.
       */
      if (clamped) delta = delta.slice(delta.indexOf("\n") + 1);
    } finally {
      await handle.close();
    }

    const turns =
      candidate.source === "claude-code"
        ? turnsFromClaudeCode(delta)
        : candidate.source === "codex"
          ? turnsFromCodex(delta)
          : candidate.file.endsWith(".json")
            ? turnsFromChatGPTExport(delta)
            : turnsFromText(delta);

    /*
     * A whole-document source that parsed to nothing is a PARSE FAILURE, not an
     * empty conversation — and it must not be archived as processed. Left in
     * the inbox, reported, retried next sweep.
     */
    if (isWholeDoc && !turns.length) {
      result.skipped.nothing += 1;
      continue;
    }

    const outcome = await distil(turns);
    if (outcome.state === "no-model") {
      result.skipped.noModel = true;
      break; // No model means no model for every remaining candidate too.
    }
    if (outcome.state === "busy") {
      result.skipped.busy += 1;
      break; // The gate will still be busy for the next candidate.
    }

    result.distilled += 1;

    if (outcome.state === "nothing") {
      result.skipped.nothing += 1;
      state[candidate.file] = { bytes: candidate.size, at: Date.now() };
      await writeState(key, state);
      if (candidate.source === "inbox") await archiveInboxFile(candidate.file);
      continue;
    }

    const day = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 16);
    const pagePath = `auto/${candidate.source}/${day}.md`;
    const body = [
      `## ${time} — ${candidate.label}`,
      "",
      ...outcome.bullets,
      "",
      `From ${turns.length} turns${candidate.session ? ` · session ${candidate.session}` : ""}.`,
      "",
    ].join("\n");

    const response = await fetch(`http://127.0.0.1:${port}/api/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: pagePath,
        content: body,
        mode: "append",
        agent: `Auto-wiki (${candidate.source === "claude-code" ? "Claude Code" : candidate.source === "codex" ? "Codex" : "inbox"})`,
        session: candidate.session,
      }),
    }).catch(() => null);

    if (response?.ok) {
      result.filed += 1;
      result.wrote.push(pagePath);
      state[candidate.file] = { bytes: candidate.size, at: Date.now() };
      await writeState(key, state);
      if (candidate.source === "inbox") await archiveInboxFile(candidate.file);
    }
    // A failed write leaves the state untouched, so the same delta is retried
    // next sweep rather than silently lost.
  }

  return result;
}

async function archiveInboxFile(file: string): Promise<void> {
  const done = path.join(INBOX_DIR, "done");
  await fs.mkdir(done, { recursive: true }).catch(() => {});
  await fs.rename(file, path.join(done, path.basename(file))).catch(() => {});
}

// ----------------------------------------------------------------- scheduler

/**
 * The in-process scheduler, started lazily like the vault watcher.
 *
 * Five minutes is deliberate: transcripts need their quiet period anyway, and
 * a listener that polls hard is a listener people can hear. State keeps sweeps
 * from re-reading old bytes, so an idle machine's sweep is a few dozen stats
 * and nothing else.
 */
const SWEEP_INTERVAL_MS = 5 * 60_000;
let scheduler: ReturnType<typeof setInterval> | null = null;
let lastSweep: { at: number; result: SweepResult } | null = null;
let sweeping = false;

export function lastSweepInfo(): { at: number; result: SweepResult } | null {
  return lastSweep;
}

export async function runSweep(root: string, port: number): Promise<SweepResult> {
  if (sweeping) return lastSweep?.result ?? { scanned: 0, distilled: 0, filed: 0, skipped: { busy: 0, nothing: 0, noModel: false }, wrote: [] };
  sweeping = true;
  try {
    const result = await sweep(root, port);
    lastSweep = { at: Date.now(), result };
    return result;
  } finally {
    sweeping = false;
  }
}

export async function ensureListener(root: string, port: number): Promise<void> {
  const config = await readListenConfig(root);
  if (!config.enabled) {
    if (scheduler) {
      clearInterval(scheduler);
      scheduler = null;
    }
    return;
  }
  if (scheduler) return;
  scheduler = setInterval(() => {
    void runSweep(root, port).catch(() => {});
  }, SWEEP_INTERVAL_MS);
  // Unref so a pending sweep never holds the process open on shutdown.
  scheduler.unref?.();
  void runSweep(root, port).catch(() => {});
}
