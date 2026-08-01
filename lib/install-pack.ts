import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOOK_MATCHER, hookCommand } from "@/lib/harness";

/**
 * One command that wires Lore into every agent on the machine.
 *
 * The measurement that produced this file: over five days, `~/.lore/usage.jsonl`
 * held 197 calls, of which 193 were the human using the app's own Ask box and 3
 * were an actual agent. Lore was being used as a reader by one person. The loop
 * it exists for — agents pulling context out of the wiki and writing better
 * pages back into it — had run three times.
 *
 * That is not a feature problem. Connections showed you a block of JSON and
 * wished you luck, and every harness wants it in a different file, in a
 * different format, under a different key. Nobody does that four times.
 *
 * So: `lore install`. It finds the harnesses that exist, merges Lore into each
 * one's config, and leaves everything else in those files untouched.
 *
 * Three rules, because these are files the user's tools depend on:
 *
 *   - Never clobber. Every write backs up first and merges into what is there.
 *   - Never guess. A config that cannot be parsed is reported and left alone,
 *     never rewritten from scratch.
 *   - Always idempotent. Running it twice changes nothing the second time.
 */

export type Harness = "claude-code" | "claude-desktop" | "cursor" | "codex" | "hermes";

export const HARNESS_LABEL: Record<Harness, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  codex: "Codex",
  hermes: "Hermes",
};

export type StepResult = {
  harness: Harness;
  step: string;
  state: "installed" | "already" | "skipped" | "failed";
  path: string;
  detail: string;
};

export type InstallOptions = {
  /** Where this copy of Lore lives, so configs can point at mcp/server.mjs. */
  installDir: string;
  vaultRoot: string;
  port: number;
  /** Restrict this harness's agent to a path prefix, e.g. "clients/". */
  scope?: string;
  /** Install the session hooks as well as the MCP server. */
  hooks?: boolean;
  /** Report what would change without touching anything. */
  dryRun?: boolean;
};

const home = os.homedir();

export function configPathFor(harness: Harness): string {
  switch (harness) {
    case "claude-code":
      return path.join(home, ".claude.json");
    case "claude-desktop":
      return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "codex":
      return path.join(home, ".codex", "config.toml");
    case "hermes":
      return path.join(home, ".hermes", "config.yaml");
  }
}

/** Which harnesses are actually on this machine. */
export async function detectInstalled(): Promise<Harness[]> {
  const candidates: [Harness, string][] = [
    ["claude-code", path.join(home, ".claude")],
    ["claude-desktop", path.join(home, "Library", "Application Support", "Claude")],
    ["cursor", path.join(home, ".cursor")],
    ["codex", path.join(home, ".codex")],
    ["hermes", path.join(home, ".hermes")],
  ];
  const found: Harness[] = [];
  for (const [harness, dir] of candidates) {
    if (await fs.stat(dir).then(() => true).catch(() => false)) found.push(harness);
  }
  return found;
}

async function backup(file: string): Promise<void> {
  await fs.copyFile(file, `${file}.lore-backup`).catch(() => {});
}

/**
 * The environment every harness passes to the MCP server.
 *
 * `LORE_AGENT_NAME` is what makes receipts legible — without it every caller is
 * "MCP agent" and the usage log cannot tell Codex from Cursor. `LORE_SCOPE` is
 * the read/write boundary for that agent.
 */
function serverEnv(opts: InstallOptions, harness: Harness): Record<string, string> {
  const env: Record<string, string> = {
    LORE_URL: `http://127.0.0.1:${opts.port}`,
    LORE_AGENT_NAME: HARNESS_LABEL[harness],
  };
  if (opts.scope) env.LORE_SCOPE = opts.scope;
  return env;
}

function serverArgs(opts: InstallOptions): string[] {
  return [path.join(opts.installDir, "mcp", "server.mjs")];
}

// ------------------------------------------------------------------ JSON hosts

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(
  file: string,
): Promise<{ state: "missing" | "ok" | "invalid"; value: Record<string, unknown> }> {
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) return { state: "missing", value: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? { state: "ok", value: parsed } : { state: "invalid", value: {} };
  } catch {
    return { state: "invalid", value: {} };
  }
}

