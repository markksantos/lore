import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { openDb, dropDb, dbSize, ftsLadder, type Db } from "@/lib/signal-store";
import { detectOllama, describeImage, generate, pickVisionModel, recommendModel } from "@/lib/ollama";
import { scrub } from "@/lib/listen";
import { mayObserve } from "@/lib/observers";

const exec = promisify(execFile);

/**
 * Ghost — the thing that was watching.
 *
 * The pitch is "an AI that has actually been watching", and the distinction it
 * turns on is real: a search tool finds a file you remember saving, and Ghost
 * answers "what was that error twenty minutes ago" about a terminal you closed,
 * an app that keeps no history, and a Slack message you never had time to read.
 * Nothing else on the machine can answer that, because nothing else was looking.
 *
 * The implementation is three loops that never block each other:
 *
 *   CAPTURE, every fifteen seconds. `screencapture` writes a JPEG, `sips`
 *   shrinks it, and a perceptual hash decides whether anything actually
 *   changed. Cheap enough to run all day — measured at well under a per cent
 *   of one core — because it does no thinking at all.
 *
 *   DESCRIBE, as fast as the local model manages. A vision model reads each
 *   distinct frame and writes down what is happening and what the screen says.
 *   This is the expensive half, so it is a queue rather than a step: frames are
 *   never dropped for want of a model, they wait, and the pictures remain
 *   answerable in the meantime.
 *
 *   FORGET, hourly. Frames older than the retention window are deleted, image
 *   and row together.
 *
 * Everything about this is uncomfortable if it is not honest, so:
 *
 *  - It is off until switched on, and the switch says "takes a picture of your
 *    screen" rather than anything softer.
 *  - The pictures never leave the machine. The model is the Ollama on this
 *    host; there is no network path out of this file.
 *  - Password managers are skipped by name before the capture is taken, not
 *    filtered afterwards.
 *  - Extracted text runs through the same secret scrubber the transcript
 *    listener uses, so a key on screen does not become a key in an index.
 *  - Retention is a number of days with a default of seven, and "forget
 *    everything" deletes the database file.
 */

export type GhostConfig = {
  /** Seconds between captures. */
  everySeconds: number;
  /** Frames older than this are deleted, picture and record together. */
  keepDays: number;
  /** Run the vision model over captured frames. Off = pictures with no notes. */
  describe: boolean;
  /** Force a particular vision model; null picks the best installed. */
  model: string | null;
  /** Capture every display rather than only the main one. */
  allDisplays: boolean;
  /** Never capture while one of these applications is in front. */
  excludedApps: string[];
  /** Run extracted text through the secret scrubber before storing it. */
  redact: boolean;
  /**
   * Capture even when macOS will not say which app is in front.
   *
   * Off by default. On, the never-capture list cannot be honoured, which is
   * said in those words at the switch rather than implied.
   */
  captureWhenAppUnknown: boolean;
  /** Stop capturing when the frame store passes this size. */
  maxDiskMb: number;
};

/**
 * Skipped by name, before the shutter.
 *
 * Filtering after the fact would mean the password was on disk in a JPEG, and
 * the whole point of a default list is that it protects the person who never
 * opens the settings screen. These are the applications whose entire window is
 * a secret.
 */
const DEFAULT_EXCLUDED = [
  "1Password",
  "1Password 7",
  "Bitwarden",
  "Dashlane",
  "Keychain Access",
  "KeePassXC",
  "LastPass",
  "Passwords",
  "Proton Pass",
  "Enpass",
  "Secretive",
];

export const DEFAULT_GHOST: GhostConfig = {
  everySeconds: 15,
  keepDays: 7,
  describe: true,
  model: null,
  allDisplays: false,
  excludedApps: DEFAULT_EXCLUDED,
  redact: true,
  captureWhenAppUnknown: false,
  maxDiskMb: 8_192,
};

const HOME = os.homedir();
const GHOST_DIR = path.join(HOME, ".lore", "ghost");
const FRAMES_DIR = path.join(GHOST_DIR, "frames");
const CONFIG_FILE = path.join(GHOST_DIR, "config.json");

