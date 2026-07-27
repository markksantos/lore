import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";

/**
 * Templates, daily notes, and saved searches.
 *
 * All three exist for the same reason: a wiki is only as consistent as the
 * moment a page is created, and that moment currently offers a blank file. The
 * schema checker can tell you afterwards that a page is missing `updated:` —
 * which is the least useful time to learn it.
 *
 * Templates live in `~/.lore` rather than inside the vault. A `templates/`
 * folder in the wiki would be indexed, searched, handed to agents, and counted
 * in the corpus budget, and none of that is wanted: a template is Lore's
 * furniture, not the user's knowledge.
 */

const DIR = path.join(os.homedir(), ".lore");
const storePath = (key: string) => path.join(DIR, `templates-${key}.json`);

export type Template = {
  id: string;
  name: string;
  /** Where new pages from this template go, relative to the vault root. */
  folder: string;
  /** Body, with {{placeholders}} substituted on use. */
  body: string;
  /** Filename pattern, also templated. */
  filename: string;
};

export type SavedSearch = { id: string; name: string; query: string };

export type Store = {
  templates: Template[];
  searches: SavedSearch[];
  /** Where the daily note lands, templated the same way. */
  dailyFolder: string;
  dailyTemplateId: string | null;
};

/**
 * Shipped defaults, written to answer the three things a wiki always needs and
 * never has a consistent shape for.
 */
export const DEFAULT_STORE: Store = {
  templates: [
    {
      id: "note",
      name: "Note",
      folder: "notes",
      filename: "{{slug}}.md",
      body: [
        "---",
        "title: {{title}}",
        "created: {{date}}",
        "updated: {{date}}",
        "tags: []",
        "---",
        "",
        "# {{title}}",
        "",
        "",
      ].join("\n"),
    },
    {
      id: "decision",
      name: "Decision",
      folder: "decisions",
      filename: "{{date}}-{{slug}}.md",
      body: [
        "---",
        "title: {{title}}",
        "created: {{date}}",
        "updated: {{date}}",
        "tags: [decision]",
        "---",
        "",
        "# {{title}}",
        "",
        "## What we decided",
        "",
        "## Why",
        "",
        "## What we rejected, and why",
        "",
        "## What would change our mind",
        "",
      ].join("\n"),
    },
    {
      id: "daily",
      name: "Daily note",
      folder: "daily",
      filename: "{{date}}.md",
      body: [
        "---",
        "title: {{date}}",
        "created: {{date}}",
        "tags: [daily]",
        "---",
        "",
        "# {{date}}",
        "",
        "## Done",
        "",
        "## Open",
        "",
        "## Worth writing up",
        "",
      ].join("\n"),
    },
  ],
  searches: [
    { id: "unverified-recent", name: "Changed but unverified", query: "updated" },
    { id: "todo", name: "Open questions", query: "TODO" },
  ],
  dailyFolder: "daily",
  dailyTemplateId: "daily",
};

export async function readStore(root: string): Promise<Store> {
  const raw = await fs.readFile(storePath(vaultKey(root)), "utf8").catch(() => "");
  if (!raw) return DEFAULT_STORE;
  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      templates: parsed.templates ?? DEFAULT_STORE.templates,
      searches: parsed.searches ?? DEFAULT_STORE.searches,
      dailyFolder: parsed.dailyFolder ?? DEFAULT_STORE.dailyFolder,
      dailyTemplateId: parsed.dailyTemplateId ?? DEFAULT_STORE.dailyTemplateId,
    };
  } catch {
    return DEFAULT_STORE;
  }
}

export async function writeStore(root: string, store: Store): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(storePath(vaultKey(root)), JSON.stringify(store, null, 2), "utf8");
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "untitled"
  );
}

/**
 * Fill a template.
 *
 * `now` is a parameter rather than read inside, so a caller creating several
 * pages in one action stamps them all with the same moment — otherwise a batch
 * started at 23:59:59 can span two dates.
 */
export function fill(text: string, title: string, now = new Date()): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10);
  return text
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{slug\}\}/g, slugify(title))
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{time\}\}/g, iso.slice(11, 16))
    .replace(/\{\{datetime\}\}/g, iso)
    .replace(/\{\{year\}\}/g, date.slice(0, 4))
    .replace(/\{\{month\}\}/g, date.slice(5, 7));
}

/** The path a template would produce for this title, without creating it. */
export function targetPath(template: Template, title: string, now = new Date()): string {
  const name = fill(template.filename, title, now);
  const folder = fill(template.folder, title, now).replace(/^\/+|\/+$/g, "");
  const withExt = /\.mdx?$/i.test(name) ? name : `${name}.md`;
  return folder ? `${folder}/${withExt}` : withExt;
}
