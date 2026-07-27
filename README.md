<div align="center">

# Lore

**The wiki for all your agents.**

Point Lore at the markdown folder you already have. It maps every page, watches
every write, and shows you which of it a human has actually checked — without
moving a single file.

</div>

---

## What it is

You already wrote it down. Your agents already write into it. Nothing in the
folder records which of it anybody trusts.

Lore is a local app that sits on top of a folder of markdown and does four
things:

1. **Reads it where it sits.** No import, no migration, no new format. Your
   headings, your frontmatter, your `[[wikilinks]]`, your folder names. Delete
   Lore tomorrow and the wiki is what it was.
2. **Watches every write.** Lore watches the filesystem, not a tool — so it sees
   Claude Code, Cursor, a shell script, Obsidian and your own hand equally.
   Nothing has to opt in, and nothing is blocked.
3. **Records what you have checked.** Every page starts `unverified`. You sign
   off on what you have actually read, and the sign-off is pinned to a content
   hash — so an agent rewriting a verified page lapses it automatically.
4. **Tells you what your agents ask for.** Lore is the MCP server, which makes it
   a sensor: it sees which pages get opened and every search that returned
   nothing. The misses are a to-write list built from real demand.

It is not a note-taking app. Keep writing in Obsidian, or vim, or whatever you
already use. Lore is the layer that makes the same folder legible — to your
agents, and to you.

## Promotion, not permission

An earlier version of Lore was an approval gate: an MCP `propose_edit` tool that
queued agent changes for review. It was removed, because it did not work and
could not work.

Measured against a real 1,424-page vault:

| | |
| --- | --- |
| Pages changed in 7 days | 303 |
| Changed in the last 24h | 56 |
| Modified files that were in-place rewrites, not appends | 60 of 75 |
| Pages carrying an agent-written `confidence:` field | 1,156 — 959 "high", 202 "medium", **2 "low"** |
| Pages carrying any human `reviewed` or `verified` field | **0** |

Three things follow from that.

The gate was **unenforceable**: a plain `Write` to a file bypasses a proposal
tool entirely, and the tool competes with every agent's built-in file writer and
loses. It was **redundant**: Claude Code already asks before editing files. And
even a perfect gate would **fail anyway** — 303 changes a week through a gate is
a 303-item queue, which resolves to "Accept All" and manufactures confidence.
That is worse than no gate.

So nothing is blocked. Agents write freely. Everything lands unverified, Lore
ranks what happened by how much it could cost you, and you promote the handful
you actually checked. Trust that cannot lapse is not trust, it is a sticker.

## Quickstart

Requires **Node 20+**. Nothing else — no database, no account, no API key.

```bash
cd "path/to/lore"
npm install
npm run dev          # → http://localhost:4646
```

Open <http://localhost:4646> and pick your wiki folder. On macOS that opens a
real native folder picker; everywhere else you paste a path. If Lore finds a
likely vault already on the machine it offers it. That is the whole setup.

## The six destinations

**Wiki** — the sidebar lists your folders, each with its own colour. Pick one and
it opens as a *single scrolling document*: every page in that folder is a
coloured section, editable in place. You do not open files; you read a folder.
Long folders page in 40 sections at a time, most recently edited first.

**Review** — what changed, ranked. One bar shows how much of the whole corpus a
human has ever confirmed, split four ways (verified / aging / lapsed /
unverified). Below it, the week's writes ranked by lines deleted, how many pages
link to the page, and whether you had previously signed it off — so you read five
things instead of three hundred. Sign off or withdraw sign-off inline. A standing
**Blast radius** list shows the most-linked pages, because those deserve
verification as policy rather than by accident.

**Insights** — the two reports only Lore can produce, plus the number that
governs everything. **Context budget**: what the wiki costs in tokens, measured
with a real BPE tokenizer rather than chars ÷ 4, per folder, with the pages that
crowd a window on their own. **Gaps**: every search your agents ran that returned
nothing, copyable as a prompt. **What carries the weight**: the most-read pages,
and how many have never been opened at all.

**Explore** — seven lenses on the corpus, behind one nav item: Browse (faceted
table), Graph (d3-force link graph), Map (squarified treemap by size), Timeline
(how the wiki grew, from mtime), Compare (two pages side by side, read or diff),
Duplicates (near-duplicate prose via MinHash + LSH), Schema (frontmatter drift
against your own `SCHEMA.md`).

**Connections** — how agents get in: write `AGENTS.md` into the vault, or wire up
an MCP client from a config generated with the paths already filled in for this
machine.

**Settings** — the linked folder, a rescan, unlink, the health report (orphans,
dead links, stale pages, untagged), and the local-model panel: if Ollama is
running on this machine, Lore will summarise a page, propose tags, or fix a
title using it. Lore detects Ollama, it never ships it — absent, the panel says
so and nothing else changes.

## Connecting agents

### Any agent that reads files

**Connections → Write AGENTS.md** drops one file at your vault root: every page,
its folder, its tags, and a one-line summary. Any agent that reads files finds it
without being told to.

The generated map lives inside a `<!-- lore:begin -->` / `<!-- lore:end -->`
fence. Everything you wrote outside the fence is preserved verbatim, and a file
with no fence gets the map appended below what is already there — Lore never
overwrites a hand-written `AGENTS.md`.

### Agents that speak MCP

```json
{
  "mcpServers": {
    "lore": {
      "command": "node",
      "args": ["/path/to/lore/mcp/server.mjs"],
      "env": { "LORE_URL": "http://127.0.0.1:4646" }
    }
  }
}
```

