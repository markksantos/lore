import { listVersions, readVersion, type Version } from "@/lib/history";
import { readAttribution, type Attribution } from "@/lib/harness";

/**
 * Undo an agent.
 *
 * Attribution answers "who wrote this" and stops there, which is a diagnosis
 * with no treatment. The realistic bad afternoon is not one wrong page — it is
 * an agent that misread its instructions and rewrote forty, and the only
 * remedies available were reverting each by hand from the version list or
 * reaching for git, which most vaults are not under.
 *
 * This assembles the other half: every page one agent touched in a window, and
 * the content each had immediately before it touched them.
 *
 * Two things it deliberately does not do. It does not revert to "the newest
 * version before now" — if a human edited a page after the agent did, that edit
 * must survive, so a page with a later human write is reported and skipped
 * rather than silently rolled back. And it never deletes a page the agent
 * created; it empties nothing. Creating a page is not damage in the way
 * overwriting one is, and an undo that removes files is an undo nobody dares
 * run.
 */

export type UndoTarget = {
  relPath: string;
  agent: string;
  at: number;
  /** Content to restore, or null when there is no snapshot from before. */
  restore: string | null;
  state: "revertable" | "created" | "no-snapshot" | "touched-since";
  /** Why this page cannot be reverted, when it cannot. */
  note?: string;
};

export type UndoPlan = {
  agent: string;
  since: number;
  targets: UndoTarget[];
  revertable: number;
};

/**
 * The version immediately preceding a moment.
 *
 * History snapshots on write, so the version whose timestamp is the greatest
 * one strictly below `at` is what the page said before this write landed.
 */
function versionBefore(versions: Version[], at: number): Version | null {
  let best: Version | null = null;
  for (const version of versions) {
    if (version.at >= at) continue;
    if (!best || version.at > best.at) best = version;
  }
  return best;
}

function latestAt(versions: Version[]): number {
  return versions.reduce((max, v) => Math.max(max, v.at), 0);
}

export async function planUndo(
  root: string,
  key: string,
  agent: string,
  since: number,
  existingPaths: Set<string>,
): Promise<UndoPlan> {
  const events: Attribution[] = await readAttribution(since);

  // Earliest write per page: reverting to just before an agent's FIRST touch
  // undoes the whole run, where reverting to just before its last touch would
  // leave the intermediate damage in place.
  const first = new Map<string, Attribution>();
  for (const event of events) {
    if (event.agent !== agent) continue;
    const rel = event.file.startsWith(root)
      ? event.file.slice(root.length).replace(/^\/+/, "")
      : null;
    if (!rel) continue;
    const current = first.get(rel);
    if (!current || event.at < current.at) first.set(rel, event);
  }

  const targets: UndoTarget[] = [];

  for (const [relPath, event] of first) {
    const versions = await listVersions(key, relPath).catch(() => []);
    const before = versionBefore(versions, event.at);

    if (!before) {
      targets.push({
        relPath,
        agent,
        at: event.at,
        restore: null,
        state: existingPaths.has(relPath) ? "created" : "no-snapshot",
        note: existingPaths.has(relPath)
          ? "This agent created the page. Undo does not delete files — remove it yourself if you want it gone."
          : "No snapshot from before this write, so there is nothing to restore.",
      });
      continue;
    }

    /*
     * Somebody wrote after the agent did.
     *
     * Rolling back here would throw away a later edit that may well be a human
     * fixing the very problem this undo is for. Reported and skipped, because a
     * bulk operation that silently destroys work is one people stop trusting
     * after the first time.
     */
    const newest = latestAt(versions);
    const laterWrites = events.filter(
      (e) => e.agent !== agent && e.at > event.at && e.file.endsWith(relPath),
    );
    if (laterWrites.length || newest > event.at + 1000 * 60 * 60 * 24 * 365) {
      targets.push({
        relPath,
        agent,
        at: event.at,
        restore: null,
        state: "touched-since",
        note: `Also written by ${laterWrites[0]?.agent ?? "someone else"} afterwards. Reverting would discard that too, so this one is left alone.`,
      });
      continue;
    }

    const content = await readVersion(key, relPath, before.at).catch(() => null);
    targets.push({
      relPath,
      agent,
      at: event.at,
      restore: content,
      state: content === null ? "no-snapshot" : "revertable",
      note: content === null ? "The snapshot could not be read." : undefined,
    });
  }

  targets.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return {
    agent,
    since,
    targets,
    revertable: targets.filter((t) => t.state === "revertable").length,
  };
}
