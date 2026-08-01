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
/** Content words of a title, for telling two suggestions apart. */
function titleTerms(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !GENERIC.has(t)),
  );
}

/**
 * Words that appear in half the titles on a personal wiki and identify nothing.
 *
 * On the vault this was built against, every one of the six suggestions read
 * "What do I know about Mark Studios …" — different pages, different folders,
 * one subject. The one-per-folder rule cannot catch that, because the folders
 * genuinely were different; what was the same was the name.
 */
const GENERIC = new Set([
  "the", "and", "for", "with", "from", "notes", "page", "index", "readme",
  "overview", "summary", "project", "client", "log", "profile", "doc", "docs",
]);

/**
 * Question shapes, so six suggestions are six different KINDS of question.
 *
 * Six variations of "what do I know about X" teach you one thing about the box:
 * that it takes a noun. Varying the verb is what shows somebody it will answer
 * a real question, which is the entire job of a starter suggestion.
 */
const SHAPES: ((title: string) => string)[] = [
  (t) => `What do I know about ${t}?`,
  (t) => `What did I decide about ${t}, and why?`,
  (t) => `What is still unresolved on ${t}?`,
  (t) => `What changed recently on ${t}?`,
  (t) => `Who is involved in ${t}?`,
  (t) => `What did I get wrong about ${t}?`,
];

export function suggestQuestions(
  pages: { id: string; title: string; folder: string; tags: string[] }[],
  backlinks: Record<string, string[]>,
  limit = 6,
): string[] {
  const hubs = [...pages]
    .map((p) => ({ p, inbound: backlinks[p.id]?.length ?? 0 }))
    .filter((x) => x.inbound > 0 && x.p.title.length < 60)
    .sort((a, b) => b.inbound - a.inbound)
    .slice(0, 60);

  const out: string[] = [];
  const seenFolder = new Set<string>();
  const chosen: Set<string>[] = [];

  for (const { p } of hubs) {
    if (out.length >= limit) break;
    // One per folder, so suggestions span the wiki rather than one corner of it.
    if (seenFolder.has(p.folder)) continue;

    /*
     * And one per SUBJECT, which the folder rule does not give you.
     *
     * Two pages in different folders can be about the same thing, and on a
     * wiki organised around one business most of the hubs are. A candidate
     * sharing most of its distinguishing words with something already chosen
     * is the same suggestion in a different folder.
     */
    const terms = titleTerms(p.title);
    if (!terms.size) continue;
    const tooClose = chosen.some((prev) => {
      const shared = [...terms].filter((t) => prev.has(t)).length;
      return shared / Math.min(terms.size, prev.size) >= 0.5;
    });
    if (tooClose) continue;

    seenFolder.add(p.folder);
    chosen.push(terms);
    // A different shape each time, so the list demonstrates the range of
    // questions the box answers rather than one template six times.
    out.push(SHAPES[out.length % SHAPES.length](p.title));
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
