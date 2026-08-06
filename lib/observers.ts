import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Consent, as a file.
 *
 * Six of the seven new features watch something: your screen, your work, your
 * writing, your files, your conversations, your calendar. Every one of them is
 * the kind of thing a person is right to be suspicious of, and "it only runs
 * if you turn it on" is a promise made of words unless there is exactly one
 * place the answer lives and everything asks it first.
 *
 * This is that place, and it is deliberately the same shape as lib/safety.ts —
 * the read-only lock that came before it — for the same reason: a promise a
 * reviewer can verify in thirty lines is worth more than a promise spread
 * across six subsystems.
 *
 * The rules:
 *
 *   OFF BY DEFAULT, individually. There is no "enable observers" master switch
 *   that turns on six things at once. Consent to Ledger reading your Claude
 *   Code transcripts is not consent to Ghost photographing your screen.
 *
 *   PAUSE IS INSTANT AND GLOBAL. One switch stops all observation without
 *   forgetting which observers you had chosen, because the moment you need it
 *   — a screen share, a client's password on screen — is a moment you cannot
 *   spend un-ticking six boxes.
 *
 *   EVERY CHANGE IS LOGGED. Append-only, with the time and what changed, so
 *   "when did this start watching me" has an answer that is not a guess.
 *
 * Nothing here decides what an observer *does*. Each feature keeps its own
 * settings file; this file only answers "may it run at all", and answers it
 * the same way for all of them.
 */

export type ObserverId = "ghost" | "twin" | "understudy" | "oracle" | "ledger" | "prophet";

export const OBSERVER_IDS: ObserverId[] = [
  "ghost",
  "twin",
  "understudy",
  "oracle",
  "ledger",
  "prophet",
];

/** Shown wherever an observer has to explain itself in one line. */
export const OBSERVER_LABEL: Record<ObserverId, string> = {
  ghost: "Ghost",
  twin: "Twin",
  understudy: "Understudy",
  oracle: "Oracle",
  ledger: "Ledger",
  prophet: "Prophet",
};

/**
 * What each observer reads, in the plainest words available.
 *
 * This text is the consent. It is shown at the switch, not behind a link, and
 * it says the uncomfortable part out loud — "photographs your screen" rather
 * than "captures visual context" — because a person who is surprised later was
 * not informed, whatever the settings screen technically said.
 */
export const OBSERVER_READS: Record<ObserverId, string> = {
  ghost: "Takes a picture of your screen every few seconds and describes it with a local model.",
  twin: "Watches which files change and which apps you switch between.",
  understudy: "Reads writing you have already done, to learn how you write.",
  oracle: "Indexes the files, mail, messages, calendar and history you point it at.",
  ledger: "Reads the conversation logs your AI tools already keep on this Mac.",
  prophet: "Reads what the other observers found, and your calendar, to warn you early.",
};

export type ObserverState = {
  enabled: boolean;
  /** When consent was given. Null means it never has been. */
  enabledAt: number | null;
};

export type ObserversConfig = {
  observers: Record<ObserverId, ObserverState>;
  /**
   * Everything stops until this moment. Null is running.
   *
   * A timestamp rather than a boolean so "pause for an hour" cannot fail open
   * by outliving the process that set it — a restart re-reads the deadline and
   * stays paused, where a boolean plus a `setTimeout` resumes silently.
   */
  pausedUntil: number | null;
  /**
   * Local hours during which nothing observes, as [from, to) on a 24-hour
   * clock. Wraps midnight when `from > to`, which is the normal case.
   */
  quietHours: { from: number; to: number } | null;
  /**
   * May your agents read what the observers found, over MCP?
   *
   * A separate and much larger decision than switching an observer on, which is
   * why it is its own field with its own default. Enabling Ghost means a model
   * ON THIS MACHINE describes your screen. Enabling this means the contents of
   * your screen, your mail and your messages can be handed to whatever agent is
   * connected — which may be a frontier model on somebody else's hardware.
   *
   * Off, and the tools still appear in the agent's list so it can tell you they
   * exist, and refuse with a sentence saying which switch turns them on.
   */
  shareWithAgents: boolean;
};

const DIR = path.join(os.homedir(), ".lore");
const FILE = path.join(DIR, "observers.json");
const LOG = path.join(DIR, "observers-log.jsonl");

/** Nothing watches anything until a person says so. */
export const DEFAULT_OBSERVERS: ObserversConfig = {
  observers: Object.fromEntries(
    OBSERVER_IDS.map((id) => [id, { enabled: false, enabledAt: null }]),
  ) as Record<ObserverId, ObserverState>,
  pausedUntil: null,
  quietHours: null,
  shareWithAgents: false,
};

function normalise(parsed: Partial<ObserversConfig> | null): ObserversConfig {
  const observers = {} as Record<ObserverId, ObserverState>;
  for (const id of OBSERVER_IDS) {
    const entry = parsed?.observers?.[id];
    /* Explicit `=== true`, everywhere. A truthy check would let a hand-edited
       `"enabled": "no"` read as consent, and every failure in this file has to
       fall the same way: off. */
    observers[id] = {
      enabled: entry?.enabled === true,
      enabledAt: typeof entry?.enabledAt === "number" ? entry.enabledAt : null,
    };
  }
  const quiet = parsed?.quietHours;
  return {
    observers,
    pausedUntil:
      typeof parsed?.pausedUntil === "number" && parsed.pausedUntil > Date.now()
        ? parsed.pausedUntil
        : null,
    shareWithAgents: parsed?.shareWithAgents === true,
    quietHours:
      quiet &&
      Number.isInteger(quiet.from) &&
      Number.isInteger(quiet.to) &&
      quiet.from >= 0 &&
      quiet.from < 24 &&
      quiet.to >= 0 &&
      quiet.to < 24 &&
      quiet.from !== quiet.to
        ? { from: quiet.from, to: quiet.to }
        : null,
  };
}

