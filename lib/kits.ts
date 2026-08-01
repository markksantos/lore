/**
 * Starter kits — a wiki shaped for what you actually do.
 *
 * The generic starter builds notes/projects/decisions/people/raw, which is a
 * defensible default and nobody's actual wiki. The folder layout is the single
 * highest-leverage decision in a wiki that agents write to, because it decides
 * what "same subject" means for every downstream feature: retrieval scope,
 * contradiction detection, the brief's per-folder spread, prune's archive
 * heuristic. Getting it right on day one is worth far more than any of them.
 *
 * Each kit is a folder layout, a SCHEMA.md, and an AGENTS.md written for that
 * domain. Nothing here is a template in the fill-in-the-blanks sense — they are
 * conventions, stated once, so nobody has to invent them and then argue with an
 * agent that invented different ones.
 */

export type Kit = {
  id: string;
  name: string;
  /** One line, for choosing between them. */
  summary: string;
  folders: { name: string; purpose: string }[];
  /** Frontmatter fields this kind of wiki actually uses. */
  schema: { field: string; required: boolean; type: string; note: string }[];
  /** House rules, written into AGENTS.md. */
  rules: string[];
};

export const KITS: Kit[] = [
  {
    id: "general",
    name: "General",
    summary: "Notes, projects, decisions, people. The default when nothing fits better.",
    folders: [
      { name: "notes", purpose: "Anything that does not belong anywhere else yet." },
      { name: "projects", purpose: "One page per thing you are actively working on." },
      { name: "decisions", purpose: "What you chose, why, and what would change your mind." },
      { name: "people", purpose: "Who someone is, what they care about, what you agreed." },
      { name: "raw", purpose: "Captured material — transcripts, clippings, exports." },
    ],
    schema: [
      { field: "title", required: true, type: "string", note: "What the page is about." },
      { field: "updated", required: true, type: "date", note: "Bumped on every real change." },
      { field: "tags", required: false, type: "list", note: "Few and reused, not descriptive." },
    ],
    rules: [
      "One page per subject. A page about two things is retrieved for neither.",
      "Link every new page to at least one existing one, or nobody finds it again.",
      "Write what is true now. History belongs in the version log, not in the prose.",
    ],
  },
  {
    id: "client",
    name: "Client work",
    summary: "One folder per client, with conversations and deliverables kept apart.",
    folders: [
      { name: "clients", purpose: "One folder per client. Everything about them lives inside it." },
      { name: "pricing", purpose: "Rates, floors and what is included. The page you most need to be right." },
      { name: "process", purpose: "How work actually gets done — intake, revisions, delivery." },
      { name: "templates", purpose: "Messages and documents you send more than once." },
      { name: "raw", purpose: "Transcripts and exports. Never the source of truth." },
    ],
    schema: [
      { field: "title", required: true, type: "string", note: "Client or subject name." },
      { field: "status", required: true, type: "string", note: "active, paused, or closed." },
      { field: "updated", required: true, type: "date", note: "Bumped on every real change." },
      { field: "expires", required: false, type: "date", note: "On anything with a price in it." },
    ],
    rules: [
      "A client folder is one subject. Two clients never share a page.",
      "Prices live in pricing/, never in a conversation log — a rate quoted in a transcript is a thing that was once said, not a rate.",
      "Anything with a number in it gets `expires:`. A stale price is worse than no price.",
      "Never write a client's contact details into the wiki.",
    ],
  },
  {
    id: "codebase",
    name: "Codebase",
    summary: "Architecture, decisions and runbooks for software you maintain.",
    folders: [
      { name: "architecture", purpose: "How it is built, and why it is built that way." },
      { name: "decisions", purpose: "One page per decision: what, why, what would reverse it." },
      { name: "runbooks", purpose: "What to do when something breaks, written for 3am." },
      { name: "stack", purpose: "Versions, services, ports, credentials' locations (never values)." },
      { name: "gotchas", purpose: "Things that cost somebody a day. The highest-value pages here." },
    ],
    schema: [
      { field: "title", required: true, type: "string", note: "The component or decision." },
      { field: "updated", required: true, type: "date", note: "Bumped on every real change." },
      { field: "expires", required: false, type: "date", note: "Required on version and port pages." },
      { field: "supersedes", required: false, type: "string", note: "The page this replaces." },
    ],
    rules: [
      "Never write a secret. Write where the secret lives.",
      "Every version and port carries `expires:` — those are the facts that rot fastest and look freshest.",
      "A decision page states what would change your mind. Without that it is a preference, not a decision.",
      "When you replace a page, set `supersedes:` rather than deleting the old one.",
    ],
  },
  {
    id: "research",
    name: "Research",
    summary: "Sources, claims and open questions, kept separate on purpose.",
    folders: [
      { name: "questions", purpose: "What you are trying to find out. The spine of the wiki." },
      { name: "claims", purpose: "One page per claim, with what supports and contradicts it." },
      { name: "sources", purpose: "One page per source. Summary, not a copy." },
      { name: "synthesis", purpose: "What you now believe, and how confident you are." },
      { name: "raw", purpose: "Full texts and captures. Cited from, never reasoned from directly." },
    ],
    schema: [
      { field: "title", required: true, type: "string", note: "The question, claim or source." },
      { field: "updated", required: true, type: "date", note: "Bumped on every real change." },
      { field: "confidence", required: false, type: "string", note: "low, medium or high — on claims." },
      { field: "tags", required: false, type: "list", note: "The question this belongs to." },
    ],
    rules: [
      "A claim page cites its sources by wikilink. An uncited claim is a note, not a claim.",
      "Record what contradicts a claim on the claim's own page. A wiki that only records support is a wiki that gets more confident as it gets more wrong.",
      "Never reason from raw/. Summarise into a source page first, then cite that.",
    ],
  },
];

