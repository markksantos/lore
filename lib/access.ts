import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { vaultKey } from "@/lib/journal";

/**
 * Per-agent access.
 *
 * Until now every agent was "MCP agent" — one undifferentiated caller, named by
 * an environment variable it sets itself. That is fine while everything runs on
 * your own machine over stdio, and useless the moment anything reaches the wiki
 * over the network, because there is then no way to tell two callers apart, no
 * way to revoke one, and no way to give a shared vault different answers for
 * different people.
 *
 * A token is issued per agent, stored hashed, and carries a role. Tokens are
 * shown exactly once, at creation: storing the plaintext would mean a file on
 * disk that grants access to the entire wiki, and the only reason to keep it is
 * to show the user something they were already shown.
 */

const DIR = path.join(os.homedir(), ".lore");
const tokensPath = (key: string) => path.join(DIR, `access-${key}.json`);

export type Role = "reader" | "writer" | "admin";

/** What each role may do. Checked at the edge, not scattered per route. */
export const CAPABILITIES: Record<Role, string[]> = {
  reader: ["read", "search", "index", "health", "changes", "context"],
  writer: ["read", "search", "index", "health", "changes", "context", "write"],
  admin: ["read", "search", "index", "health", "changes", "context", "write", "verify", "manage"],
};

export type AgentToken = {
  id: string;
  name: string;
  role: Role;
  /** SHA-256 of the token. The token itself is never stored. */
  hash: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  /** Optional folder prefixes this agent may see. Empty means the whole vault. */
  scopes: string[];
};

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function readTokens(root: string): Promise<AgentToken[]> {
  const raw = await fs.readFile(tokensPath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AgentToken[];
  } catch {
    return [];
  }
}

async function writeTokens(root: string, tokens: AgentToken[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(tokensPath(vaultKey(root)), JSON.stringify(tokens, null, 2), "utf8", );
  await fs.chmod(tokensPath(vaultKey(root)), 0o600).catch(() => {});
}

export async function issueToken(
  root: string,
  name: string,
  role: Role,
  scopes: string[] = [],
): Promise<{ record: AgentToken; token: string }> {
  const token = `lore_${crypto.randomBytes(24).toString("base64url")}`;
  const record: AgentToken = {
    id: crypto.randomUUID(),
    name: name.trim() || "Unnamed agent",
    role,
    hash: hashToken(token),
    createdAt: Date.now(),
    lastUsedAt: null,
    revokedAt: null,
    scopes: scopes.filter(Boolean),
  };
  await writeTokens(root, [...(await readTokens(root)), record]);
  return { record, token };
}

export async function revokeToken(root: string, id: string): Promise<void> {
  const tokens = await readTokens(root);
  await writeTokens(
    root,
    // Kept rather than deleted, so the audit trail still explains what a past
    // entry in the usage log was.
    tokens.map((t) => (t.id === id ? { ...t, revokedAt: Date.now() } : t)),
  );
}

/**
 * Identify a caller.
 *
 * Compared with `timingSafeEqual` over fixed-length hashes. A plain `===` on
 * secrets leaks their prefix through response timing, and while that is a
 * marginal attack on a loopback service, it is free to do correctly.
 */
export async function identify(root: string, token: string | null): Promise<AgentToken | null> {
  if (!token) return null;
  const candidate = Buffer.from(hashToken(token), "hex");

  for (const record of await readTokens(root)) {
    if (record.revokedAt) continue;
    const known = Buffer.from(record.hash, "hex");
    if (known.length !== candidate.length) continue;
    if (crypto.timingSafeEqual(known, candidate)) return record;
  }
  return null;
}

export async function touch(root: string, id: string): Promise<void> {
  const tokens = await readTokens(root);
  await writeTokens(
    root,
    tokens.map((t) => (t.id === id ? { ...t, lastUsedAt: Date.now() } : t)),
  ).catch(() => {});
}

export const can = (role: Role, capability: string) =>
  CAPABILITIES[role]?.includes(capability) ?? false;

/** Whether a page is inside an agent's scopes. */
export const inScope = (agent: AgentToken, pageId: string) =>
  !agent.scopes.length || agent.scopes.some((s) => pageId === s || pageId.startsWith(`${s}/`));
