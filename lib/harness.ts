import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_PORT } from "@/lib/brand";

/**
 * Harness wiring — the one thing the filesystem watcher cannot see.
 *
 * lib/journal.ts watches the vault folder, which is why it captures every tool
 * equally: Claude Code, Cursor, a shell script, your own hand. That neutrality
 * is exactly what makes it anonymous. It knows a page changed at 14:02 and that
 * 40 lines went missing. It has no idea who did it.
 *
 * Claude Code can tell us, via a PostToolUse hook: after every Write/Edit/
 * MultiEdit it runs a command of our choosing and pipes the tool call to it on
 * stdin. One curl back to this app and the write is recorded, with a name, in
 * `~/.lore/attribution.jsonl`.
 *
 * That log is the whole of it today. Nothing reads it back: `attributionByPath`
 * below exists to join it onto `WriteEvent.relPath` from lib/journal.ts, but no
 * route or view calls it, so Review still shows every change unattributed. The
 * honest description of this file is "collects attribution", not "displays" it.
 *
 * Everything in here edits a file the user owns and did not write for us, so
 * the rules are strict and non-negotiable:
 *   - read and parse first; if it is not valid JSON, refuse and say so
 *   - copy to `<file>.lore-backup` before touching it
 *   - merge: add our key, preserve every other byte of meaning
 *   - never install twice; an equivalent entry already present is a no-op
 *   - write through a temp file and rename, so a crash mid-write cannot leave
 *     a truncated settings.json behind (~/.claude.json can be megabytes)
 */

export type HarnessStatus = {
  name: string;
  configPath: string;
  installed: boolean;
  detail: string;
};

export type McpTarget = "claude-code" | "claude-desktop" | "cursor";

/** The hook is its own row in the UI, separate from the MCP rows. */
export const HOOK_HARNESS_NAME = "Claude Code · write attribution";

export const MCP_TARGETS: McpTarget[] = ["claude-code", "claude-desktop", "cursor"];

export const MCP_TARGET_LABEL: Record<McpTarget, string> = {
  "claude-code": "Claude Code · MCP",
  "claude-desktop": "Claude Desktop · MCP",
  cursor: "Cursor · MCP",
};

/** Tools whose output is a file write. Claude Code matchers are regex strings. */
export const HOOK_MATCHER = "Write|Edit|MultiEdit";

const HOOK_URL = `http://127.0.0.1:${APP_PORT}/api/harness`;

export function claudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export function mcpConfigPath(target: McpTarget): string {
  const home = os.homedir();
  if (target === "claude-desktop") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (target === "cursor") return path.join(home, ".cursor", "mcp.json");
  return path.join(home, ".claude.json");
}

export function mcpServerEntry(installDir: string) {
  return {
    command: "node",
    args: [path.join(installDir, "mcp", "server.mjs")],
    env: { LORE_URL: `http://127.0.0.1:${APP_PORT}` },
  };
}

/**
 * The hook command.
 *
 * Claude Code pipes the tool call to the command as JSON on stdin, so the
 * cheapest correct thing is to forward that body untouched and let the route
 * pick the fields out — no jq, no shell JSON parsing, nothing to go stale when
 * the payload shape gains a field.
 *
 * `-m 2` and the trailing `|| true` matter: a hook that hangs or fails is a
 * hook that slows down or breaks the user's agent. Lore being closed must cost
 * them nothing.
 */