export async function readObservers(): Promise<ObserversConfig> {
  const raw = await fs.readFile(FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_OBSERVERS;
  try {
    return normalise(JSON.parse(raw) as Partial<ObserversConfig>);
  } catch {
    /* A corrupt consent file means consent cannot be proven, which means it was
       not given. */
    return DEFAULT_OBSERVERS;
  }
}

/**
 * Synchronous read, for the daemon's tick.
 *
 * The tick runs every few seconds and its first question is always "am I
 * allowed to"; making that an await means every observer carries an async
 * preamble it can forget. The file is a few hundred bytes and lives in the
 * page cache.
 */
export function readObserversSync(): ObserversConfig {
  try {
    return normalise(JSON.parse(fsSync.readFileSync(FILE, "utf8")) as Partial<ObserversConfig>);
  } catch {
    return DEFAULT_OBSERVERS;
  }
}

async function writeObservers(config: ObserversConfig): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(FILE, JSON.stringify(config, null, 2) + "\n", "utf8", );
  await fs.chmod(FILE, 0o600).catch(() => {});
}

/** Append-only record of every consent change, so the history is not a guess. */
async function note(event: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    await fs.appendFile(LOG, JSON.stringify({ at: Date.now(), ...event }) + "\n", "utf8");
  } catch {
    /* An unwritable log must not block the user turning something off. */
  }
}

export async function setObserver(id: ObserverId, enabled: boolean): Promise<ObserversConfig> {
  const config = await readObservers();
  const before = config.observers[id].enabled;
  const next: ObserversConfig = {
    ...config,
    observers: {
      ...config.observers,
      [id]: { enabled, enabledAt: enabled ? (config.observers[id].enabledAt ?? Date.now()) : null },
    },
  };
  await writeObservers(next);
  if (before !== enabled) await note({ kind: enabled ? "enabled" : "disabled", observer: id });
  return next;
}

/** @param minutes 0 resumes immediately. */
export async function pauseAll(minutes: number): Promise<ObserversConfig> {
  const config = await readObservers();
  const until = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  const next = { ...config, pausedUntil: until };
  await writeObservers(next);
  await note({ kind: until ? "paused" : "resumed", minutes });
  return next;
}

export async function setShareWithAgents(enabled: boolean): Promise<ObserversConfig> {
  const config = await readObservers();
  const next = { ...config, shareWithAgents: enabled };
  await writeObservers(next);
  await note({ kind: enabled ? "sharing-enabled" : "sharing-disabled" });
  return next;
}

export async function setQuietHours(
  hours: { from: number; to: number } | null,
): Promise<ObserversConfig> {
  const config = await readObservers();
  const next = normalise({ ...config, quietHours: hours });
  await writeObservers(next);
  await note({ kind: "quiet-hours", hours });
  return next;
}

/**
 * Is now inside the quiet window?
 *
 * `from > to` is the ordinary case — 22:00 to 07:00 — and the naive
 * `hour >= from && hour < to` returns false for every hour of it. Both
 * directions are handled because getting this wrong means the observers run
 * all night having been told not to.
 */
export function inQuietHours(config: ObserversConfig, now = new Date()): boolean {
  const quiet = config.quietHours;
  if (!quiet) return false;
  const hour = now.getHours();
  return quiet.from < quiet.to
    ? hour >= quiet.from && hour < quiet.to
    : hour >= quiet.from || hour < quiet.to;
}

/**
 * The one question every observer asks before doing anything.
 *
 * Four conditions, all of which must hold, and every one of them fails closed.
 * Callers must not cache the result: a pause is worth having only if it takes
 * effect on the next tick rather than the next restart.
 */
export function mayObserve(id: ObserverId, config = readObserversSync()): boolean {
  /*
   * `!== true`, not `!`.
   *
   * `normalise` already coerces anything non-true to false on the way in from
   * disk, so in practice this is the same check twice. It is written twice
   * because this is the enforcement point and it accepts a config object from
   * any caller — including one that never went through `normalise`. A truthy
   * `"enabled": "yes"` reading as consent is the one bug in this file that
   * would not look like a bug from the outside.
   */
  if (config.observers[id]?.enabled !== true) return false;
  if (config.pausedUntil && config.pausedUntil > Date.now()) return false;
  if (inQuietHours(config)) return false;
  return true;
}

/** Why an observer is not running, in a sentence the UI can show as-is. */
export function whyNot(id: ObserverId, config: ObserversConfig): string | null {
  if (!config.observers[id]?.enabled) return `${OBSERVER_LABEL[id]} is off.`;
  if (config.pausedUntil && config.pausedUntil > Date.now()) {
    const minutes = Math.max(1, Math.round((config.pausedUntil - Date.now()) / 60_000));
    return `Everything is paused for another ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (inQuietHours(config)) {
    const { from, to } = config.quietHours!;
    return `Quiet hours: nothing is observed between ${String(from).padStart(2, "0")}:00 and ${String(to).padStart(2, "0")}:00.`;
  }
  return null;
}

export type ConsentEntry = { at: number; kind: string; observer?: string };

/** The consent log, newest first. Bounded because the UI shows a list. */
export async function readConsentLog(limit = 100): Promise<ConsentEntry[]> {
  const raw = await fs.readFile(LOG, "utf8").catch(() => "");
  if (!raw) return [];
  const out: ConsentEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ConsentEntry);
    } catch {
      /* One torn line costs one entry, not the log. */
    }
  }
  return out.reverse().slice(0, limit);
}