export async function readGhostConfig(): Promise<GhostConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_GHOST;
  try {
    const parsed = JSON.parse(raw) as Partial<GhostConfig>;
    return {
      /* Clamped, not trusted. A hand-edited `everySeconds: 0` is a fork bomb
         with a screenshot in it. */
      everySeconds: clamp(parsed.everySeconds, 5, 600, DEFAULT_GHOST.everySeconds),
      keepDays: clamp(parsed.keepDays, 1, 365, DEFAULT_GHOST.keepDays),
      describe: parsed.describe !== false,
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : null,
      allDisplays: parsed.allDisplays === true,
      excludedApps: Array.isArray(parsed.excludedApps)
        ? parsed.excludedApps.filter((a): a is string => typeof a === "string")
        : DEFAULT_EXCLUDED,
      redact: parsed.redact !== false,
      /* `=== true`, so a corrupt or partial config cannot turn the guard off. */
      captureWhenAppUnknown: parsed.captureWhenAppUnknown === true,
      maxDiskMb: clamp(parsed.maxDiskMb, 256, 200_000, DEFAULT_GHOST.maxDiskMb),
    };
  } catch {
    return DEFAULT_GHOST;
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function writeGhostConfig(config: GhostConfig): Promise<GhostConfig> {
  await fs.mkdir(GHOST_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

// --------------------------------------------------------------------- store

const MIGRATIONS = [
  `
  CREATE TABLE frames (
    id          INTEGER PRIMARY KEY,
    at          INTEGER NOT NULL,
    app         TEXT,
    title       TEXT,
    display     INTEGER NOT NULL DEFAULT 1,
    file        TEXT NOT NULL,
    bytes       INTEGER NOT NULL DEFAULT 0,
    phash       TEXT NOT NULL DEFAULT '',
    /* 0 waiting for the model, 1 described, 2 unchanged from the frame before,
       3 the model failed on it. Kept as an integer so the describe queue is an
       index scan rather than a string comparison per row. */
    state       INTEGER NOT NULL DEFAULT 0,
    summary     TEXT,
    body        TEXT,
    model       TEXT,
    describedAt INTEGER,
    error       TEXT
  );
  CREATE INDEX frames_at ON frames(at DESC);
  CREATE INDEX frames_queue ON frames(state, at);
  CREATE VIRTUAL TABLE frames_fts USING fts5(
    summary, body, app, title, tokenize = 'porter unicode61'
  );
  CREATE TABLE digests (
    day     TEXT PRIMARY KEY,
    at      INTEGER NOT NULL,
    summary TEXT NOT NULL,
    frames  INTEGER NOT NULL DEFAULT 0,
    model   TEXT
  );
  `,
];

export function ghostDb(): Db {
  return openDb("ghost", MIGRATIONS);
}

export type Frame = {
  id: number;
  at: number;
  app: string | null;
  title: string | null;
  display: number;
  file: string;
  bytes: number;
  phash: string;
  state: number;
  summary: string | null;
  body: string | null;
  model: string | null;
  describedAt: number | null;
  error: string | null;
};

// ------------------------------------------------------------------ capture

/**
 * Which application is in front, and what its window is called.
 *
 * This is the single most useful piece of metadata Ghost collects and the
 * cheapest: "Slack — #client-project" tells you more about what you were doing
 * at 14:32 than a paragraph of model prose, it costs about eighty
 * milliseconds, and it keeps working when no vision model is installed at all.
 *
 * Returns nulls rather than throwing when macOS has not granted Automation
 * permission. A frame with no app name is worth keeping; a capture loop that
 * dies because of a permission dialog is not.
 */
export async function frontmostApp(): Promise<{ app: string | null; title: string | null }> {
  if (process.platform !== "darwin") return { app: null, title: null };
  const script = `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      set appName to name of frontApp
      set winName to ""
      try
        set winName to name of front window of frontApp
      end try
    end tell
    return appName & "\\n" & winName
  `;
  try {
    const { stdout } = await exec("/usr/bin/osascript", ["-e", script], { timeout: 5_000 });
    const [app, ...rest] = stdout.split("\n");
    const title = rest.join("\n").trim();
    return { app: app.trim() || null, title: title || null };
  } catch {
    return { app: null, title: null };
  }
}

/**
 * A 64-bit average hash of the frame.
 *
 * The point is not similarity search, it is arithmetic: a screen that has not
 * changed is the overwhelmingly common case, and describing the same picture
 * two hundred times a day would spend the machine's whole evening on it. At one
 * frame every fifteen seconds a working day is 2,880 captures; on a real day
 * fewer than one in eight is a genuinely new scene.
 *
 * `sips` renders a 16×16 uncompressed BMP, which is a decoder Lore does not
 * have to ship and a format simple enough to read in twenty lines. Average hash
 * rather than dHash because the thing being detected here is "the whole screen
 * is the same picture", where the two perform identically and aHash is easier
 * to be sure is correct.
 */
export async function perceptualHash(imagePath: string): Promise<string> {
  const tiny = `${imagePath}.tiny.bmp`;
  try {
    await exec("/usr/bin/sips", ["-s", "format", "bmp", "-z", "16", "16", imagePath, "--out", tiny], {
      timeout: 15_000,
    });
    const buffer = await fs.readFile(tiny);
    return hashBmp(buffer);
  } catch {
    /* No hash means "assume it changed", which costs one extra description and
       never loses a frame. The alternative — treating a failure as a duplicate
       — would silently stop describing anything. */
    return "";
  } finally {
    await fs.rm(tiny, { force: true }).catch(() => {});
  }
}

/** 24-bit uncompressed BMP → 64-bit average hash, as hex. */
export function hashBmp(buffer: Buffer): string {
  if (buffer.length < 54 || buffer.toString("ascii", 0, 2) !== "BM") return "";
  const offset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bpp = buffer.readUInt16LE(28);
  if (bpp !== 24 || width <= 0) return "";
  /* A negative height means the rows are stored top-down, which is what sips
     writes. Reading it as unsigned would produce a height of four billion. */
  const height = Math.abs(rawHeight);
  const bytesPerPixel = 3;
  /* BMP rows are padded to a four-byte boundary. At 16px wide this is a no-op,
     but a future size change should not silently shear the image. */
  const stride = Math.floor((width * bytesPerPixel + 3) / 4) * 4;
  if (offset + stride * height > buffer.length) return "";

  const luma: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = offset + y * stride;
    for (let x = 0; x < width; x++) {
      const p = row + x * bytesPerPixel;
      /* BMP is BGR. */
      luma.push(0.114 * buffer[p] + 0.587 * buffer[p + 1] + 0.299 * buffer[p + 2]);
    }
  }
  if (!luma.length) return "";

  /* 64 buckets regardless of the source size, so the hash is comparable across
     any future change to the thumbnail dimensions. */
  const side = 8;
  const cells: number[] = [];
  for (let by = 0; by < side; by++) {
    for (let bx = 0; bx < side; bx++) {
      let sum = 0;
      let n = 0;
      const y0 = Math.floor((by * height) / side);
      const y1 = Math.max(y0 + 1, Math.floor(((by + 1) * height) / side));
      const x0 = Math.floor((bx * width) / side);
      const x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * width) / side));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += luma[y * width + x];
          n++;
        }
      }
      cells.push(n ? sum / n : 0);
    }
  }

  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) if (cells[i + b] > mean) nibble |= 1 << (3 - b);
    hex += nibble.toString(16);
  }
  return hex;
}

