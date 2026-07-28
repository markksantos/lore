import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Creating a wiki from nothing.
 *
 * Most people arriving here already have a folder of markdown. The ones who do
 * not are stuck: every part of Lore assumes pages exist, and "make a folder and
 * write some notes" is not an onboarding step, it is homework.
 *
 * So this writes the smallest thing that is genuinely a wiki rather than a demo
 * — four pages that explain themselves, a folder layout with a reason for each
 * folder, and an AGENTS.md so the first agent that opens it already knows the
 * house rules. Nothing here is filler: every file is one a real wiki ends up
 * needing, written once so nobody has to invent the convention.
 */

const today = () => new Date().toISOString().slice(0, 10);

function frontmatter(title: string, tags: string[]): string {
  return ["---", `title: ${title}`, `created: ${today()}`, `updated: ${today()}`, `tags: [${tags.join(", ")}]`, "---", ""].join("\n");
}

/** Folders, with the note that explains why each one exists. */
const FOLDERS: { name: string; purpose: string }[] = [
  { name: "notes", purpose: "Anything that does not belong anywhere else yet." },
  { name: "projects", purpose: "One page per thing you are actively working on." },
  { name: "decisions", purpose: "What you chose, why, and what would change your mind." },
  { name: "people", purpose: "Who someone is, what they care about, what you agreed." },
  { name: "raw", purpose: "Captured material — transcripts, clippings, exports." },
];

export type Created = { root: string; files: string[] };

export async function createStarterVault(root: string, name: string): Promise<Created> {
  // Refuse to write into somewhere that already has content. Scaffolding on top
  // of an existing folder is how you end up with an index.md that overwrites
  // one someone wrote.
  const existing = await fs.readdir(root).catch(() => null);
  if (existing?.some((entry) => !entry.startsWith("."))) {
    throw new Error(`${root} is not empty. Link it instead of creating a new wiki there.`);
  }

  await fs.mkdir(root, { recursive: true });
  const files: string[] = [];

  const write = async (relPath: string, body: string) => {
    const absolute = path.join(root, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, body, "utf8");
    files.push(relPath);
  };

  for (const folder of FOLDERS) {
    await fs.mkdir(path.join(root, folder.name), { recursive: true });
  }

  await write(
    "index.md",
    frontmatter(name, ["index"]) +
      [
        `# ${name}`,
        "",
        "The front door. Link the pages you reach for most, and let everything else",
        "be found by search.",
        "",
        "## Folders",
        "",
        ...FOLDERS.map((f) => `- \`${f.name}/\` — ${f.purpose}`),
        "",
        "## Start here",
        "",
        "- [[how-this-works]] — how to keep this wiki useful",
        "- [[log]] — what changed, and when",
        "- [[why-a-wiki]] — a worked example of a decision page",
        "",
      ].join("\n"),
  );

  await write(
    "how-this-works.md",
    frontmatter("How this works", ["meta"]) +
      [
        "# How this works",
        "",
        "## One idea per page",
        "",
        "A page should answer one question. If it answers three, it is three pages,",
        "and none of them will be found by a search for the other two.",
        "",
        "## Link generously",
        "",
        "Wrap a page name in double square brackets whenever you mention something",
        "that has a page — like this: [[log]]. A wiki is only worth more than a folder",
        "of files because of the links.",
        "",
        "## Say when you learned it",
        "",
        "Facts expire. `updated:` in the frontmatter is how you and your agents tell",
        "a current answer from one that was true last year.",
        "",
        "## Let agents write, and check what matters",
        "",
        "Agents will add far more than you would alone. That is the point. Lore keeps",
        "the record of which of it a human has actually read, so you can spend your",
        "attention on the pages that carry weight rather than on all of them.",
        "",
      ].join("\n"),
  );

  await write(
    "log.md",
    frontmatter("Log", ["log"]) +
      [
        "# Log",
        "",
        "Append-only. One line per meaningful change, newest at the bottom.",
        "",
        `## ${today()}`,
        "",
        "- Wiki created.",
        "",
      ].join("\n"),
  );

  await write(
    "decisions/why-a-wiki.md",
    frontmatter("Why a wiki", ["decision"]) +
      [
        "# Why a wiki",
        "",
        "## What we decided",
        "",
        "Keep durable knowledge in plain markdown files rather than in chat history.",
        "",
        "## Why",
        "",
        "A conversation is gone the moment the context window rolls over. A file is",
        "still there next year, greppable, diffable, and readable by every tool.",
        "",
        "## What would change our mind",
        "",
        "Nothing yet — this is the first entry. Replace it once you make a real one.",
        "",
      ].join("\n"),
  );

  // Not fenced with lore:begin/end markers on purpose: this file is being
  // created, not edited, so there is nothing of the user's to preserve. The
  // moment Lore regenerates it, the fencing appears.
  await write(
    "AGENTS.md",
    [
      `# ${name}`,
      "",
      "This folder is a wiki. Read `index.md` first — it lists the folders and what",
      "belongs in each.",
      "",
      "## House rules",
      "",
      "- One idea per page. Split rather than append to something unrelated.",
      "- Link with double square brackets whenever you mention a page that exists,",
      "  for example [[index]].",
      "- Set `updated:` in frontmatter when you change a page's meaning.",
      "- Append to `log.md` when you add or substantially change a page.",
      "- Prefer appending to rewriting. If you must rewrite, say so in the log.",
      "",
      "## What you should not do",
      "",
      "- Do not reorganise folders without being asked.",
      "- Do not delete pages. Mark them superseded and link forward instead.",
      "",
    ].join("\n"),
  );

  return { root, files };
}
