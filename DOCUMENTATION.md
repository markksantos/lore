# Lore — technical documentation

Everything a maintainer needs: architecture, data model, API surface, design
system, and the constraints that shaped each.

---

## 1. Architecture

Lore is a single Next.js 16 app (App Router, React 19, Tailwind v4) that runs on
`localhost` and talks to the user's filesystem through the Node runtime. There is
no database, no auth, no cloud, and no build-time content step.

```
┌──────────────┐   HTTP    ┌────────────────────┐   fs    ┌─────────────┐
│  Browser UI  │ ────────► │  Next.js API route │ ──────► │ Your wiki   │
│  (/vault)    │           │  (node runtime)    │         │ (markdown)  │
└──────────────┘           └────────────────────┘         └─────────────┘
                                     ▲
                              JSON-RPC over stdio
                                     │
                           ┌─────────────────────┐
                           │  mcp/server.mjs     │ ◄── Claude Code, Cursor,
                           │  (5 tools)          │     Claude Desktop, Codex
                           └─────────────────────┘
```

The MCP server is a **client of the app**, not a second implementation. It holds
no filesystem logic of its own — it calls the same HTTP endpoints the UI does.
That is deliberate: two code paths to the same files is how a read tool and a
write tool end up disagreeing about what "the vault root" means.

### Why local-first

Every competitor surveyed either owns your data (Capacities, Bamboo) or owns your
folder layout (llm_wiki, llm-wiki-manager impose a `raw/` → `wiki/` skeleton).
Lore's wedge is that it adapts to the folder you already have. That forces
local-first: the moment there's a server, there's a sync story, an account, and a
reason to move your files.

---

## 2. Data model

### `WikiPage` (server, `lib/wiki.ts`)

| Field | Notes |
| --- | --- |
| `id` | Vault-relative path, no extension, POSIX separators. The stable key. |
| `relPath` | Vault-relative path with extension. |
| `title` | `frontmatter.title` → first `# H1` → filename, in that order. |
| `folder` | Vault-relative directory; `""` for root-level pages. |
| `tags` | Frontmatter `tags`/`tag` plus inline `#tags` found outside code. |
| `frontmatter` | Parsed YAML. Server-only — stripped before the client. |
| `excerpt` | First 240 chars of plain text. |
| `words`, `mtime` | For the health report and list rows. |
| `links` | Outgoing links **resolved to real page ids**. |
| `rawLinks` | Link targets exactly as written, pre-resolution. Server-only. |
| `plain` | Whole body as plain text. Server-only; search reads it. |

`rawLinks` exists because `links` is overwritten with resolved ids during
indexing. Without keeping the originals, a link that resolved to nothing would be
indistinguishable from no link at all — and the dead-link check would silently
always pass. (It did, until it was caught in QA. See the build log.)

`plain` is held in the index so search never re-reads the disk. A personal wiki
is a few MB of prose; paying that once per scan beats a file read per page per
keystroke.

### Link resolution

An `[[Exact/Path]]` match wins. Failing that, a **unique** basename match
resolves — this is how Obsidian's short `[[Page]]` form works. An ambiguous
basename is left unresolved rather than guessed, and shows up in the health
report as a dead link.

### `Proposal` (server, `lib/proposals.ts`)

Stored in `~/.lore/proposals.json`, namespaced per vault by a hash of the root so
two linked wikis never share a queue.

- `kind`: `create` | `append` | `replace`
- `risk`: `low` | `medium` | `high` — inferred from `kind` when the agent doesn't
  state it, and never inferred as benign: `replace` defaults to `high`.
- `base`: file content at proposal time, `null` for creates.

`base` powers a conflict check on accept: if the file changed on disk after the
proposal was made, accepting is refused rather than silently discarding whatever
the user wrote in between.

---

## 3. Path safety

Lore is an HTTP server with filesystem write access, so `resolveInVault()` is the
security boundary. Every read and write resolves the requested path against the
vault root and throws if the result escapes it:

```ts
const absolute = path.resolve(root, relPath);
if (absolute !== root && !absolute.startsWith(root + path.sep)) {
  throw new Error("Path escapes the vault.");
}
```

Verified: `GET /api/page?path=../../../../../etc/passwd` and
`PUT /api/page {"path":"../../../../../tmp/pwned.md"}` both return
`{"error":"Path escapes the vault."}` and write nothing.