async function writeJson(file: string, value: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.lore-tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

async function installJsonMcp(
  harness: Harness,
  opts: InstallOptions,
): Promise<StepResult> {
  const file = configPathFor(harness);
  const base = { harness, step: "MCP server", path: file };
  const read = await readJson(file);

  if (read.state === "invalid") {
    return { ...base, state: "failed", detail: "Not valid JSON — left untouched." };
  }

  const servers = isRecord(read.value.mcpServers) ? read.value.mcpServers : {};
  const wanted = {
    command: "node",
    args: serverArgs(opts),
    env: serverEnv(opts, harness),
  };

  if (JSON.stringify(servers.lore) === JSON.stringify(wanted)) {
    return { ...base, state: "already", detail: "Already pointing at this copy of Lore." };
  }
  if (opts.dryRun) {
    return { ...base, state: "installed", detail: "Would add `lore` to mcpServers." };
  }

  if (read.state === "ok") await backup(file);
  await writeJson(file, { ...read.value, mcpServers: { ...servers, lore: wanted } });
  const others = Object.keys(servers).filter((k) => k !== "lore").length;
  return {
    ...base,
    state: "installed",
    detail: others
      ? `Added alongside ${others} other server${others === 1 ? "" : "s"}.`
      : "Added.",
  };
}

// ----------------------------------------------------------------- Claude Code

/**
 * The two hooks that close the loop without anyone remembering to.
 *
 * SessionStart runs `lore brief`, whose output Claude Code injects as context —
 * so every session opens knowing what the other agents wrote since it last ran,
 * with no tool call and no prompting.
 *
 * SessionEnd pipes the hook payload to `lore capture`, which writes a page
 * recording what the session touched. Lore cannot make a model choose to
 * document its work, and pretending otherwise would be the same mistake as the
 * approval queue this product already removed. What it can do is make the
 * mechanical part — which files changed, under what goal, in which session —
 * land in the wiki every time, attributed, without being asked.
 */
function sessionStartCommand(binDir: string): string {
  return `${JSON.stringify(path.join(binDir, "lore.mjs"))} brief --days 1 --peek 2>/dev/null || true`;
}

function sessionEndCommand(binDir: string): string {
  return `${JSON.stringify(path.join(binDir, "lore.mjs"))} capture 2>/dev/null || true`;
}

function hasCommandContaining(groups: unknown[], needle: string): boolean {
  return groups.some(
    (group) =>
      isRecord(group) &&
      Array.isArray(group.hooks) &&
      group.hooks.some(
        (hook) =>
          isRecord(hook) && typeof hook.command === "string" && hook.command.includes(needle),
      ),
  );
}

async function installClaudeHooks(opts: InstallOptions): Promise<StepResult> {
  const file = path.join(home, ".claude", "settings.json");
  const base = { harness: "claude-code" as const, step: "Session hooks", path: file };
  const read = await readJson(file);
  if (read.state === "invalid") {
    return { ...base, state: "failed", detail: "settings.json is not valid JSON — left untouched." };
  }

  const hooks = isRecord(read.value.hooks) ? { ...read.value.hooks } : {};
  const binDir = path.join(opts.installDir, "bin");

  const start: unknown[] = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];
  const end: unknown[] = Array.isArray(hooks.SessionEnd) ? [...hooks.SessionEnd] : [];
  const post: unknown[] = Array.isArray(hooks.PostToolUse) ? [...hooks.PostToolUse] : [];

  // Matched on the subcommand rather than a marker comment, so a hook the user
  // has since reformatted or moved between groups is still recognised as ours.
  const needStart = !hasCommandContaining(start, "lore.mjs\" brief");
  const needEnd = !hasCommandContaining(end, "lore.mjs\" capture");
  /*
   * The attribution hook, which everything about authorship depends on.
   *
   * Without it Lore sees that a file changed and cannot see who changed it, so
   * the brief cannot say "written by Codex", Review cannot separate one agent's
   * work from another's, undo-an-agent has nothing to select on, and the
   * authorship term in the brief's ranking is inert. It was a separate,
   * separately-forgotten step on the Connections screen — which is why, on the
   * machine this was built for, it had never been installed.
   */
  const needPost = !hasCommandContaining(post, "/api/harness");

  if (!needStart && !needEnd && !needPost) {
    return { ...base, state: "already", detail: "All three hooks are already installed." };
  }
  if (opts.dryRun) {
    return { ...base, state: "installed", detail: "Would add the session and attribution hooks." };
  }

  if (needStart) start.push({ hooks: [{ type: "command", command: sessionStartCommand(binDir) }] });
  if (needEnd) end.push({ hooks: [{ type: "command", command: sessionEndCommand(binDir) }] });
  if (needPost) {
    const entry = { type: "command", command: hookCommand(opts.vaultRoot) };
    // Prefer joining the user's existing matcher group over adding a second one
    // with the same matcher — two identical matchers work and make their
    // settings file harder for them to read.
    const at = post.findIndex(
      (group) => isRecord(group) && group.matcher === HOOK_MATCHER && Array.isArray(group.hooks),
    );
    if (at >= 0) {
      const group = post[at] as Record<string, unknown>;
      post[at] = { ...group, hooks: [...(group.hooks as unknown[]), entry] };
    } else {
      post.push({ matcher: HOOK_MATCHER, hooks: [entry] });
    }
  }

  if (read.state === "ok") await backup(file);
  await writeJson(file, {
    ...read.value,
    hooks: { ...hooks, SessionStart: start, SessionEnd: end, PostToolUse: post },
  });
  return {
    ...base,
    state: "installed",
    detail:
      "Sessions open with the brief, close by recording what they touched, and every write is attributed.",
  };
}

