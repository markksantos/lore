import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";

/**
 * Your question history.
 *
 * Ask started as a box that forgot everything the moment you left the screen,
 * which makes it a search field rather than something you return to. A question
 * you asked last week is worth keeping for two reasons: you often want the same
 * answer again, and the list of what you have asked is itself a map of what you
 * actually use the wiki for.
 *
 * Stored per vault, outside it. Answers are kept too — they are cheap, and
 * reopening a thread without re-running a thirty-second model call is most of
 * the point of having a history at all.
 */

const DIR = path.join(os.homedir(), ".lore");
const filePath = (key: string) => path.join(DIR, `asked-${key}.json`);

export type AskedTurn = {
  id: string;
  at: number;
  question: string;
  answer: string | null;
  /** Just enough of each source to re-render the thread without re-retrieving. */
  sources: { n: number; pageId: string; relPath: string; title: string }[];
};

const MAX = 200;

export async function readAsked(root: string): Promise<AskedTurn[]> {
  const raw = await fs.readFile(filePath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AskedTurn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function recordAsked(root: string, turn: AskedTurn): Promise<void> {
  const all = await readAsked(root);
  // Newest first, and the same question asked twice replaces the older entry
  // rather than filling the sidebar with repeats of itself.
  const deduped = all.filter(
    (t) => t.question.trim().toLowerCase() !== turn.question.trim().toLowerCase(),
  );
  const next = [turn, ...deduped].slice(0, MAX);
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath(vaultKey(root)), JSON.stringify(next), "utf8").catch(() => {});
}

export async function deleteAsked(root: string, id: string): Promise<void> {
  const all = await readAsked(root);
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs
    .writeFile(filePath(vaultKey(root)), JSON.stringify(all.filter((t) => t.id !== id)), "utf8")
    .catch(() => {});
}

/**
 * Starter questions, drawn from this wiki rather than invented.
 *
 * A blank box on a 1,500-page corpus is a hard prompt: you have to guess both
 * what is in there and how to phrase it. Generic examples ("summarise my
 * notes") teach nothing, and a hardcoded one leaked a real client's name into a
 * screenshot. These are built from the pages the vault itself leans on most —
 * so the first question a person asks is one their wiki can actually answer.
 */
export function suggestQuestions(
  pages: { id: string; title: string; folder: string; tags: string[] }[],
  backlinks: Record<string, string[]>,
  limit = 6,
): string[] {
  const hubs = [...pages]
    .map((p) => ({ p, inbound: backlinks[p.id]?.length ?? 0 }))
    .filter((x) => x.inbound > 0 && x.p.title.length < 60)
    .sort((a, b) => b.inbound - a.inbound)
    .slice(0, 24);

  const out: string[] = [];
  const seenFolder = new Set<string>();

  for (const { p } of hubs) {
    // One per folder, so six suggestions cover six parts of the wiki rather
    // than six pages of the same client.
    if (seenFolder.has(p.folder)) continue;
    seenFolder.add(p.folder);
    out.push(`What do I know about ${p.title}?`);
    if (out.length >= limit) break;
  }

  // Shapes that work on any wiki, to fill out a thin or brand-new vault.
  for (const generic of [
    "What did I decide most recently, and why?",
    "What changed this week that I have not read?",
    "What is still unresolved?",
  ]) {
    if (out.length >= limit) break;
    out.push(generic);
  }

  return out.slice(0, limit);
}