Four tools, deliberately — an agent choosing between twenty-one overlapping tools
spends its budget choosing:

| Tool | What it does |
| --- | --- |
| `wiki_index` | The whole map: every page with path, folder, tags, one-line summary. Call it first |
| `wiki_search` | Keyword search with a snippet around each match |
| `wiki_read` | One page in full, plus the pages that link to it and the pages it links to |
| `wiki_health` | Orphans, dead links, pages past their review window |

**There is no write tool, no delete tool, no shell, and no `propose_edit`.** Not
because writing is forbidden — agents write with their own tools, and Lore
watches — but because a second write path would only make Lore's picture of the
vault disagree with the filesystem's.

Every call is journalled, which is what produces the Insights reports. The
zero-result searches are the valuable half.

### Anything else

Every surface the MCP server uses is a plain local HTTP endpoint. Full reference
in [DOCUMENTATION.md](./DOCUMENTATION.md#10-http-api).

```bash
curl -s localhost:4646/api/agent                    # the map, as markdown
curl -s "localhost:4646/api/search?q=pricing"       # search
curl -s "localhost:4646/api/review?days=7"          # triage + trust split
```

## What data lives where

Everything Lore keeps for itself lives in `~/.lore` (created `0700`), never in
your vault — so a journal entry or a pending verification never shows up in a
`git diff` of your notes.

| Path | What it holds |
| --- | --- |
| `~/.lore/config.json` | Which folders you linked and which one is open. Delete it and you are unlinked; the wiki is untouched |
| `~/.lore/usage.jsonl` | Append-only log of MCP tool calls: reads, searches and their hit counts, index pulls |
| `~/.lore/journal-<key>.jsonl` | Append-only write journal per vault: path, kind, lines added/removed |
| `~/.lore/shadow/<key>/` | A copy of each page as Lore last saw it, so the next write can be diffed and classified |
| `~/.lore/verified-<key>.json` | The verification ledger: page → hash, timestamp, who, optional note |
| `~/.lore/attribution.jsonl` | Which agent wrote which file. Only exists if you install the optional Claude Code hook |
| `~/.lore/models/`, `~/.lore/embeddings-<key>.json` | The local embedding model and the vectors built from your pages |

`<key>` is a short hash of the vault's absolute path, so two linked wikis never
share a journal or a ledger.

A filesystem watcher can see *what* changed but never *who* changed it. The
journal is therefore harness-agnostic and author-blind; attribution is a separate,
opt-in, single-harness addition, and everything in Review works without it.

Inside your vault, Lore writes exactly two things, both only when you ask:
`AGENTS.md` when you press the button, and pages you create or edit in the app
itself.

## Privacy

None of your wiki is uploaded. Lore is a local Next.js server talking to your own
filesystem; there is no account, no database, and no telemetry. The MCP server
talks to the app over `127.0.0.1`.

One exception, stated plainly: semantic search runs a small model on this machine,
and the first time it is used it downloads roughly 23MB of model weights into
`~/.lore/models`. Weights come down; no page content goes up. Everything after
that is offline, which is the whole reason the model is local — a corpus with
client names in it should not be shipped to an embedding API for a "related
pages" list.

Path traversal is blocked at the filesystem layer: every read and write resolves
against the vault root and is rejected if it escapes.

The shadow copies in `~/.lore/shadow/` are full copies of your pages. If your
vault is sensitive, that directory is too.

## What's in the box

```
app/            Next.js App Router — landing page, /vault app, /api routes
components/
  lore/         The app: onboarding, sidebar, folder document, review,
                insights, explore lenses, connections, settings
  marketing/    The landing page, the hero simulator, site chrome
lib/
  config.ts     ~/.lore/config.json — which folder is linked
  wiki.ts       Scanning, frontmatter, wikilinks, backlinks, search, health
  journal.ts    The filesystem watcher and the write journal
  verify.ts     The verification ledger and the triage ranking
  usage.ts      What agents read, and what they searched for and missed
  tokens.ts     Context budgeting with a real tokenizer
  similarity.ts Near-duplicate detection (MinHash + LSH)
  schema-check.ts  Frontmatter conformance against your own SCHEMA.md
  palette.ts    The eight-slot colour assignment
  markdown.ts   Rendering, wikilink and tag resolution
  embeddings.ts Local MiniLM vectors for semantic search and related pages
  ollama.ts     Detects a local Ollama and runs the three extraction tasks
  harness.ts    Reads and writes agent config files (MCP entry, Claude hook)
mcp/server.mjs  The MCP server (stdio, no dependencies)
electron/       Desktop shell — spawns the Next standalone server and frames it
                in a window. Packaging config in electron-builder.yml
docs/           Build log, competitive research, style options
```

## Credits

The visual language — the sky-framed hero, the fade-band closing section, the
two-surface light/dark token system, the squircle bullets, the eight-slot plate
palette — is adapted from [**Creed**](https://github.com/connorhpbrn/creed) by
Connor Hepburn, used under its MIT licence. Creed manages one context file; Lore
takes the same design sensibility to a whole wiki. If you want the single-file
version, use Creed — it is the better tool for that job.

Sky photography generated for this project. See
[docs/COMPETITIVE-RESEARCH.md](./docs/COMPETITIVE-RESEARCH.md) for the landscape
survey that shaped the feature set, and [docs/BUILD-LOG.md](./docs/BUILD-LOG.md)
for the record of what was built and why — including the approval gate that was
removed.

## Licence

MIT.
