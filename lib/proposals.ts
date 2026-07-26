import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRaw, writeRaw, createPage } from "@/lib/wiki";

/**
 * The review queue.
 *
 * An agent that can silently rewrite your wiki is a liability: the failure mode
 * isn't a bad edit you notice, it's a confident wrong one you don't. So agents
 * never write directly. They propose, the proposal lands here as a diff, and
 * nothing touches the vault until a human accepts it.
 *
 * Proposals live in ~/.lore, deliberately NOT inside the wiki — a pending
 * proposal is Lore's state, not the user's knowledge, and it should never show
 * up in a `git diff` of their vault.
 */

const STORE_DIR = path.join(os.homedir(), ".lore");
const STORE_FILE = path.join(STORE_DIR, "proposals.json");

export type ProposalStatus = "pending" | "accepted" | "rejected";

/**
 * Risk tier, set by the proposing agent and sanity-checked here. It drives
 * ordering and colour in the queue: a new page is cheap to accept, a rewrite of
 * an existing page deserves a real read.
 */
export type Risk = "low" | "medium" | "high";

export type Proposal = {
  id: string;
  /** Vault-relative path being changed. */
  relPath: string;
  /** Which agent proposed it, self-reported (e.g. "Claude Code"). */
  agent: string;
  /** One line explaining why, written by the agent. */
  reason: string;
  kind: "create" | "append" | "replace";
  risk: Risk;
  /** Full proposed file content after the change. */
  proposed: string;
  /** File content at proposal time, for conflict detection. null for creates. */
  base: string | null;
  status: ProposalStatus;
  createdAt: number;
  resolvedAt: number | null;
};

async function readAll(): Promise<Proposal[]> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Proposal[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(proposals: Proposal[]): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(STORE_FILE, JSON.stringify(proposals, null, 2) + "\n", "utf8");
}

export async function listProposals(root: string): Promise<Proposal[]> {
  const all = await readAll();
  return all
    .filter((p) => p.id.startsWith(`${hashRoot(root)}:`))
    .sort((a, b) => {
      // Pending first, then newest. Within pending, riskiest first — the ones
      // that actually need judgment shouldn't be buried under trivia.
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      if (a.status === "pending" && a.risk !== b.risk) {
        const order: Record<Risk, number> = { high: 0, medium: 1, low: 2 };
        return order[a.risk] - order[b.risk];
      }
      return b.createdAt - a.createdAt;
    });
}

/** Namespaces proposals per vault so two linked wikis never mix queues. */
function hashRoot(root: string): string {
  let hash = 0;
  for (let i = 0; i < root.length; i++) hash = (hash * 31 + root.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

export async function createProposal(
  root: string,
  input: {
    relPath: string;
    agent: string;
    reason: string;
    kind: Proposal["kind"];
    risk?: string;
    content: string;
  },
): Promise<Proposal> {
  const base = input.kind === "create" ? null : await readRaw(root, input.relPath).catch(() => null);

  if (input.kind !== "create" && base === null) {
    throw new Error(`Cannot ${input.kind} ${input.relPath}: the page does not exist.`);
  }
  if (input.kind === "create" && base !== null) {
    throw new Error(`Cannot create ${input.relPath}: a page already exists there.`);
  }

  const proposed =
    input.kind === "append" ? `${(base ?? "").replace(/\s*$/, "")}\n\n${input.content.trim()}\n` : input.content;

  const risk: Risk =
    input.risk === "high" || input.risk === "medium" || input.risk === "low"
      ? input.risk
      : // Unstated risk is inferred, never assumed benign: replacing an
        // existing page is the case that can destroy work.
        input.kind === "replace"
        ? "high"
        : input.kind === "append"
          ? "medium"
          : "low";

  const proposal: Proposal = {
    id: `${hashRoot(root)}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    relPath: input.relPath,
    agent: input.agent || "Unknown agent",
    reason: input.reason || "No reason given.",
    kind: input.kind,
    risk,
    proposed,
    base,
    status: "pending",
    createdAt: Date.now(),
    resolvedAt: null,
  };

  await writeAll([...(await readAll()), proposal]);
  return proposal;
}

export async function resolveProposal(
  root: string,
  id: string,
  action: "accept" | "reject",
): Promise<Proposal> {
  const all = await readAll();
  const proposal = all.find((p) => p.id === id);
  if (!proposal) throw new Error("Proposal not found.");
  if (proposal.status !== "pending") throw new Error("Proposal was already resolved.");

  if (action === "accept") {
    // Conflict check: if the file changed on disk since the proposal was made,
    // accepting would silently discard whatever the user wrote in between.
    if (proposal.kind === "create") {
      await createPage(root, proposal.relPath, proposal.proposed);
    } else {
      const current = await readRaw(root, proposal.relPath).catch(() => null);
      if (current !== proposal.base) {
        throw new Error(
          "That page changed on disk after this was proposed. Reject it and ask the agent again.",
        );
      }
      await writeRaw(root, proposal.relPath, proposal.proposed);
    }
  }

  proposal.status = action === "accept" ? "accepted" : "rejected";
  proposal.resolvedAt = Date.now();
  await writeAll(all);
  return proposal;
}

/**
 * Resolve many proposals in one pass — the "Accept all" / "Reject all" bar at
 * the top of a folder document.
 *
 * Failures are collected rather than thrown: if one proposal conflicts because
 * its page changed on disk, the other nine should still land, and the user
 * should be told exactly which one didn't.
 */
export async function resolveMany(
  root: string,
  ids: string[],
  action: "accept" | "reject",
): Promise<{ resolved: number; failures: { id: string; message: string }[] }> {
  const failures: { id: string; message: string }[] = [];
  let resolved = 0;

  // Sequential on purpose. Two accepts touching the same file concurrently
  // would both pass the conflict check and race on the write.
  for (const id of ids) {
    try {
      await resolveProposal(root, id, action);
      resolved += 1;
    } catch (error) {
      failures.push({
        id,
        message: error instanceof Error ? error.message : "Could not resolve.",
      });
    }
  }

  return { resolved, failures };
}

/**
 * A minimal line diff for the review UI. Not Myers — for the small, mostly
 * additive edits an agent proposes, a common-prefix/suffix trim gives a diff
 * that reads correctly and costs nothing.
 */
export type DiffLine = { type: "same" | "add" | "remove"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const context = 2;
  const lines: DiffLine[] = [];
  for (let i = Math.max(0, start - context); i < start; i++) {
    lines.push({ type: "same", text: a[i] });
  }
  for (let i = start; i < endA; i++) lines.push({ type: "remove", text: a[i] });
  for (let i = start; i < endB; i++) lines.push({ type: "add", text: b[i] });
  for (let i = endA; i < Math.min(a.length, endA + context); i++) {
    lines.push({ type: "same", text: a[i] });
  }

  return lines;
}

export function diffStats(before: string, after: string): { added: number; removed: number } {
  const lines = diffLines(before, after);
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "remove").length,
  };
}
