<div align="center">

# Lore

**The wiki for all your agents.**

Point Lore at the markdown folder you already have. It maps every page, resolves
every link, and hands your agents a readable index of everything you know —
without moving a single file.

</div>

---

## What it is

You already wrote it down. Your agents still ask.

Everything an agent needs to stop guessing is sitting in a folder on your disk —
your Obsidian vault, your `notes/` directory, the wiki you hand-rolled after
reading a Karpathy gist. It has no way in, and no way to give anything back.

Lore is a local app that sits on top of that folder and does three things:

1. **Reads it where it sits.** No import, no migration, no new format. Your
   headings, your frontmatter, your `[[wikilinks]]`, your folder names. Delete
   Lore tomorrow and the wiki is byte-for-byte what it was.
2. **Makes it legible to agents.** One `AGENTS.md` at the vault root for
   file-reading agents, and an MCP server with search/read/health tools for
   agents that speak it.
3. **Keeps the pen in your hand.** Agents cannot write. They *propose*, and the
   diff appears inside the page it would change — with a reason and a risk tier —
   right where you are already reading. Nothing lands until you accept it.

It is not a note-taking app. Keep writing in Obsidian, or vim, or whatever you
already use. Lore is the layer that makes the same folder useful to an agent.

## Quickstart

Requires **Node 20+**. Nothing else — no database, no account, no API key.

```bash
cd "path/to/lore"
npm install
npm run dev          # → http://localhost:4646
```

Open <http://localhost:4646>, click **Link your wiki**, and either paste a folder
path or pick one Lore already found on your machine. That's the whole setup.

## Connecting agents

### Any agent that reads files

In the app, go to **Connections → Write AGENTS.md**. This drops a single file at your
vault root: every page, its folder, its tags, and a one-line summary. It is the
only file Lore ever adds to your wiki, and it is regenerated wholesale each time
you press the button.

### Agents that speak MCP

The **Connections** tab shows a ready-to-paste config with the path already filled in
for your machine:

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

Five tools, deliberately:

| Tool | What it does |
| --- | --- |
| `wiki_index` | The whole map — call this first |
| `wiki_search` | Keyword search with snippets |
| `wiki_read` | One page, plus its backlinks and outgoing links |
| `wiki_health` | Orphans, dead links, stale pages |
| `propose_edit` | Queue a change for human review — **does not write** |

There is no write tool, no delete tool, and no shell.

### Anything else

Every MCP surface is a plain local HTTP endpoint. See
[DOCUMENTATION.md](./DOCUMENTATION.md#http-api) for the full reference.

```bash
curl -s localhost:4646/api/agent                    # the map, as markdown
curl -s "localhost:4646/api/search?q=pricing"       # search
```

## Why agents can't write directly

The edit that costs you isn't the obviously wrong one you'd catch. It's the
confident, plausible one you'd never look at twice — a version number quietly
bumped, a rate rewritten, a decision reversed. Citation drift is the worst kind,
because it manufactures false confidence in something you'll later rely on.

A diff and a one-line reason takes five seconds to read, and it is the only thing
standing between a useful wiki and a subtly false one. So proposals are the only
write path, and risk is inferred conservatively when an agent doesn't state it:
a `replace` on existing prose is `high` by default.

## What's in the box

```
app/            Next.js App Router — landing page, /vault app, /api routes
components/
  lore/         The app: onboarding, sidebar, folder document, page sections,
                connections, settings
  marketing/    The landing page, the product-shot replica, site chrome
lib/
  config.ts     ~/.lore/config.json — the only state outside your wiki
  wiki.ts       Scanning, frontmatter, wikilinks, backlinks, search, health
  proposals.ts  Proposals, bulk resolve, and the diff
  palette.ts    The eight-slot colour assignment
  markdown.ts   Rendering, wikilink and tag resolution
mcp/server.mjs  The MCP server (stdio, no dependencies)
docs/           Architecture, research, build log, colour options
```

## How the app is laid out

Three destinations, and one of them is the product.

**Wiki** — the sidebar lists your folders, each with its own colour. Pick one and
it opens as a *single scrolling document*: every page in that folder is a
coloured section, editable in place. A bar at the top shows the folder's whole
pending state — `+11 −0 · 2 proposals · Reject all · Accept all` — and each
individual proposal sits inside the section it would change, as a diff you accept
without going anywhere.

You do not open files. You read a folder.

**Connections** — how agents get in: write `AGENTS.md`, or copy the MCP config.

**Settings** — the linked folder, a rescan, and the health report.

## Privacy

Nothing is uploaded. Lore is a local Next.js server talking to your own
filesystem. The only state it keeps outside your wiki is `~/.lore/config.json`
(the folder path) and `~/.lore/proposals.json` (the pending queue) — deliberately
outside the vault so a pending proposal never shows up in a `git diff` of your
notes.

Path traversal is blocked at the filesystem layer: every read and write resolves
against the vault root and is rejected if it escapes.

## Credits

The visual language — the sky-framed hero, the fade-band closing section, the
two-surface light/dark token system, the squircle bullets — is adapted from
[**Creed**](https://github.com/connorhpbrn/creed) by Connor Hepburn, used under
its MIT licence. Creed manages one context file; Lore takes the same design
sensibility to a whole wiki. If you want the single-file version, use Creed — it
is the better tool for that job.

Sky photography generated for this project. See
[docs/COMPETITIVE-RESEARCH.md](./docs/COMPETITIVE-RESEARCH.md) for the landscape
survey that shaped the feature set.

## Licence

MIT.
