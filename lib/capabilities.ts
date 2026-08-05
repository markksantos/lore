import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { detectOllama, pickVisionModel } from "@/lib/ollama";
import { sqliteAvailable } from "@/lib/signal-store";
import { isSiteMode } from "@/lib/mode";

/**
 * What this machine can actually do.
 *
 * Seven features arrived at once and not one of them works everywhere. Ghost
 * needs a screen it is allowed to photograph. Oracle needs Full Disk Access to
 * read Messages. Chorus needs an API key or three. The desktop build has global
 * hotkeys the browser cannot have, and the deployed marketing site has none of
 * it because it has no filesystem at all.
 *
 * The failure mode this file exists to prevent is a feature that looks
 * available, is clicked, and fails — because the UI assumed a capability it
 * never checked. Every one of these is probed rather than inferred, and every
 * probe answers with a reason a person can act on: not "unavailable" but
 * "macOS has not granted Full Disk Access to the app running Lore", with the
 * settings pane one click away.
 *
 * Probes are cached briefly. They shell out and read the network, and the
 * settings screen asks for all of them at once.
 */

const exec = promisify(execFile);

export type CapabilityState = "ready" | "missing" | "denied" | "unsupported";

export type Capability = {
  state: CapabilityState;
  /** One sentence, shown as-is. Empty when ready and nothing needs saying. */
  detail: string;
  /** macOS System Settings pane to open, when the user can grant this. */
  settingsPane?: string;
};

export type Capabilities = {
  platform: NodeJS.Platform;
  /** Running inside the packaged desktop shell rather than a browser tab. */
  desktop: boolean;
  /** The public marketing deployment, which has no machine to observe. */
  siteMode: boolean;
  /** Local index storage. Everything except Chorus needs this. */
  storage: Capability;
  /** Can Lore take a picture of the screen at all? */
  screenCapture: Capability;
  /** Can Lore see which app is in front? */
  windowTitles: Capability;
  /** Can Lore read Messages, Mail and Safari history? */
  fullDiskAccess: Capability;
  /** A local model that can look at an image. */
  vision: Capability & { model: string | null };
  /** A local model that can write. */
  localModel: Capability & { model: string | null };
  /** Frontier models, for Chorus. Names only — never a key, never a prefix. */
  cloudModels: Capability & { providers: string[] };
  /** Global hotkeys, tray, native notifications. */
  nativeShell: Capability;
};

const ready = (detail = ""): Capability => ({ state: "ready", detail });
const missing = (detail: string, settingsPane?: string): Capability => ({
  state: "missing",
  detail,
  settingsPane,
});
const denied = (detail: string, settingsPane?: string): Capability => ({
  state: "denied",
  detail,
  settingsPane,
});
const unsupported = (detail: string): Capability => ({ state: "unsupported", detail });

/**
 * What the Electron shell knows and the server cannot.
 *
 * Screen-recording permission is answerable only through
 * `systemPreferences.getMediaAccessStatus`, which exists in the main process.
 * The Next server runs as a child process, so rather than build an IPC channel
 * across two process boundaries for one string, the shell writes what it knows
 * to a file at boot and this reads it. Absent file means "not the desktop
 * app", which is exactly what a browser should conclude.
 */
export type DesktopFacts = {
  version: string;
  platform: NodeJS.Platform;
  screenAccess: "granted" | "denied" | "restricted" | "not-determined" | "unknown";
  accessibility: boolean;
  writtenAt: number;
};

const DESKTOP_FACTS = path.join(os.homedir(), ".lore", "desktop.json");

export async function readDesktopFacts(): Promise<DesktopFacts | null> {
  const raw = await fs.readFile(DESKTOP_FACTS, "utf8").catch(() => "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopFacts>;
    if (typeof parsed.writtenAt !== "number") return null;
    /*
     * Stale facts are worse than none.
     *
     * The file outlives the app that wrote it, so a desktop launch three weeks
     * ago would otherwise convince a browser session today that it has global
     * hotkeys. The shell rewrites this on every boot, so anything older than a
     * day is a corpse.
     */
    if (Date.now() - parsed.writtenAt > 86_400_000) return null;
    return {
      version: String(parsed.version ?? ""),
      platform: (parsed.platform ?? process.platform) as NodeJS.Platform,
      screenAccess: (parsed.screenAccess ?? "unknown") as DesktopFacts["screenAccess"],
      accessibility: parsed.accessibility === true,
      writtenAt: parsed.writtenAt,
    };
  } catch {
    return null;
  }
}

/** True when this Node process is Electron's, i.e. the packaged desktop app. */
export function isDesktopRuntime(): boolean {
  return Boolean(process.versions.electron);
}

// ------------------------------------------------------------------- probes