// ------------------------------------------------------------------- Codex TOML

/**
 * Codex keeps its config in TOML, and Lore does not carry a TOML parser.
 *
 * Appending a `[mcp_servers.lore]` table is safe in a way that rewriting the
 * file is not: TOML tables are order-independent, and a later table cannot
 * change the meaning of an earlier one. So the only two states worth
 * distinguishing are "already has one" and "does not", and the second is fixed
 * by adding text at the end.
 *
 * If the user already has a `[mcp_servers.lore]`, it is left exactly as it is.
 * Editing a table in place without a parser is how you corrupt somebody's
 * config, and the honest answer is to say it is already there.
 */
async function installCodex(opts: InstallOptions): Promise<StepResult> {
  const file = configPathFor("codex");
  const base = { harness: "codex" as const, step: "MCP server", path: file };
  const raw = await fs.readFile(file, "utf8").catch(() => null);

  if (raw !== null && /^\s*\[mcp_servers\.lore\]/m.test(raw)) {
    return { ...base, state: "already", detail: "`[mcp_servers.lore]` is already in config.toml." };
  }
  if (opts.dryRun) {
    return { ...base, state: "installed", detail: "Would append `[mcp_servers.lore]`." };
  }

  const env = serverEnv(opts, "codex");
  const block = [
    "",
    "# Added by `lore install`. Safe to edit or delete.",
    "[mcp_servers.lore]",
    'command = "node"',
    `args = [${serverArgs(opts).map((a) => JSON.stringify(a)).join(", ")}]`,
    "",
    "[mcp_servers.lore.env]",
    ...Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
    "",
  ].join("\n");

  await fs.mkdir(path.dirname(file), { recursive: true });
  if (raw !== null) await backup(file);
  await fs.writeFile(file, `${raw ?? ""}${block}`, "utf8");
  return { ...base, state: "installed", detail: "Appended to config.toml." };
}

// ------------------------------------------------------------------ Hermes YAML

/**
 * Hermes keeps its config in YAML, and the same reasoning applies as for Codex:
 * no parser, so no rewrite.
 *
 * A block is inserted directly under the existing `mcp_servers:` key, or the
 * key is appended if it does not exist. Both are additive edits at a known
 * indentation, which is the most a text-level editor can honestly promise.
 */