---

## 4. HTTP API

All routes are `runtime: "nodejs"`, `dynamic: "force-dynamic"`. Errors return
`{ "error": "message" }` with a non-2xx status.

### Vault

| Method | Route | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/vault` | — | `{ vaults, activeVault, suggestions }` |
| `POST` | `/api/vault` | `{ action: "link", path }` | `{ vault }` |
| `POST` | `/api/vault` | `{ action: "activate" \| "unlink", root }` | `{ ok }` |

`suggestions` is only computed on first run (no vault linked). It probes seven
common locations and reports only those that exist *and* already contain
markdown — a suggestion the user has to verify is worse than no suggestion.

### Pages

| Method | Route | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/pages` | `?refresh=1` to force a rescan | full `VaultIndex` |
| `GET` | `/api/folder` | `?path=` (empty = vault root) | `{ folder, sections, incoming, totals }` |
| `GET` | `/api/page` | `?path=` | `{ page, frontmatter, raw, backlinks, outgoing }` |
| `PUT` | `/api/page` | `{ path, content }` | `{ ok, savedAt }` |
| `POST` | `/api/page` | `{ path, content }` | `{ ok, path }` — 409 if it exists |
| `DELETE` | `/api/page` | `?path=` | `{ ok }` |

`POST` opens with the `wx` flag, so creating never clobbers an existing note.

### Search, health, agents

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/search?q=` | `{ results: [{ page, score, snippet }] }` |
| `GET` | `/api/health` | the health report (below) |
| `GET` | `/api/agent` | the vault map as `text/markdown` |
| `POST` | `/api/agent` | writes that map to `AGENTS.md` at the vault root |

### Proposals

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/proposals` | — | `{ proposals: [...with diff stats] }` |
| `POST` | `/api/proposals` | `{ path, kind, content, reason, agent, risk }` | `{ proposal }` |
| `POST` | `/api/proposals` | `{ action: "accept" \| "reject", id }` | `{ proposal }` |
| `POST` | `/api/proposals` | `{ action, ids: [...] }` | `{ resolved, failures }` — the bulk form |

`/api/folder` returns every page in a folder *with its full source* in one
request, because the folder is the unit the user reads. Fetching bodies lazily
while they scroll would make the document assemble itself in front of them.

Bulk resolve runs sequentially, not in parallel: two accepts touching the same
file concurrently would both pass the conflict check and then race on the write.
Failures are collected rather than thrown, so one conflicting proposal doesn't
block the other nine.

---

## 5. Search ranking

Deliberately **not** fuzzy. On a personal wiki an exact-ish title match is almost
always the thing you meant, and fuzzy ranking buries it under coincidental body
hits.

| Signal | Score |
| --- | --- |
| Exact title match | +100 |
| Title starts with query | +60 |
| Title contains query | +40 |
| Tag contains query | +25 |
| Path contains query | +15 |
| Body contains query | +10 |

Ties break on `mtime`, newest first. Snippets are centred on the match, not taken
from the top of the page.

---

## 6. Health report

| Check | What it means |
| --- | --- |
| **Orphans** | No backlinks *and* no outgoing links. An agent walking your links never reaches them. |
| **Dead links** | A `[[link]]` target that matches no page. Each one is a page you meant to write. |
| **Stale** | Past its review window. |
| **Untagged** | The cheapest findability signal, missing. |

### Staleness windows

A single global threshold either screams about everything or catches nothing, so
the window is chosen by what the page is about — matched against its id and
title:

| Pattern | Window |
| --- | --- |
| `pricing`, `cost`, `rate`, `invoice` | 30 days |
| `client`, `project`, `status`, `roadmap` | 60 days |
| `tool`, `stack`, `version`, `setup`, `install`, `config` | 90 days |
| everything else | 180 days |

### Score

```
100
 − (orphans / pages) × 35
 − min(deadLinks / pages, 1) × 30
 − (stale / pages) × 20
 − (untagged / pages) × 15
```

Weighted so the two things that actually make a wiki unusable to an agent —
orphans and dead links — cost more than a missing tag.

---

## 7. Markdown rendering

`marked` with GFM, plus two pre-passes for syntax markdown doesn't own.