export function hookCommand(vaultRoot: string): string {
  const url = `${HOOK_URL}?agent=claude-code&vault=${encodeURIComponent(vaultRoot)}`;
  const quoted = `'${url.replace(/'/g, `'\\''`)}'`;
  return `curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- ${quoted} >/dev/null 2>&1 || true`;
}

// ------------------------------------------------------------------ json i/o

type ConfigRead =
  | { state: "missing" }
  | { state: "ok"; value: Record<string, unknown> }
  | { state: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readConfigFile(file: string): Promise<ConfigRead> {
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) return { state: "missing" };
  try {
    const parsed: unknown = JSON.parse(raw);
    // An array or a scalar is syntactically fine and semantically unmergeable.
    return isRecord(parsed) ? { state: "ok", value: parsed } : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

async function backup(file: string): Promise<void> {
  await fs.copyFile(file, `${file}.lore-backup`).catch(() => {});
}

async function writeConfigFile(file: string, value: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.lore-tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

/** Shorten for display. The UI shows config paths and `/Users/name` is noise. */
export function tildePath(file: string): string {
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

// ----------------------------------------------------------------- detection

function postToolUseCommands(settings: Record<string, unknown>): string[] {
  const hooks = settings.hooks;
  if (!isRecord(hooks) || !Array.isArray(hooks.PostToolUse)) return [];
  const found: string[] = [];
  for (const group of hooks.PostToolUse) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    for (const entry of group.hooks) {
      if (isRecord(entry) && typeof entry.command === "string") found.push(entry.command);
    }
  }
  return found;
}

/** Any hook already pointing at our endpoint counts, however it was written. */
const isLoreHook = (command: string) => command.includes("/api/harness");

function hasLoreMcpServer(config: Record<string, unknown>): boolean {
  const servers = config.mcpServers;
  return isRecord(servers) && isRecord(servers.lore);
}

async function detectHook(): Promise<HarnessStatus> {
  const configPath = claudeSettingsPath();
  const read = await readConfigFile(configPath);

  if (read.state === "missing") {
    return {
      name: HOOK_HARNESS_NAME,
      configPath,
      installed: false,
      detail: "No settings.json on this machine. Connecting creates one containing only the hook.",
    };
  }
  if (read.state === "invalid") {
    return {
      name: HOOK_HARNESS_NAME,
      configPath,
      installed: false,
      detail: "settings.json is not valid JSON. Lore will not edit a file it cannot parse.",
    };
  }
  if (postToolUseCommands(read.value).some(isLoreHook)) {
    return {
      name: HOOK_HARNESS_NAME,
      configPath,
      installed: true,
      detail: "A PostToolUse hook posts every Write, Edit and MultiEdit to Lore.",
    };
  }
  return {
    name: HOOK_HARNESS_NAME,
    configPath,
    installed: false,
    detail: "settings.json found. No Lore hook in it — writes will stay anonymous.",
  };
}

async function detectMcp(target: McpTarget): Promise<HarnessStatus> {
  const configPath = mcpConfigPath(target);
  const name = MCP_TARGET_LABEL[target];
  const read = await readConfigFile(configPath);

  if (read.state === "missing") {
    return {
      name,
      configPath,
      installed: false,
      detail: "No config at this path, so this tool is probably not installed. Connecting creates the file.",
    };
  }
  if (read.state === "invalid") {
    return {
      name,
      configPath,
      installed: false,
      detail: "The config is not valid JSON. Lore will not edit a file it cannot parse.",
    };
  }
  return hasLoreMcpServer(read.value)
    ? { name, configPath, installed: true, detail: "Listed under mcpServers as `lore`." }
    : { name, configPath, installed: false, detail: "Config found. Lore is not in mcpServers yet." };
}

/**
 * What is actually on this machine. Every field here comes from reading the
 * file — nothing is inferred from an app being installed, and nothing is
 * reported as connected without our entry being physically present.
 */
export async function detectHarnesses(): Promise<HarnessStatus[]> {
  return Promise.all([detectHook(), ...MCP_TARGETS.map(detectMcp)]);
}

// -------------------------------------------------------------- installation

export type InstallResult = { ok: boolean; configPath: string; message: string };

export async function installClaudeCodeHook(vaultRoot: string): Promise<InstallResult> {
  const configPath = claudeSettingsPath();
  const read = await readConfigFile(configPath);

  if (read.state === "invalid") {
    return {
      ok: false,
      configPath,
      message: "settings.json could not be parsed as JSON, so it was left untouched. Fix it and try again.",
    };
  }

  const settings = read.state === "ok" ? read.value : {};
  if (postToolUseCommands(settings).some(isLoreHook)) {
    return { ok: true, configPath, message: "Already connected — nothing was changed." };
  }

  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const groups: unknown[] = Array.isArray(hooks.PostToolUse) ? [...hooks.PostToolUse] : [];
  const entry = { type: "command", command: hookCommand(vaultRoot) };

  // Prefer joining the user's existing matcher group over adding a second one
  // with the same matcher — two identical matchers work, but they make their
  // settings file harder for them to read.
  const index = groups.findIndex(
    (group) => isRecord(group) && group.matcher === HOOK_MATCHER && Array.isArray(group.hooks),
  );
  if (index >= 0) {
    const group = groups[index] as Record<string, unknown>;
    groups[index] = { ...group, hooks: [...(group.hooks as unknown[]), entry] };
  } else {
    groups.push({ matcher: HOOK_MATCHER, hooks: [entry] });
  }

  if (read.state === "ok") await backup(configPath);
  await writeConfigFile(configPath, { ...settings, hooks: { ...hooks, PostToolUse: groups } });

  return {
    ok: true,
    configPath,
    message:
      read.state === "ok"
        ? "Hook added. Everything else in settings.json is unchanged; the previous version is at settings.json.lore-backup."
        : "Created settings.json with the hook. Restart Claude Code to pick it up.",
  };
}

export async function installMcpConfig(
  target: "claude-code" | "claude-desktop" | "cursor",
  installDir: string,
): Promise<InstallResult> {
  const configPath = mcpConfigPath(target);
  const read = await readConfigFile(configPath);

  if (read.state === "invalid") {
    return {
      ok: false,
      configPath,
      message: "That config could not be parsed as JSON, so it was left untouched. Fix it and try again.",
    };
  }

  const config = read.state === "ok" ? read.value : {};
  if (hasLoreMcpServer(config)) {
    return { ok: true, configPath, message: "Already connected — nothing was changed." };
  }

  const servers = isRecord(config.mcpServers) ? config.mcpServers : {};

  if (read.state === "ok") await backup(configPath);
  await writeConfigFile(configPath, {
    ...config,
    mcpServers: { ...servers, lore: mcpServerEntry(installDir) },
  });

  const others = Object.keys(servers).length;
  return {
    ok: true,
    configPath,
    message:
      read.state === "ok"
        ? `Added \`lore\` to mcpServers${others ? `, alongside the ${others} already there` : ""}. Previous version saved as ${path.basename(configPath)}.lore-backup. Restart the app to pick it up.`
        : "Created the config with Lore in it. Restart the app to pick it up.",
  };
}

