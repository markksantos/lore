import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Read-only mode.
 *
 * The single most common reaction to this app, from people who already have a
 * wiki their agents write to, is fear: *will it change my notes, delete
 * something, or undo what my agent did?* That is the right question to ask of
 * any tool pointed at a folder you care about, and "no, it only writes when you
 * click something" is a promise made of words.
 *
 * This makes it a promise made of code. With read-only on, every route that can
 * touch a page in the vault is refused at the boundary — not asked politely to
 * behave, refused. Turning it off is a deliberate act with a visible switch.
 *
 * It is ON by default for a new vault. Someone opening this for the first time
 * wants to look at what they already have; being able to edit is a thing they
 * can turn on once they trust it.
 */

const DIR = path.join(os.homedir(), ".lore");
const FILE = path.join(DIR, "safety.json");

export type Safety = {
  readOnly: boolean;
  /** When the user last changed it, so the UI can say "you turned this off". */
  changedAt: number | null;
};

export const DEFAULT_SAFETY: Safety = { readOnly: true, changedAt: null };

export async function readSafety(): Promise<Safety> {
  const raw = await fs.readFile(FILE, "utf8").catch(() => "");
  if (!raw) return DEFAULT_SAFETY;
  try {
    const parsed = JSON.parse(raw) as Partial<Safety>;
    return {
      // Anything that is not an explicit `false` means locked. A corrupt or
      // half-written file must fail closed: the failure mode of guessing wrong
      // in the other direction is writing to someone's wiki.
      readOnly: parsed.readOnly !== false,
      changedAt: parsed.changedAt ?? null,
    };
  } catch {
    return DEFAULT_SAFETY;
  }
}

export async function writeSafety(readOnly: boolean): Promise<Safety> {
  const next: Safety = { readOnly, changedAt: Date.now() };
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * Synchronous read, for the proxy.
 *
 * The middleware runs before any handler and cannot await a module-level cache
 * without racing itself. This file is a few dozen bytes and the OS page cache
 * makes the read effectively free; correctness at the boundary is worth more
 * than avoiding a stat.
 */
export function readSafetySync(): Safety {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(FILE, "utf8")) as Partial<Safety>;
    return { readOnly: parsed.readOnly !== false, changedAt: parsed.changedAt ?? null };
  } catch {
    return DEFAULT_SAFETY;
  }
}

/**
 * Routes that can change a file inside the user's wiki, and the methods that do
 * it. Derived by auditing every call to writeRaw / createPage / deletePage.
 *
 * Anything not listed here cannot touch the vault — it reads, or it writes only
 * to ~/.lore, which is Lore's own state and never the user's knowledge.
 */
export const VAULT_WRITERS: Record<string, string[]> = {
  "/api/page": ["POST", "PUT", "DELETE"],
  "/api/agent": ["POST"],
  "/api/ingest": ["POST"],
  "/api/autolink": ["POST"],
  "/api/maintain": ["POST"],
  "/api/history": ["POST"],
  "/api/templates": ["POST"],
  "/api/git": ["POST"],
  // Reverting an agent overwrites pages with writeRaw — that is a vault write,
  // and it was missing here, so read-only mode did not stop it. The route also
  // had no check of its own; centralising it is the fix, not a per-route one.
  "/api/undo": ["POST"],
  // Verify/quarantine can rewrite the ledger and touch frontmatter.
  "/api/review": ["POST"],
};

/*
 * The self-audit that keeps this list honest.
 *
 * The list is derived by hand from "every route that calls writeRaw /
 * createPage / deletePage", and a hand-derived list is one somebody forgets to
 * extend — which is exactly how /api/undo slipped past read-only mode. This
 * function lets a test assert the two agree: given the set of routes that
 * import a writer, every one must appear here. See scripts/test-safety.mjs.
 */
export function auditGap(writingRoutes: string[]): string[] {
  return writingRoutes.filter((route) => !(route in VAULT_WRITERS));
}

export function wouldWriteVault(pathname: string, method: string): boolean {
  const methods = VAULT_WRITERS[pathname];
  return Boolean(methods?.includes(method.toUpperCase()));
}
