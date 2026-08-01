import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const run = promisify(execFile);

/**
 * Every agent write as its own commit, authored by the agent.
 *
 * Lore keeps a journal, an attribution log, a version store and an undo plan —
 * four homemade approximations of things git already does properly, invented
 * because a wiki is usually just a folder. When the folder IS a repo, all four
 * are second-best: git has the real history, a remote, and a rollback story
 * nobody has to trust us for.
 *
 * What git cannot do on its own is notice. Agents write between commits, so a
 * repo-backed wiki accumulates a week of changes from five different agents and
 * someone eventually commits them all as "updates" under their own name. This
 * closes that gap at the only moment the answer is known: the write itself.
 *
 * Off by default. Committing on somebody's behalf, in their repo, is not a
 * thing to start doing without being asked — and on a vault where a human also
 * edits by hand, a commit per agent write is noise they did not choose.
 *
 * Every call uses execFile with an argument array, never a shell string: a page
 * path comes from the filesystem and can contain anything, and interpolating
 * one into a shell command is how a filename becomes code execution.
 */

export async function isRepo(root: string): Promise<boolean> {
  return fs
    .stat(path.join(root, ".git"))
    .then(() => true)
    .catch(() => false);
}

/**
 * An email for an agent, stable across runs.
 *
 * `.local` is reserved for exactly this — it can never be a real address, so a
 * commit authored by "Claude Code" cannot be mistaken for one authored by a
 * person, and `git shortlog` groups an agent's work under one identity.
 */
function authorFor(agent: string): string {
  const slug = agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
  return `${agent} <${slug}@lore.local>`;
}

export type CommitResult =
  | { state: "committed"; hash: string }
  | { state: "skipped"; reason: string };

/**
 * Commit one path, as one agent.
 *
 * Scoped to the single file rather than `git add .`: an agent write must never
 * sweep up whatever the human happened to have in progress. If nothing about
 * that file changed — an append that produced identical bytes — nothing is
 * committed, because an empty commit per no-op write would bury the real ones.
 */
export async function commitWrite(
  root: string,
  relPath: string,
  agent: string,
  summary: string,
): Promise<CommitResult> {
  if (!(await isRepo(root))) return { state: "skipped", reason: "not a git repo" };
  if (relPath.startsWith("-")) return { state: "skipped", reason: "unsafe path" };

  const git = (args: string[]) => run("git", args, { cwd: root, timeout: 20_000 });

  try {
    // `--` separates paths from options, so a file named `--force` is a file.
    await git(["add", "--", relPath]);
    const staged = await git(["diff", "--cached", "--name-only", "--", relPath]);
    if (!staged.stdout.trim()) return { state: "skipped", reason: "no change on disk" };

    const subject = `${summary} (${relPath})`.slice(0, 140);
    await git([
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--author",
      authorFor(agent),
      "-m",
      subject,
      "-m",
      `Written through Lore by ${agent}. Unverified until a human checks it.`,
      "--",
      relPath,
    ]);
    const head = await git(["rev-parse", "--short", "HEAD"]);
    return { state: "committed", hash: head.stdout.trim() };
  } catch (error) {
    // A failed commit must never fail the write. The page is on disk either
    // way, and the journal still recorded who wrote it.
    return {
      state: "skipped",
      reason: error instanceof Error ? error.message.split("\n")[0] : "git refused",
    };
  }
}

export type SyncResult = {
  pulled: boolean;
  pushed: boolean;
  /** Files git could not merge, which is the only outcome needing a human. */
  conflicts: string[];
  message: string;
};

/**
 * Pull, then push.
 *
 * The honest answer to "sync my wiki between machines" is a git remote, not a
 * service of ours holding a copy of somebody's private notes. Rebase rather
 * than merge, because a wiki's history reads better as a sequence of edits than
 * as a lattice of merge commits nobody will ever look at.
 *
 * A conflicted rebase is aborted rather than left half-applied. Dropping a user
 * into a detached rebase state from a button in a notes app is not a thing to
 * do to somebody who did not ask for it.
 */
export async function sync(root: string): Promise<SyncResult> {
  if (!(await isRepo(root))) {
    return { pulled: false, pushed: false, conflicts: [], message: "This vault is not a git repo." };
  }
  const git = (args: string[]) => run("git", args, { cwd: root, timeout: 60_000 });

  const hasRemote = await git(["remote"])
    .then((r) => Boolean(r.stdout.trim()))
    .catch(() => false);
  if (!hasRemote) {
    return {
      pulled: false,
      pushed: false,
      conflicts: [],
      message: "No remote is configured, so there is nothing to sync with.",
    };
  }

  // Uncommitted work is committed first; pulling on top of a dirty tree is how
  // you lose an edit somebody made five minutes ago.
  const dirty = await git(["status", "--porcelain=v1"]).catch(() => ({ stdout: "" }));
  if (dirty.stdout.trim()) {
    await git(["add", "--", "."]).catch(() => {});
    await git([
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Lore: local changes before sync",
    ]).catch(() => {});
  }

  let pulled = false;
  const conflicts: string[] = [];
  try {
    await git(["pull", "--rebase", "--autostash"]);
    pulled = true;
  } catch {
    const unmerged = await git(["diff", "--name-only", "--diff-filter=U"]).catch(() => ({
      stdout: "",
    }));
    conflicts.push(...unmerged.stdout.split("\n").filter(Boolean));
    await git(["rebase", "--abort"]).catch(() => {});
    return {
      pulled: false,
      pushed: false,
      conflicts,
      message: conflicts.length
        ? `${conflicts.length} file${conflicts.length === 1 ? "" : "s"} changed on both sides. The rebase was aborted and nothing was lost — resolve them in a terminal.`
        : "Could not pull. Nothing was changed.",
    };
  }

  const pushed = await git(["push"])
    .then(() => true)
    .catch(() => false);

  return {
    pulled,
    pushed,
    conflicts: [],
    message: pushed
      ? "Up to date with the remote."
      : "Pulled, but the push failed — your work is committed locally and safe.",
  };
}