// ----------------------------------------------------------------- attribution

/**
 * Attribution lives outside the vault, next to the journal and the usage log,
 * so it never shows up in a `git diff` of the user's notes. Append-only JSONL:
 * a torn final line from a killed process costs one record, not the file.
 */
const ATTRIBUTION_DIR = path.join(os.homedir(), ".lore");
const ATTRIBUTION_FILE = path.join(ATTRIBUTION_DIR, "attribution.jsonl");

export type Attribution = {
  at: number;
  file: string;
  agent: string;
  tool: string;
  /*
   * Where the write came from.
   *
   * "Which agent" answers who to blame and stops there. A page that says
   * something surprising raises a different question — what was being worked on
   * when this was written — and that answer lives in a transcript nobody can
   * find six weeks later. Recording the session identifier and, when the
   * harness exposes it, a link straight back to the conversation turns "where
   * did this claim come from" from an archaeology project into a click.
   *
   * Optional on purpose: not every harness has a session concept, and a
   * missing field must never invalidate the attribution around it.
   */
  session?: string;
  url?: string;
};

export async function recordAttribution(event: Attribution): Promise<void> {
  try {
    await fs.mkdir(ATTRIBUTION_DIR, { recursive: true, mode: 0o700 });
    await fs.appendFile(ATTRIBUTION_FILE, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // A hook that fails is a hook the user has to debug. Stay silent.
  }
}

export async function readAttribution(sinceMs = 0): Promise<Attribution[]> {
  const raw = await fs.readFile(ATTRIBUTION_FILE, "utf8").catch(() => "");
  const out: Attribution[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Attribution;
      if (event.at >= sinceMs) out.push(event);
    } catch {
      // Torn line; skipping it is correct.
    }
  }
  return out;
}

/** Who last wrote each file, keyed by path relative to `root`. */
export type PathAttribution = {
  agent: string;
  tool: string;
  at: number;
  session?: string;
  url?: string;
};

export function attributionByPath(
  events: Attribution[],
  root: string,
): Record<string, PathAttribution> {
  const byPath: Record<string, PathAttribution> = {};
  for (const event of events) {
    const rel = path.relative(root, event.file).split(path.sep).join("/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const current = byPath[rel];
    if (!current || event.at > current.at) {
      byPath[rel] = {
        agent: event.agent,
        tool: event.tool,
        at: event.at,
        session: event.session,
        url: event.url,
      };
    }
  }
  return byPath;
}