async function installHermes(opts: InstallOptions): Promise<StepResult> {
  const file = configPathFor("hermes");
  const base = { harness: "hermes" as const, step: "MCP server", path: file };
  const raw = await fs.readFile(file, "utf8").catch(() => null);

  if (raw === null) {
    return { ...base, state: "skipped", detail: "No config.yaml — nothing to merge into." };
  }
  if (/^\s{2}lore:\s*$/m.test(raw) && /^mcp_servers:/m.test(raw)) {
    return { ...base, state: "already", detail: "`lore` is already under mcp_servers." };
  }
  if (opts.dryRun) {
    return { ...base, state: "installed", detail: "Would add `lore` under mcp_servers." };
  }

  const env = serverEnv(opts, "hermes");
  const entry = [
    "  lore:",
    '    command: node',
    "    args:",
    ...serverArgs(opts).map((a) => `      - ${JSON.stringify(a)}`),
    "    env:",
    ...Object.entries(env).map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`),
    "    connect_timeout: 30",
  ].join("\n");

  await backup(file);
  const lines = raw.split("\n");
  const at = lines.findIndex((line) => /^mcp_servers:\s*$/.test(line));
  const next =
    at === -1
      ? `${raw.replace(/\s*$/, "")}\n\nmcp_servers:\n${entry}\n`
      : [...lines.slice(0, at + 1), entry, ...lines.slice(at + 1)].join("\n");

  await fs.writeFile(file, next, "utf8");
  return { ...base, state: "installed", detail: "Added under mcp_servers." };
}

// ----------------------------------------------------------------------- skill

/**
 * The instructions, written once and shared.
 *
 * An MCP server gives an agent the ability to use the wiki. It does not tell it
 * when, and a model with eight unfamiliar tools and no guidance uses none of
 * them. This is the missing half: read before you guess, write what you learned,
 * and act on what the write tool says back.
 */
export function skillMarkdown(vaultRoot: string): string {
  return `---
name: lore
description: Use when you need durable context about this person's work, projects, clients or decisions — or when you have learned something worth keeping. Backed by their local wiki at ${vaultRoot}.
---

# Lore — the shared wiki

Everything you and the other agents know that outlives a conversation lives in
one folder of markdown. Lore is how you read and write it.

## Before you guess, read

1. \`wiki_brief\` — what the other agents learned since you last ran. Cheap, and
   it is the difference between continuing work and repeating it.
2. \`wiki_context\` with the subject you need. This returns the relevant passages
   assembled to a token budget, each citing its page. Prefer it to reading whole
   pages.
3. \`wiki_read\` when you need one page in full. Honour what it tells you:
   a page marked SUPERSEDED has been replaced — read the replacement.
   A page marked EXPIRED made a promise its author has stopped vouching for.
   A page marked UNVERIFIED has never been checked by a human; say so if you
   rely on it.

If \`wiki_search\` returns nothing, that gap is recorded. Say out loud that the
wiki could not answer, rather than inventing the answer.

## When you learn something, write it

Call \`wiki_write\` when a fact will still matter next week: a decision and its
reasoning, a constraint discovered the hard way, how something is actually set
up, a correction to something the wiki gets wrong.

Do not write progress updates, task lists, or a narration of what you just did.
A wiki of those is a wiki nobody can retrieve from.

\`append\` is the default and is almost always right. \`replace\` overwrites
everything on the page.

## Read what the write tool says back

\`wiki_write\` returns notes. They are not decoration — they are the only moment
the problem is cheap to fix:

- **Contradiction** — the wiki now says two things. Update the other page, or
  say which one is current.
- **Duplicate** — append to the page that already covers this instead of leaving
  two, or add \`supersedes: old/page.md\` to declare which one won.
- **Links to nothing** — add a \`[[wikilink]]\`. An unlinked page is one nobody
  finds again.
- **Missing frontmatter** — the vault's SCHEMA.md asks for those fields.
- **No expiry on a price or version** — add \`expires: YYYY-MM-DD\` so it can be
  flagged when it goes stale rather than quietly rotting.
- **Fragmenting** — you have created a lot of pages. Put the next one on an
  existing page.

Acting on a note costs a sentence now. Nobody will do it later.
`;
}

async function installSkill(opts: InstallOptions): Promise<StepResult> {
  const file = path.join(home, ".claude", "skills", "lore", "SKILL.md");
  const base = { harness: "claude-code" as const, step: "Skill", path: file };
  const wanted = skillMarkdown(opts.vaultRoot);
  const current = await fs.readFile(file, "utf8").catch(() => null);

  if (current === wanted) return { ...base, state: "already", detail: "Already up to date." };
  if (opts.dryRun) {
    return { ...base, state: "installed", detail: current ? "Would update." : "Would create." };
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  if (current !== null) await backup(file);
  await fs.writeFile(file, wanted, "utf8");
  return { ...base, state: "installed", detail: current ? "Updated." : "Created." };
}

// ------------------------------------------------------------------------ run

export async function installAll(
  harnesses: Harness[],
  opts: InstallOptions,
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  for (const harness of harnesses) {
    try {
      if (harness === "codex") results.push(await installCodex(opts));
      else if (harness === "hermes") results.push(await installHermes(opts));
      else results.push(await installJsonMcp(harness, opts));

      if (harness === "claude-code") {
        results.push(await installSkill(opts));
        if (opts.hooks !== false) results.push(await installClaudeHooks(opts));
      }
    } catch (error) {
      results.push({
        harness,
        step: "install",
        state: "failed",
        path: configPathFor(harness),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