export const kitById = (id: string): Kit => KITS.find((k) => k.id === id) ?? KITS[0];

const today = () => new Date().toISOString().slice(0, 10);

/** The kit as files, with no filesystem attached — same as lib/starter-files. */
export function kitFiles(kit: Kit, name: string): { relPath: string; body: string }[] {
  const files: { relPath: string; body: string }[] = [];

  files.push({
    relPath: "index.md",
    body: [
      "---",
      `title: ${name}`,
      `created: ${today()}`,
      `updated: ${today()}`,
      "---",
      "",
      `# ${name}`,
      "",
      `A ${kit.name.toLowerCase()} wiki. ${kit.summary}`,
      "",
      "## Where things live",
      "",
      ...kit.folders.map((f) => `- **${f.name}/** — ${f.purpose}`),
      "",
      "Read [[AGENTS]] before writing anything here.",
      "",
    ].join("\n"),
  });

  files.push({
    relPath: "SCHEMA.md",
    body: [
      "---",
      "title: Schema",
      `updated: ${today()}`,
      "---",
      "",
      "# Schema",
      "",
      "Frontmatter every page should carry.",
      "",
      "| field | required | type | notes |",
      "| --- | --- | --- | --- |",
      ...kit.schema.map((f) => `| ${f.field} | ${f.required ? "yes" : "no"} | ${f.type} | ${f.note} |`),
      "",
    ].join("\n"),
  });

  files.push({
    relPath: "AGENTS.md",
    body: [
      "---",
      "title: House rules",
      `updated: ${today()}`,
      "---",
      "",
      "# House rules",
      "",
      "Read this before writing to this wiki.",
      "",
      ...kit.rules.map((r) => `- ${r}`),
      "",
      "## Folders",
      "",
      ...kit.folders.map((f) => `- \`${f.name}/\` — ${f.purpose}`),
      "",
      "## Writing",
      "",
      "Append rather than replace unless you are correcting something wrong.",
      "Read what the write tool says back — a contradiction or a duplicate costs a",
      "sentence to fix now and somebody's afternoon later.",
      "",
    ].join("\n"),
  });

  for (const folder of kit.folders) {
    files.push({
      relPath: `${folder.name}/index.md`,
      body: [
        "---",
        `title: ${folder.name}`,
        `updated: ${today()}`,
        "---",
        "",
        `# ${folder.name}`,
        "",
        folder.purpose,
        "",
        "Nothing here yet. Pages added to this folder should be linked from this one.",
        "",
      ].join("\n"),
    });
  }

  return files;
}
