import type { Metadata } from "next";
import { ProsePage } from "@/components/marketing/prose-page";
import { VERSION } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What shipped in Lore, and what got taken back out.",
};

type Entry = {
  version: string;
  date: string;
  headline: string;
  added?: string[];
  changed?: string[];
  removed?: string[];
};

/**
 * Written by hand rather than generated from commits.
 *
 * A commit log answers "what did the author touch", and a changelog has to
 * answer "what is different for me" — which includes the things that were built
 * and then deleted, since those are the entries a reader learns most from.
 */
const ENTRIES: Entry[] = [
  {
    version: VERSION,
    date: "27 July 2026",
    headline: "First build.",
    added: [
      "Folder-as-document reading: a whole folder renders as one continuous, colour-coded document you edit in place, rather than a file tree you click through.",
      "Four read-only MCP tools — index, search, read, health — that any MCP client can point at your wiki.",
      "A generated AGENTS.md index for agents that only open files, fenced so anything you wrote in it survives being regenerated.",
      "Trust that lapses: a page you verify is pinned to its content hash, so an agent rewriting it silently returns it to the unverified pile.",
      "A harness-agnostic write journal. Lore watches the folder, so it records Claude Code, Cursor, a shell script and your own hand equally, with nothing to opt into.",
      "Seven ways to look at the corpus — browse, graph, treemap, timeline, compare, duplicates, schema.",
      "Context budgeting with a real BPE tokenizer, folder by folder, so the part of your wiki too heavy to hand to a model is a number rather than a surprise.",
      "Optional local semantic search and an optional local model through Ollama. Neither is bundled and neither sends your pages anywhere.",
      "Desktop builds for macOS, Windows and Linux, plus an installable PWA and token-paired access from your phone on your own network.",
    ],
    removed: [
      "The approval queue. Agents proposed edits and a human accepted them; measurement killed it. It was unenforceable — an agent's own write tool bypasses it entirely — redundant with the permission prompt Claude Code already shows, and worst at the volume that matters, where 303 changes a week resolves to Accept All and manufactures confidence. Replaced by promotion, not permission.",
      "Its residue, a day later. Removing the tool that created proposals left the module, the route and the accept/reject UI wired up and able to write to the vault. An empty queue and a deleted queue look identical from the interface, which is why it survived a round of documentation.",
    ],
    changed: [
      "The compatibility wall became a static grid with real brand marks. It had been fourteen letter monograms scrolling past, which claimed compatibility without showing anything recognisable.",
      "Semantic search got a measured similarity floor. A purely relative threshold always returns something, which meant a search for one thing confidently matched an unrelated page.",
    ],
  },
];

const SECTIONS = [
  { key: "added", label: "Added", tone: "text-[var(--lore-success)]" },
  { key: "changed", label: "Changed", tone: "text-[var(--lore-accent)]" },
  { key: "removed", label: "Removed", tone: "text-[var(--lore-danger)]" },
] as const;

export default function ChangelogPage() {
  return (
    <ProsePage
      eyebrow="Changelog"
      title="What changed."
      lede="Including what was built and then taken back out, which on this project is most of the interesting part."
    >
      {ENTRIES.map((entry) => (
        <article key={entry.version} className="mt-14 first:mt-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)]">
              {entry.version}
            </h2>
            <span className="t-meta text-[var(--lore-text-tertiary)]">{entry.date}</span>
          </div>
          <p className="mt-1.5 text-[16px] text-[var(--lore-text-secondary)]">
            {entry.headline}
          </p>

          {SECTIONS.map(({ key, label, tone }) => {
            const items = entry[key];
            if (!items?.length) return null;
            return (
              <section key={key} className="mt-7">
                <h3
                  className={`t-meta font-semibold uppercase tracking-[0.09em] ${tone}`}
                >
                  {label}
                </h3>
                <ul className="lore-bullets mt-2.5 space-y-2.5 text-[15px] leading-[1.75] text-[var(--lore-text-secondary)]">
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            );
          })}
        </article>
      ))}
    </ProsePage>
  );
}