/** Does the macOS `screencapture` binary exist and run? */
async function probeScreenCapture(facts: DesktopFacts | null): Promise<Capability> {
  if (process.platform !== "darwin") {
    return unsupported("Screen capture is macOS-only in this build.");
  }
  if (facts?.screenAccess === "denied" || facts?.screenAccess === "restricted") {
    return denied(
      "macOS has not given Lore permission to record the screen.",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  }
  const exists = await fs
    .access("/usr/sbin/screencapture")
    .then(() => true)
    .catch(() => false);
  if (!exists) return missing("macOS `screencapture` is not on this system.");
  if (facts?.screenAccess === "not-determined") {
    return missing(
      "macOS will ask for screen-recording permission the first time Ghost runs.",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  }
  return ready();
}

/**
 * Can we name the frontmost application?
 *
 * `System Events` is the only reliable route and it is gated behind Automation
 * permission, which macOS grants per calling application. The probe is the real
 * call — anything else would answer for a different binary than the one that
 * will do the work.
 */
async function probeWindowTitles(): Promise<Capability> {
  if (process.platform !== "darwin") {
    return unsupported("Reading the frontmost window is macOS-only in this build.");
  }
  try {
    await exec(
      "/usr/bin/osascript",
      ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
      { timeout: 6_000 },
    );
    return ready();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    /* -1743 is macOS's "user has not allowed this", which is a permission to
       grant rather than a bug to report. Everything else is a real failure. */
    if (/-1743|not allowed|not authori[sz]ed/i.test(message)) {
      return denied(
        "macOS has not allowed Lore to ask which app is in front.",
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
      );
    }
    return missing("Could not ask macOS which app is in front.");
  }
}

/**
 * Full Disk Access, probed by reading the thing that needs it.
 *
 * There is no API that answers this question. The only honest test is to open
 * a file that TCC protects, and `chat.db` is both protected and the exact file
 * Oracle wants — so a pass here is a pass for the real work, not a proxy.
 */
async function probeFullDiskAccess(): Promise<Capability> {
  if (process.platform !== "darwin") {
    return unsupported("Full Disk Access is a macOS concept.");
  }
  const target = path.join(os.homedir(), "Library", "Messages", "chat.db");
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) {
    /* No Messages database at all — a Mac that has never opened Messages. That
       is not a permission problem and must not be reported as one. */
    return missing("No Messages database on this Mac, so there was nothing to test with.");
  }
  try {
    const handle = await fs.open(target, "r");
    await handle.close();
    return ready();
  } catch {
    return denied(
      "macOS has not given Full Disk Access to the app running Lore, so Messages, Mail and Safari history cannot be read.",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    );
  }
}

/** Which frontier providers have a key configured. Names only — never values. */
export function configuredProviders(): string[] {
  const out: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) out.push("google");
  if (process.env.OPENROUTER_API_KEY) out.push("openrouter");
  return out;
}

let cache: { at: number; value: Capabilities } | null = null;
const CACHE_MS = 20_000;

export async function detectCapabilities(force = false): Promise<Capabilities> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const siteMode = isSiteMode();
  const facts = await readDesktopFacts();
  const desktop = isDesktopRuntime() || Boolean(facts);

  /*
   * On the public site every probe is a lie waiting to happen: there is no
   * user machine here, only a server nobody owns. Answer honestly and skip the
   * work rather than reporting the host's capabilities as the visitor's.
   */
  if (siteMode) {
    const none = unsupported("This is the Lore website. There is no machine here to observe.");
    return {
      platform: process.platform,
      desktop: false,
      siteMode: true,
      storage: none,
      screenCapture: none,
      windowTitles: none,
      fullDiskAccess: none,
      vision: { ...none, model: null },
      localModel: { ...none, model: null },
      cloudModels: { ...none, providers: [] },
      nativeShell: none,
    };
  }

  const [screenCapture, windowTitles, fullDiskAccess, ollama] = await Promise.all([
    probeScreenCapture(facts),
    probeWindowTitles(),
    probeFullDiskAccess(),
    detectOllama().catch(() => ({ running: false, models: [], error: null })),
  ]);

  const visionModel = ollama.running ? await pickVisionModel(ollama.models).catch(() => null) : null;
  const { recommendModel } = await import("@/lib/ollama");
  const textModel = ollama.running ? recommendModel(ollama.models) : null;
  const providers = configuredProviders();

  const value: Capabilities = {
    platform: process.platform,
    desktop,
    siteMode: false,
    storage: sqliteAvailable()
      ? ready()
      : missing("This build of Node has no SQLite, so nothing can be indexed locally."),
    screenCapture,
    windowTitles,
    fullDiskAccess,
    vision: visionModel
      ? { ...ready(), model: visionModel }
      : {
          ...missing(
            ollama.running
              ? "Ollama is running but none of the installed models can look at an image. `ollama pull gemma4` adds one."
              : "Ollama is not running, so there is no local model to describe what is on screen.",
          ),
          model: null,
        },
    localModel: textModel
      ? { ...ready(), model: textModel }
      : {
          ...missing(
            ollama.running
              ? "Ollama is running but has no instruction-tuned model installed."
              : "Ollama is not running, so nothing can be written or summarised locally.",
          ),
          model: null,
        },
    cloudModels: providers.length
      ? { ...ready(), providers }
      : {
          ...missing(
            "No frontier API keys are set, so Chorus can only convene the models on this machine.",
          ),
          providers: [],
        },
    nativeShell: desktop
      ? ready()
      : missing("Global hotkeys, the menu bar and notifications need the Lore desktop app."),
  };

  cache = { at: Date.now(), value };
  return value;
}

/** Drop the cache — called after the user grants a permission and retries. */
export function forgetCapabilities(): void {
  cache = null;
}