/** Differing bits between two hashes; 64 when either is missing. */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

/**
 * Below this two frames are the same scene.
 *
 * Five of sixty-four bits. Chosen so a moving cursor, a blinking caret, a
 * clock ticking over and a line of new terminal output all read as "the same
 * screen", while switching tab, window or application does not. Set it lower
 * and the model describes the clock; higher and a real change is missed.
 */
const SAME_SCENE_BITS = 5;

export type CaptureOutcome =
  | { kind: "captured"; frame: Frame; changed: boolean }
  | { kind: "skipped"; reason: string };

/**
 * Take one frame.
 *
 * The order matters and is the privacy design: ask what is in front FIRST, and
 * if it is excluded, return without ever invoking the shutter. There is no
 * moment at which a 1Password window exists as a file on disk.
 */
export async function captureFrame(config?: GhostConfig): Promise<CaptureOutcome> {
  const settings = config ?? (await readGhostConfig());
  if (process.platform !== "darwin") {
    return { kind: "skipped", reason: "Screen capture is macOS-only in this build." };
  }

  const { app, title } = await frontmostApp();

  /*
   * Not knowing which app is in front is a reason NOT to photograph it.
   *
   * `frontmostApp` returns null when macOS has not granted Automation
   * permission — which is a different permission from screen recording, and is
   * routinely absent while screen recording is granted. The first version of
   * this check read `if (app && excluded.includes(app))`, so on exactly that
   * machine the never-capture list did nothing at all and 1Password's vault
   * window was written to disk. A guard that fails open is not a guard.
   *
   * Three reviewers found this independently, which is what a privacy-critical
   * branch with an implicit null case looks like from the outside.
   *
   * Failing closed costs Ghost entirely on a Mac without Automation permission,
   * so it is a setting rather than a rule — and the default is the safe one.
   */
  if (!app) {
    if (settings.excludedApps.length && !settings.captureWhenAppUnknown) {
      return {
        kind: "skipped",
        reason:
          "macOS will not say which app is in front, so Ghost cannot honour the never-capture list. Grant Automation permission, or allow capture anyway in Ghost's settings.",
      };
    }
  } else if (settings.excludedApps.some((name) => name.toLowerCase() === app.toLowerCase())) {
    return { kind: "skipped", reason: `${app} is on the never-capture list.` };
  }

  const used = await dbSize("ghost");
  const frameBytes = await dirSize(FRAMES_DIR);
  if ((used + frameBytes) / 1_048_576 > settings.maxDiskMb) {
    return { kind: "skipped", reason: "Ghost has reached its disk limit." };
  }

  const now = Date.now();
  const day = dayKey(now);
  const dir = path.join(FRAMES_DIR, day);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const rel = path.join(day, `${now}.jpg`);
  const full = path.join(FRAMES_DIR, rel);

  /*
   * `-x` silences the shutter, `-o` drops window shadows (pure pixels, smaller
   * files), `-t jpg` because a PNG of a screen is four times the size for
   * detail a model cannot use. `-D 1` is the main display; without it macOS
   * writes one file per screen and appends a suffix to the name we chose,
   * which is how a three-monitor setup produced zero readable frames.
   */
  const args = ["-x", "-o", "-t", "jpg"];
  if (!settings.allDisplays) args.push("-D", "1");
  args.push(full);

  try {
    await exec("/usr/sbin/screencapture", args, { timeout: 20_000 });
  } catch (error) {
    return {
      kind: "skipped",
      reason: error instanceof Error ? error.message : "screencapture failed.",
    };
  }

  const stat = await fs.stat(full).catch(() => null);
  if (!stat || stat.size === 0) {
    await fs.rm(full, { force: true }).catch(() => {});
    return {
      kind: "skipped",
      reason:
        "macOS produced no image. This is what a missing screen-recording permission looks like.",
    };
  }

  /* Shrunk in place. 1440px is comfortably more than any vision model reads
     and roughly a tenth of a Retina screenshot on disk. */
  await exec("/usr/bin/sips", ["-Z", "1440", full], { timeout: 20_000 }).catch(() => {});
  const shrunk = await fs.stat(full).catch(() => stat);

  const phash = await perceptualHash(full);
  const db = ghostDb();
  const previous = db.get<{ phash: string }>(
    "SELECT phash FROM frames ORDER BY at DESC LIMIT 1",
  );
  const changed = !previous || hammingDistance(previous.phash, phash) > SAME_SCENE_BITS;

  const { lastInsertRowid } = db.run(
    `INSERT INTO frames (at, app, title, display, file, bytes, phash, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    now,
    app,
    title,
    1,
    rel,
    shrunk.size,
    phash,
    /* An unchanged screen is stored but never described — the picture is still
       the answer to "what was on screen at 14:32", it just does not need the
       model to say the same paragraph again. */
    changed ? 0 : 2,
  );

  /* Window titles are searchable immediately, before any model has run. This is
     what makes Ghost useful on a machine with no vision model at all. */
  db.run(
    "INSERT INTO frames_fts (rowid, summary, body, app, title) VALUES (?, '', '', ?, ?)",
    lastInsertRowid,
    app ?? "",
    title ?? "",
  );

  const frame = db.get<Frame>("SELECT * FROM frames WHERE id = ?", lastInsertRowid)!;
  return { kind: "captured", frame, changed };
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else {
      const stat = await fs.stat(full).catch(() => null);
      if (stat) total += stat.size;
    }
  }
  return total;
}

export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ----------------------------------------------------------------- describe

const DESCRIBE_SYSTEM = `You are looking at a screenshot of someone's computer. Write down what is happening, for them to search later.

Reply in exactly two parts:
WHAT: one sentence naming the application and the task in progress.
TEXT: the text visible on screen, verbatim — error messages, names, numbers, subject lines, code identifiers. No commentary. Omit chrome, menus and window furniture.

If the screen is empty or unreadable, write WHAT: idle, and leave TEXT blank.`;

/** Split the model's two-part reply, tolerating a model that drifts. */
export function splitDescription(raw: string): { summary: string; body: string } {
  const text = raw.trim();
  const whatMatch = text.match(/WHAT:\s*([\s\S]*?)(?=\n\s*TEXT:|$)/i);
  const textMatch = text.match(/TEXT:\s*([\s\S]*)$/i);
  if (!whatMatch && !textMatch) {
    /* No labels at all: take the first line as the summary and the rest as the
       body, which is the shape a drifting model produces anyway. */
    const [first, ...rest] = text.split("\n");
    return { summary: first.trim().slice(0, 400), body: rest.join("\n").trim() };
  }
  return {
    summary: (whatMatch?.[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 400),
    body: (textMatch?.[1] ?? "").trim(),
  };
}

/** The vision model Ghost should use, honouring an explicit override. */
export async function ghostModel(config: GhostConfig): Promise<string | null> {
  const detection = await detectOllama().catch(() => null);
  if (!detection?.running) return null;
  if (config.model && detection.models.some((m) => m.name === config.model)) return config.model;
  return pickVisionModel(detection.models);
}

/**
 * Describe the oldest waiting frames.
 *
 * A batch rather than one, because the model is loaded either way and the
 * second frame costs a fraction of the first. A small batch rather than all of
 * them, because this runs on a timer and a pass that takes ten minutes is a
 * pass that cannot be cancelled when the user pauses.
 */
export async function describePending(limit = 4): Promise<{ described: number; failed: number }> {
  const config = await readGhostConfig();
  if (!config.describe) return { described: 0, failed: 0 };
  const model = await ghostModel(config);
  if (!model) return { described: 0, failed: 0 };

  const db = ghostDb();
  const pending = db.all<Frame>(
    "SELECT * FROM frames WHERE state = 0 ORDER BY at ASC LIMIT ?",
    limit,
  );
  let described = 0;
  let failed = 0;

  for (const frame of pending) {
    /* Re-asked inside the loop: a batch of four can span a minute, and a user
       who hits pause should not have three more frames read afterwards. */
    if (!mayObserve("ghost")) break;
    const file = path.join(FRAMES_DIR, frame.file);
    const image = await fs.readFile(file).catch(() => null);
    if (!image) {
      /* The picture was deleted by retention while it sat in the queue. Marking
         it failed keeps it out of the queue forever, which is correct: there is
         nothing left to describe. */
      db.run("UPDATE frames SET state = 3, error = ? WHERE id = ?", "Frame file is gone.", frame.id);
      failed++;
      continue;
    }
    try {
      const raw = await describeImage(model, image.toString("base64"), "Describe this screen.", {
        system: DESCRIBE_SYSTEM,
        timeoutMs: 120_000,
        maxTokens: 500,
      });
      const { summary, body } = splitDescription(raw);
      /* The same scrubber the transcript listener uses. A password on screen
         becomes a redaction in the index rather than a searchable secret. */
      const safeSummary = config.redact ? scrub(summary) : summary;
      const safeBody = config.redact ? scrub(body) : body;
      db.tx(() => {
        db.run(
          "UPDATE frames SET state = 1, summary = ?, body = ?, model = ?, describedAt = ?, error = NULL WHERE id = ?",
          safeSummary,
          safeBody,
          model,
          Date.now(),
          frame.id,
        );
        db.run(
          "UPDATE frames_fts SET summary = ?, body = ? WHERE rowid = ?",
          safeSummary,
          safeBody,
          frame.id,
        );
      });
      described++;
    } catch (error) {
      db.run(
        "UPDATE frames SET state = 3, error = ? WHERE id = ?",
        error instanceof Error ? error.message.slice(0, 300) : "Description failed.",
        frame.id,
      );
      failed++;
    }
  }

  return { described, failed };
}

// ----------------------------------------------------------------- retention

/** Delete everything past the retention window, pictures and rows together. */
export async function forgetOldFrames(config?: GhostConfig): Promise<number> {
  const settings = config ?? (await readGhostConfig());
  const cutoff = Date.now() - settings.keepDays * 86_400_000;
  const db = ghostDb();
  const doomed = db.all<{ id: number; file: string }>(
    "SELECT id, file FROM frames WHERE at < ?",
    cutoff,
  );
  for (const frame of doomed) {
    await fs.rm(path.join(FRAMES_DIR, frame.file), { force: true }).catch(() => {});
  }
  db.tx(() => {
    db.run("DELETE FROM frames_fts WHERE rowid IN (SELECT id FROM frames WHERE at < ?)", cutoff);
    db.run("DELETE FROM frames WHERE at < ?", cutoff);
  });
  db.run("DELETE FROM digests WHERE at < ?", cutoff);

  /* Empty day folders left behind by the file deletions above. Harmless, but a
     `frames/` directory with sixty empty dated folders in it looks like a bug
     to anyone who goes looking. */
  const days = await fs.readdir(FRAMES_DIR).catch(() => []);
  for (const day of days) {
    const dir = path.join(FRAMES_DIR, day);
    const rest = await fs.readdir(dir).catch(() => null);
    if (rest && rest.length === 0) await fs.rmdir(dir).catch(() => {});
  }
  return doomed.length;
}

/** The button that means it. Deletes the index and every picture. */
export async function forgetEverything(): Promise<void> {
  await dropDb("ghost");
  await fs.rm(FRAMES_DIR, { recursive: true, force: true });
}

/** Delete a single frame — the "not that one" escape hatch. */
export async function forgetFrame(id: number): Promise<boolean> {
  const db = ghostDb();
  const frame = db.get<{ file: string }>("SELECT file FROM frames WHERE id = ?", id);
  if (!frame) return false;
  await fs.rm(path.join(FRAMES_DIR, frame.file), { force: true }).catch(() => {});
  db.tx(() => {
    db.run("DELETE FROM frames_fts WHERE rowid = ?", id);
    db.run("DELETE FROM frames WHERE id = ?", id);
  });
  return true;
}

/** Delete everything captured in a window — "forget the last hour". */
export async function forgetRange(from: number, to: number): Promise<number> {
  const db = ghostDb();
  const doomed = db.all<{ id: number; file: string }>(
    "SELECT id, file FROM frames WHERE at >= ? AND at <= ?",
    from,
    to,
  );
  for (const frame of doomed) {
    await fs.rm(path.join(FRAMES_DIR, frame.file), { force: true }).catch(() => {});
  }
  db.tx(() => {
    db.run(
      "DELETE FROM frames_fts WHERE rowid IN (SELECT id FROM frames WHERE at >= ? AND at <= ?)",
      from,
      to,
    );
    db.run("DELETE FROM frames WHERE at >= ? AND at <= ?", from, to);
  });
  return doomed.length;
}

/** Absolute path of a stored frame, guarded against a traversing `file` value. */
export function framePath(rel: string): string | null {
  const resolved = path.resolve(FRAMES_DIR, rel);
  const base = path.resolve(FRAMES_DIR);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

// -------------------------------------------------------------------- recall

/**
 * "Twenty minutes ago", as a pair of timestamps.
 *
 * The whole feature turns on this working. A question about a specific moment
 * that searches the entire week returns the wrong afternoon, and a person who
 * gets the wrong afternoon once stops asking. Parsed here rather than by the
 * model because a model asked to output a timestamp will cheerfully output a
 * plausible one.
 *
 * Returns null when the question names no time at all, which means "search
 * everything" rather than "search now".
 */
export function parseWhen(question: string, now = Date.now()): { from: number; to: number } | null {
  const text = question.toLowerCase();
  const startOfDay = (offsetDays: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - offsetDays);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  const ago = text.match(/(\d+)\s*(second|sec|minute|min|hour|hr|day)s?\s+ago/);
  if (ago) {
    const amount = Number(ago[1]);
    const unit = ago[2];
    const ms =
      unit.startsWith("sec") ? 1_000
      : unit.startsWith("min") ? 60_000
      : unit.startsWith("h") ? 3_600_000
      : 86_400_000;
    const centre = now - amount * ms;
    /* A window around the moment, not a point. "Twenty minutes ago" means
       roughly then, and a frame every fifteen seconds means the exact second is
       usually empty. The window widens with the distance, because memory of
       when something happened gets vaguer the further back it was. */
    const slack = Math.max(5 * 60_000, amount * ms * 0.35);
    return { from: centre - slack, to: Math.min(now, centre + slack) };
  }

  const lastN = text.match(/(?:last|past|previous)\s+(\d+)?\s*(minute|min|hour|hr|day|week)s?/);
  if (lastN) {
    const amount = Number(lastN[1] ?? 1);
    const unit = lastN[2];
    const ms =
      unit.startsWith("min") ? 60_000
      : unit.startsWith("h") ? 3_600_000
      : unit.startsWith("d") ? 86_400_000
      : 604_800_000;
    return { from: now - amount * ms, to: now };
  }

  if (/\byesterday\b/.test(text)) return { from: startOfDay(1), to: startOfDay(0) };
  if (/\bthis morning\b/.test(text)) {
    const from = startOfDay(0) + 5 * 3_600_000;
    return { from, to: Math.min(now, startOfDay(0) + 12 * 3_600_000) };
  }
  if (/\bthis afternoon\b/.test(text)) {
    return { from: startOfDay(0) + 12 * 3_600_000, to: Math.min(now, startOfDay(0) + 18 * 3_600_000) };
  }
  if (/\b(this evening|tonight)\b/.test(text)) {
    return { from: startOfDay(0) + 17 * 3_600_000, to: now };
  }
  if (/\b(today|so far today|did today)\b/.test(text)) return { from: startOfDay(0), to: now };
  if (/\bthis week\b/.test(text)) return { from: now - 7 * 86_400_000, to: now };
  if (/\bjust now\b|\ba (?:moment|minute|second) ago\b/.test(text)) {
    return { from: now - 10 * 60_000, to: now };
  }
  return null;
}

export type GhostHit = {
  id: number;
  at: number;
  app: string | null;
  title: string | null;
  summary: string | null;
  body: string | null;
  file: string;
  score: number;
};

/**
 * Find the frames that answer a question.
 *
 * Two passes, deliberately. The time window is a filter, not a ranking signal:
 * if the asker said "twenty minutes ago" then a perfect text match from Tuesday
 * is the wrong answer, however well it scores. Within the window, text decides
 * the order; when the text finds nothing at all, the window itself is the
 * answer, because "show me what was on screen then" is a legitimate question
 * with no keywords in it.
 */
export function searchFrames(
  question: string,
  window: { from: number; to: number } | null,
  limit = 12,
): GhostHit[] {
  const db = ghostDb();
  const timeClause = window ? "AND f.at BETWEEN ? AND ?" : "";
  const timeParams: number[] = window ? [window.from, window.to] : [];

  for (const match of ftsLadder(question)) {
    const rows = db.all<GhostHit>(
      `SELECT f.id, f.at, f.app, f.title, f.summary, f.body, f.file, -bm25(frames_fts) AS score
         FROM frames_fts
         JOIN frames f ON f.id = frames_fts.rowid
        WHERE frames_fts MATCH ? ${timeClause}
        ORDER BY score DESC
        LIMIT ?`,
      match,
      ...timeParams,
      limit,
    );
    if (rows.length) return rows;
  }

  if (window) {
    /* Nothing matched the words, but the moment was named. Spread the frames
       evenly across the window rather than returning the first N, so a
       ninety-minute window does not answer with its first ninety seconds. */
    const all = db.all<GhostHit>(
      `SELECT id, at, app, title, summary, body, file, 0 AS score
         FROM frames WHERE at BETWEEN ? AND ? ORDER BY at ASC`,
      window.from,
      window.to,
    );
    if (all.length <= limit) return all;
    const step = all.length / limit;
    return Array.from({ length: limit }, (_, i) => all[Math.floor(i * step)]);
  }

  return [];
}

const RECALL_SYSTEM = `You are answering a question about what the user was doing on their own computer, using notes taken from screenshots.

Rules:
- Use only the notes. Never guess at what an application "probably" showed.
- Say the time. "At 14:32 you were…" is the answer; "you were working on X" is not.
- Cite the note numbers you used, like [2].
- If the notes do not contain the answer, say what they DO show for that period.
- Three sentences at most.`;

export type RecallResult = {
  question: string;
  window: { from: number; to: number } | null;
  answer: string | null;
  needsModel: boolean;
  frames: GhostHit[];
  /** Frames matched but not yet read by the vision model. */
  pending: number;
};

/** Answer a question about the past, from the notes and nothing else. */
export async function recall(question: string, now = Date.now()): Promise<RecallResult> {
  const window = parseWhen(question, now);
  const frames = searchFrames(question, window, 14);
  const pending = frames.filter((f) => !f.summary && !f.body).length;

  if (!frames.length) {
    return { question, window, answer: null, needsModel: false, frames: [], pending: 0 };
  }

  const detection = await detectOllama().catch(() => null);
  const model = detection?.running ? recommendModel(detection.models) : null;
  if (!model) {
    return { question, window, answer: null, needsModel: true, frames, pending };
  }

  const notes = frames
    .map((frame, i) => {
      const when = new Date(frame.at).toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      const where = [frame.app, frame.title].filter(Boolean).join(" — ") || "unknown app";
      const said = [frame.summary, frame.body].filter(Boolean).join("\n").slice(0, 1_200);
      return `[${i + 1}] ${when} · ${where}\n${said || "(not yet read by the model)"}`;
    })
    .join("\n\n");

  const answer = await generate(
    model,
    `Question: ${question}\n\nNotes from screenshots:\n\n${notes}\n\nAnswer:`,
    { system: RECALL_SYSTEM, timeoutMs: 90_000, maxTokens: 400 },
  ).catch(() => "");

  return { question, window, answer: answer.trim() || null, needsModel: false, frames, pending };
}

const DIGEST_SYSTEM = `You are writing a short account of one person's working day, from notes taken off their screen.

Rules:
- Group by what they were doing, not by the clock. Four to seven bullets.
- Each bullet: what the work was, and roughly when. Name applications, projects, files and people that appear in the notes.
- Only what the notes say. No filler, no "productive day", no advice.
- Bullets only. No preamble, no closing line.`;

/** "Summarise what I did today", computed once and kept. */
export async function dayDigest(
  day: string,
  force = false,
): Promise<{ day: string; summary: string | null; frames: number; needsModel: boolean }> {
  const db = ghostDb();
  const existing = db.get<{ summary: string; frames: number }>(
    "SELECT summary, frames FROM digests WHERE day = ?",
    day,
  );

  const start = new Date(`${day}T00:00:00`).getTime();
  const end = start + 86_400_000;
  const frames = db.all<Frame>(
    `SELECT * FROM frames WHERE at >= ? AND at < ? AND (summary IS NOT NULL OR title IS NOT NULL)
      ORDER BY at ASC`,
    start,
    end,
  );

  /* Regenerate when new frames have been described since the digest was
     written; a day summarised at noon is wrong by six o'clock. */
  if (existing && !force && existing.frames === frames.length) {
    return { day, summary: existing.summary, frames: frames.length, needsModel: false };
  }
  if (!frames.length) return { day, summary: null, frames: 0, needsModel: false };

  const detection = await detectOllama().catch(() => null);
  const model = detection?.running ? recommendModel(detection.models) : null;
  if (!model) return { day, summary: null, frames: frames.length, needsModel: true };

  /*
   * Collapse runs before summarising.
   *
   * A day is up to 2,880 frames and most of them are the same app for twenty
   * minutes. Sending all of them would blow any context window and drown the
   * three interesting minutes; collapsing consecutive frames of the same
   * application into one line with a duration is both smaller and a better
   * description of the day.
   */
  const runs: { app: string; from: number; to: number; notes: string[] }[] = [];
  for (const frame of frames) {
    const app = frame.app ?? "Unknown";
    const last = runs[runs.length - 1];
    if (last && last.app === app && frame.at - last.to < 10 * 60_000) {
      last.to = frame.at;
      if (frame.summary && last.notes.length < 6) last.notes.push(frame.summary);
    } else {
      runs.push({ app, from: frame.at, to: frame.at, notes: frame.summary ? [frame.summary] : [] });
    }
  }

  const timeline = runs
    .filter((run) => run.to - run.from > 60_000 || run.notes.length)
    .map((run) => {
      const from = new Date(run.from).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      const minutes = Math.max(1, Math.round((run.to - run.from) / 60_000));
      return `${from} · ${run.app} · ${minutes}m\n${run.notes.join("\n")}`;
    })
    .join("\n\n")
    .slice(0, 24_000);

  const summary = await generate(model, `Notes from ${day}:\n\n${timeline}\n\nThe day:`, {
    system: DIGEST_SYSTEM,
    timeoutMs: 180_000,
    maxTokens: 800,
  }).catch(() => "");

  if (summary.trim()) {
    db.run(
      `INSERT INTO digests (day, at, summary, frames, model) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET at = excluded.at, summary = excluded.summary,
         frames = excluded.frames, model = excluded.model`,
      day,
      Date.now(),
      summary.trim(),
      frames.length,
      model,
    );
  }

  return { day, summary: summary.trim() || null, frames: frames.length, needsModel: false };
}

// -------------------------------------------------------------------- status

export type GhostStatus = {
  frames: number;
  described: number;
  pending: number;
  failed: number;
  unchanged: number;
  oldest: number | null;
  newest: number | null;
  diskBytes: number;
  days: { day: string; frames: number }[];
  topApps: { app: string; frames: number }[];
};

export async function ghostStatus(): Promise<GhostStatus> {
  const db = ghostDb();
  const counts = db.get<{
    frames: number;
    described: number;
    pending: number;
    failed: number;
    unchanged: number;
    oldest: number | null;
    newest: number | null;
  }>(
    `SELECT COUNT(*) AS frames,
            SUM(state = 1) AS described,
            SUM(state = 0) AS pending,
            SUM(state = 3) AS failed,
            SUM(state = 2) AS unchanged,
            MIN(at) AS oldest,
            MAX(at) AS newest
       FROM frames`,
  );
  const days = db.all<{ day: string; frames: number }>(
    `SELECT substr(file, 1, 10) AS day, COUNT(*) AS frames
       FROM frames GROUP BY day ORDER BY day DESC LIMIT 30`,
  );
  const topApps = db.all<{ app: string; frames: number }>(
    `SELECT COALESCE(app, 'Unknown') AS app, COUNT(*) AS frames
       FROM frames WHERE at > ? GROUP BY app ORDER BY frames DESC LIMIT 8`,
    Date.now() - 7 * 86_400_000,
  );
  return {
    frames: counts?.frames ?? 0,
    described: counts?.described ?? 0,
    pending: counts?.pending ?? 0,
    failed: counts?.failed ?? 0,
    unchanged: counts?.unchanged ?? 0,
    oldest: counts?.oldest ?? null,
    newest: counts?.newest ?? null,
    diskBytes: (await dbSize("ghost")) + (await dirSize(FRAMES_DIR)),
    days,
    topApps,
  };
}

/** The frames around a moment, for scrubbing through the day. */
export function framesAround(at: number, span = 30 * 60_000, limit = 60): Frame[] {
  const db = ghostDb();
  return db.all<Frame>(
    "SELECT * FROM frames WHERE at BETWEEN ? AND ? ORDER BY at ASC LIMIT ?",
    at - span,
    at + span,
    limit,
  );
}