**Order matters.** Fenced blocks and code spans are masked out *first*, so a
`[[` inside a code sample isn't rewritten into a link and stops being the thing
it documents. The mask token is prefixed (`LOREMASK<n>`) rather than a bare
number, because an unprefixed numeric placeholder would also match a year or a
version in the prose and get corrupted on the way back out.

- **Wikilinks** resolve to the target's *title*, not its path — `[[stack/deploy-pipeline]]`
  reading as "Deploy pipeline" mid-sentence is the difference between a wiki and
  a file listing. An explicit `|alias` always wins. Unresolved links render with
  a dashed border: an unbuilt page is a to-do, not an error.
- **Inline tags** render as pills, matched only when preceded by whitespace or
  `(` so a `# heading` is never mistaken for one.
- **A leading `# H1` that repeats the page title is dropped**, since the title is
  already in the page header and rendering both makes every page look broken.

Raw HTML passes through, matching Obsidian. These are the user's own local files
rendered in their own browser — there is no untrusted author to sanitise against,
and stripping it would break every note that embeds a table or `<details>`.

---

## 8. Design system

Adapted from Creed (MIT). Tokens live in `app/globals.css` under `--lore-*`.

**Two-surface structure, both themes.** A page background, a raised surface, and
hairline borders — light mode on warm near-white (`#f9f9f8`), dark on near-black
(`#0e0e0d`) with foreground pulled off pure white so long reading stays easy.

**Action colour** is `#2563eb`, held constant across both themes — primary CTAs,
accept buttons, focus rings. Holding it fixed is what makes it read as *the*
brand colour rather than a theme variable.

**Plates** carry the product's colour identity. Eight slots (`--pal-1` … `--pal-8`)
— Creed's five plate hues plus three from the same family — assigned by stable
index in `lib/palette.ts`. Every folder and every page owns one, so a wiki reads
as a set of coloured objects rather than a grey file list.

Each slot has three values, because one colour cannot do all three jobs:

| Var | Job |
| --- | --- |
| `--pal-N` | saturated fill: solid panels, module frames, section rules, dots |
| `--pal-N-tint` | pale wash behind coloured type |
| `--pal-N-ink` | darker companion that stays legible *on* that tint |

Components set them as inline custom properties (`--plate`, `--plate-tint`,
`--plate-ink`) rather than class names, so one stylesheet rule serves all eight
slots and Tailwind never sees a dynamically-built class it would purge.

Folders take their slot by **position** (adjacent folders in the sidebar are
never the same colour); pages take theirs by **position within the folder**, for
the same reason. An earlier version hashed the page id, and two adjacent sections
promptly collided on the same colour — which is precisely what the colour exists
to prevent.

**Scenery fades** are the signature. Sky art is never cropped hard against the
page; it melts through a multi-stop eased gradient:

- `--scenery-fade-down` — melts art downward into the page (hero, onboarding).
- `--scenery-fade-band` — a matched pair of fades around a clear centre, framing
  the closing band so it joins both the section above and the footer below with
  no visible seam.

Stops are densely sampled along an ease curve; a naive three-stop gradient bands
visibly against a photographic sky.

**Type scale**: `.t-hero`, `.t-section`, `.t-step`, `.t-lede`, `.t-body`,
`.t-meta`. Nothing sets an ad-hoc font-size.

**Squircle bullets, never round dots** (`border-radius: 0.13em` on a `0.4em`
square) — the one detail that stops a markdown list reading as browser default.

### Art

Twelve assets in `public/assets/landing/scenery/` — six scenes, each a
`hero-N.png` / `hero-N-dark.png` pair. The dark version of each is the *same
composition at night*, produced by editing the light original rather than
generating separately, so the theme toggle reads as a change in time of day
rather than a swap between two unrelated pictures.

**One scene is picked per request** (`lib/scenery.ts`, `pickScene()`), so the
page greets you differently every visit without ever looking like a different
product. The roll happens on the server and is passed down as a prop: a
client-side roll would either mismatch the server's HTML during hydration or
leave the hero blank until after first paint. This is why `app/page.tsx` is
`force-dynamic` — the rotation is its only dynamic input.

The closing band **reuses whichever scene the hero drew**, anchored to the foot
of the image (`position="bottom"`) instead of its centre. The page therefore
always opens and closes in the same world, and there is no second set of assets
to keep in sync. Because that art is a saturated sky rather than the muted plate
the band used to carry, the closing headline is white over a radial wash — the
same treatment as the hero.

