import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fail, requireVault } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);

/**
 * Git, for wikis that already live in a repo.
 *
 * Many do, and for them Lore's history is the second-best record — git has the
 * real one, with a remote and a rollback story nobody has to trust us for. The
 * useful thing is not to replace it but to close the gap it has: agents write
 * between commits, so a repo-backed wiki accumulates a week of unattributed
 * changes and then someone commits them all as "updates".
 *
 * So: show what is uncommitted, and let it be committed from here, while the
 * journal still knows who wrote what.
 *
 * Every call uses execFile with an argument array — never a shell string. A
 * page path comes from the filesystem and can contain anything; interpolating
 * one into a shell command is how a filename becomes code execution.
 */
async function git(cwd: string, args: string[]) {
  return run("git", args, { cwd, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
}

async function isRepo(root: string): Promise<boolean> {
  return fs
    .stat(path.join(root, ".git"))
    .then(() => true)
    .catch(() => false);
}

export async function GET() {
  try {
    const vault = await requireVault();
    if (!(await isRepo(vault.root))) {
      return Response.json({ repo: false });
    }

    const [status, branch, log] = await Promise.all([
      git(vault.root, ["status", "--porcelain=v1", "--"]).catch(() => ({ stdout: "" })),
      git(vault.root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({ stdout: "" })),
      git(vault.root, ["log", "-12", "--format=%h%x1f%an%x1f%at%x1f%s"]).catch(() => ({ stdout: "" })),
    ]);

    const changes = status.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ state: line.slice(0, 2).trim(), path: line.slice(3) }))
      // Only markdown: a wiki repo often carries other files, and offering to
      // commit them from a wiki app would be a surprising thing to do.
      .filter((c) => /\.mdx?$/i.test(c.path));

    return Response.json({
      repo: true,
      branch: branch.stdout.trim(),
      changes,
      commits: log.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, author, at, subject] = line.split("\x1f");
          return { hash, author, at: Number(at) * 1000, subject };
        }),
    });
  } catch (error) {
    return fail(error, 409);
  }
}

/** POST — commit the listed markdown paths (or every changed one). */
export async function POST(request: Request) {
  try {
    const vault = await requireVault();
    if (!(await isRepo(vault.root))) return fail(new Error("This vault is not a git repo."), 409);

    const body = (await request.json()) as { message?: string; paths?: string[]; push?: boolean };
    const message = body.message?.trim();
    if (!message) return fail(new Error("A commit needs a message."));

    const paths = (body.paths ?? []).filter((p) => /\.mdx?$/i.test(p) && !p.startsWith("-"));
    // `--` separates paths from options, so a file named `--force` is a file.
    await git(vault.root, paths.length ? ["add", "--", ...paths] : ["add", "--", "."]);

    const staged = await git(vault.root, ["diff", "--cached", "--name-only"]).catch(() => ({
      stdout: "",
    }));
    if (!staged.stdout.trim()) return Response.json({ ok: true, committed: false });

    await git(vault.root, ["commit", "-m", message]);
    const head = await git(vault.root, ["rev-parse", "--short", "HEAD"]);

    let pushed = false;
    if (body.push) {
      // A failed push must not lose the commit — it is already safe locally.
      pushed = await git(vault.root, ["push"])
        .then(() => true)
        .catch(() => false);
    }

    return Response.json({
      ok: true,
      committed: true,
      hash: head.stdout.trim(),
      files: staged.stdout.split("\n").filter(Boolean).length,
      pushed,
    });
  } catch (error) {
    return fail(error);
  }
}
