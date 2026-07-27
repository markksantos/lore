import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { vaultKey } from "@/lib/journal";

/**
 * Comments, activity, webhooks and section-level sign-off.
 *
 * All four are per-vault JSONL or JSON in `~/.lore`, never inside the wiki. A
 * comment is a conversation about a page, not part of it — putting it in the
 * file would hand it to every agent as if it were knowledge, and would show up
 * in a `git diff` of someone's notes.
 */

const DIR = path.join(os.homedir(), ".lore");
const commentsPath = (key: string) => path.join(DIR, `comments-${key}.jsonl`);
const activityPath = (key: string) => path.join(DIR, `activity-${key}.jsonl`);
const hooksPath = (key: string) => path.join(DIR, `webhooks-${key}.json`);
const sectionsPath = (key: string) => path.join(DIR, `sections-${key}.json`);

async function appendLine(file: string, value: unknown): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.appendFile(file, JSON.stringify(value) + "\n", "utf8");
}

async function readLines<T>(file: string, sinceMs = 0): Promise<T[]> {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as T & { at?: number };
      if (!sinceMs || (parsed.at ?? 0) >= sinceMs) out.push(parsed as T);
    } catch {
      // Torn final line from a killed process; skipping is correct.
    }
  }
  return out;
}

// ------------------------------------------------------------------ comments

export type Comment = {
  id: string;
  at: number;
  pageId: string;
  relPath: string;
  by: string;
  body: string;
  /** Quoted text the comment is about, so it survives the page being edited. */
  anchor: string | null;
  resolvedAt: number | null;
};

export async function addComment(
  root: string,
  input: Omit<Comment, "id" | "at" | "resolvedAt">,
): Promise<Comment> {
  const comment: Comment = {
    ...input,
    id: crypto.randomUUID(),
    at: Date.now(),
    resolvedAt: null,
  };
  await appendLine(commentsPath(vaultKey(root)), comment);
  return comment;
}

/**
 * Comments are appended, never rewritten in place — including resolutions,
 * which append a tombstone the reader folds in. An append-only log cannot lose
 * an earlier comment to a concurrent write, and two processes appending is the
 * normal case here (the app and an agent).
 */
export async function resolveComment(root: string, id: string, by: string): Promise<void> {
  await appendLine(commentsPath(vaultKey(root)), { resolve: id, at: Date.now(), by });
}

export async function readComments(root: string): Promise<Comment[]> {
  const rows = await readLines<Comment & { resolve?: string }>(commentsPath(vaultKey(root)));
  const byId = new Map<string, Comment>();
  for (const row of rows) {
    if (row.resolve) {
      const target = byId.get(row.resolve);
      if (target) target.resolvedAt = row.at;
      continue;
    }
    byId.set(row.id, row as Comment);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

// ------------------------------------------------------------------ activity

export type Activity = {
  at: number;
  kind: "verified" | "unverified" | "commented" | "resolved" | "quarantined" | "released" | "ingested" | "restored";
  by: string;
  pageId: string | null;
  relPath: string | null;
  detail?: string;
};

/**
 * The human record.
 *
 * Distinct from the write journal on purpose: the journal answers "what changed
 * on disk", which is mostly agents, and this answers "what did a person decide",
 * which is the part a team needs to see and the part nothing else records.
 */
export async function recordActivity(root: string, event: Omit<Activity, "at">): Promise<void> {
  await appendLine(activityPath(vaultKey(root)), { ...event, at: Date.now() });
  void fireWebhooks(root, { ...event, at: Date.now() });
}

export async function readActivity(root: string, sinceMs = 0): Promise<Activity[]> {
  return (await readLines<Activity>(activityPath(vaultKey(root)), sinceMs)).sort(
    (a, b) => b.at - a.at,
  );
}

// ------------------------------------------------------------------ webhooks

export type Webhook = { id: string; url: string; kinds: string[]; enabled: boolean };

export async function readWebhooks(root: string): Promise<Webhook[]> {
  const raw = await fs.readFile(hooksPath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Webhook[];
  } catch {
    return [];
  }
}

export async function writeWebhooks(root: string, hooks: Webhook[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(hooksPath(vaultKey(root)), JSON.stringify(hooks, null, 2), "utf8");
}

/**
 * Fire and forget, with a short timeout.
 *
 * A webhook is a courtesy to some other system; it must never delay or fail the
 * action that triggered it. A user who verifies a page and waits four seconds
 * because someone's Slack endpoint is down will correctly blame Lore.
 */
async function fireWebhooks(root: string, event: Activity): Promise<void> {
  const hooks = await readWebhooks(root).catch(() => []);
  for (const hook of hooks) {
    if (!hook.enabled) continue;
    if (hook.kinds.length && !hook.kinds.includes(event.kind)) continue;
    void fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "lore", event }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  }
}

// -------------------------------------------------------- section sign-off

export type SectionVerification = {
  /** Hash of that section's text when it was confirmed. */
  hash: string;
  at: number;
  by: string;
  heading: string;
  /** Optional detached signature over the hash, for teams that need one. */
  signature?: string;
};

export type SectionLedger = Record<string, Record<string, SectionVerification>>;

export async function readSections(root: string): Promise<SectionLedger> {
  const raw = await fs.readFile(sectionsPath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SectionLedger;
  } catch {
    return {};
  }
}

export async function writeSections(root: string, ledger: SectionLedger): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(sectionsPath(vaultKey(root)), JSON.stringify(ledger, null, 2), "utf8");
}

export const sectionHash = (text: string) =>
  crypto.createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);

/**
 * Split a page into verifiable sections at headings.
 *
 * Whole-page verification is a bad fit for the pages that most need it: a
 * 5,000-word architecture note gets rewritten in one section and lapses
 * entirely, discarding a human's confirmation of the other twelve. Sections are
 * keyed by heading text rather than position, so inserting a paragraph earlier
 * in the page does not invalidate everything below it.
 */
export function sections(plain: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let heading = "(intro)";
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (text) out.push({ heading, text });
  };

  for (const line of plain.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}