`SceneryImage` self-heals: if a file 404s it renders a labelled placeholder
naming the exact path to drop the art into, so a half-finished fork never ships a
silent blank band.

---

## 9. Motion

Four primitives in `lib/anim.ts` drive everything that moves. Nothing on the
page animates outside them, so the whole site shares one easing curve
(`EASE = [0.22, 1, 0.36, 1]`).

| Primitive | Job |
| --- | --- |
| `useInView` | Optimistic IntersectionObserver — reports `true` first |
| `useLoopSequence` | A looping step machine; `durations[i]` holds step `i` |
| `useTyped` | Character-by-character typing, clears on each loop |
| `useCountUp` | rAF count to a target, eased out |

Two rules they all obey:

- **Optimistic in-view.** `useInView` starts `true` and only pauses once the
  element has actually scrolled away. A demo frozen on frame zero because an
  IntersectionObserver callback never fired reads as a broken page — far worse
  than one that plays off-screen.
- **A resting frame, not frame zero.** Every looping demo declares a `restStep`
  — the frame that best explains the idea as a still. Under
  `prefers-reduced-motion` it parks there and never advances.

### The hero simulator

`components/marketing/hero-simulator.tsx` is a working replica, not a picture.
Folders switch, tabs switch, proposals accept and reject, accepted lines merge
into the page, counters decrement, and a Reset appears when the queue empties.
It runs entirely on local state — the marketing page demonstrates the review
loop instead of describing it.

### The compatibility wall

Which chips have a real brand mark is resolved **on the server**
(`lib/agents.ts` reads `public/assets/agents/`) and passed down. Letting each
chip probe with an `<img>` and fall back on error costs a 404 per tool per page
load and fills the console with failures that look like bugs.

Tools without an SVG render a palette-tinted monogram. That is deliberate: a
hand-drawn near-miss of someone's brand mark reads as broken, not as shorthand.
Drop a real SVG into `public/assets/agents/<slug>.svg` and the chip picks it up
with no code change.

### Layout note

Grid and flex items default to `min-width: auto`, so a single `nowrap` element
inside a demo card can prop an entire section open past the viewport — this
happened, and cost 27px of horizontal overflow at 375px. Demo cards therefore
carry `min-w-0 overflow-hidden`, and every grid that holds one carries
`min-w-0`.

## 10. MCP server

`mcp/server.mjs` — stdio JSON-RPC 2.0, zero dependencies. The protocol surface
needed is four methods (`initialize`, `tools/list`, `tools/call`, `ping`), so a
dependency would cost more than it saves.

Tool failures return a `result` with `isError: true` rather than a protocol
error, so the agent sees the message and can recover. The error text names the
likely cause — "Is Lore running?" — because a dead local server is the failure
mode 90% of the time.

`propose_edit`'s success message is written for the agent, not the human:

> The file has NOT been changed. Do not assume it was accepted.

Without that sentence, models reliably report the wiki as updated.

### Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `LORE_URL` | `http://127.0.0.1:4646` | Where the app is listening |
| `LORE_AGENT_NAME` | `MCP agent` | Name shown on proposals in the queue |

---

## 11. Known limitations

Stated plainly rather than discovered later:

- **The vault UI is desktop-only.** The sidebar is a fixed 15.5rem with no mobile
  drawer. Lore runs on the machine that holds the wiki, so a phone layout would
  be scaffolding for a scenario that doesn't exist. The landing page *is* fully
  responsive and verified free of horizontal overflow at 375/414/768px.
- **No file watcher.** The index caches for 4s and rescans on demand. Edits made
  in Obsidian while Lore is open appear on the next navigation, not instantly.
- **No image or attachment handling.** Markdown only.
- **Rename/move isn't exposed in the UI.** Create, edit, and delete are.
- **The diff is a common-prefix/suffix trim, not Myers.** Correct and free for
  the small, mostly-additive edits agents propose; a large reordering will render
  as one big remove followed by one big add.
- **Health scans the whole vault on every request.** Fine to a few thousand pages;
  it would need incremental indexing beyond that.
- **A folder document loads every page in that folder at once.** That is the
  right unit for a personal wiki, but a single folder holding many hundreds of
  pages would want virtualising.
- **The palette repeats after eight.** A folder with more than eight pages reuses
  colours further down the document. Adjacent sections still differ, which is
  what the colour is for.
