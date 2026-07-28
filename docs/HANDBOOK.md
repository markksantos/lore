# Lore — Engineering Handbook

The complete account: what was built, how it works, why it is shaped this way, and
what was got wrong on the way to here.

Written 27 July 2026, against commit `3730b62`. Every number in this document was
measured against the code or a real vault at the time of writing; where something
could not be verified it says so.

---

## Contents

1. [What Lore is](#1-what-lore-is)
2. [How it got here — three pivots](#2-how-it-got-here--three-pivots)
3. [The measurements that decided everything](#3-the-measurements-that-decided-everything)
4. [Architecture](#4-architecture)
5. [The security boundary](#5-the-security-boundary)
6. [Subsystems](#6-subsystems)
7. [The interface](#7-the-interface)
8. [Platforms](#8-platforms)
9. [Every bug found, and what it taught](#9-every-bug-found-and-what-it-taught)
10. [Decisions reversed](#10-decisions-reversed)
11. [Known limitations](#11-known-limitations)
12. [Working on it](#12-working-on-it)
13. [Appendix — verified constants](#13-appendix--verified-constants)

---

## 1. What Lore is

Lore is a local-first application that points at a folder of markdown you already
have — an Obsidian vault, a `notes/` directory, a hand-rolled wiki — and does three
things:

1. **Reads it where it sits.** No import, no migration, no new format. Your headings,
   frontmatter, `[[wikilinks]]` and folder names. Delete Lore and the wiki is
   byte-for-byte what it was.
2. **Makes it legible to agents.** One `AGENTS.md` at the vault root for agents that
   read files, and an MCP server with seven tools for agents that speak it.
3. **Keeps a record of what a human has actually checked.** Agents write freely.
   Everything lands unverified. You sign off on what you have read, and the sign-off
   is pinned to a content hash — so an agent rewriting a page you trusted revokes
   your sign-off automatically.

### The two things it is not

**It is not a note-taking app.** Keep writing wherever you write. Lore is the layer
that makes the same folder useful to an agent, and useful to you when you are
supervising one.

**It is not a gate.** There is no approval queue and no write tool. That was tried
and removed; [§10](#10-decisions-reversed) explains why in detail.

### The one-sentence version

*Obsidian is for a human writing notes. Lore is for a human supervising agents that
write notes.*

---

## 2. How it got here — three pivots

The build ran from 26 July 04:14 to 27 July 13:46 across 16 commits. It changed
direction three times, each time because a measurement contradicted the design.

### Round one — a Creed clone (`51ba865` → `c5f9fba`)

The brief was to take the product sensibility of [Creed](https://github.com/connorhpbrn/creed)
— a manager for a single AI context file — and aim it at a whole wiki.

What was taken: the design language. Token structure, the scenery-fade gradients,
the type scale, the squircle bullets, the hero/product-shot/finale page rhythm.
Creed is MIT licensed and is credited in the README.

What was rejected: the entire cloud spine. Creed is a Next.js SaaS with Supabase,
Stripe, auth, seats and OAuth. For a product whose pitch is *point it at your
folder*, a server is a liability — it immediately implies a sync story, an account,
and a reason to move the user's files.

The first attempt built an Obsidian-style file browser wearing Creed's paint:
a chevron tree, one file open at a time, and a separate Review tab. That was wrong.
Creed's app is a **single scrolling document of coloured sections**, and translating
that to a wiki means *a folder is the document*. Rebuilt in `5d293d2`.

### Round two — instrumentation (`dd5e39a`)

The product shipped with an MCP `propose_edit` tool that queued agent changes for
human approval. Testing it revealed the tool could not work — see
[§10](#10-decisions-reversed).

It was replaced with **promotion, not permission**, plus three primitives that only
Lore can produce because of where it sits: a write journal, a verification ledger,
and a usage sensor.

### Round three — a real application (`7abc6c0` → `3730b62`)

Everything after that was making it something a stranger could install: a security
boundary, a folder tree that survives 263 folders, desktop builds for three
operating systems, a mobile shell, a PWA, and paired remote access.

---

## 3. The measurements that decided everything

Almost every design choice here came from measuring a real 1,443-page vault rather
than reasoning about a hypothetical one. These are the numbers that mattered.

| Measurement | Value | What it decided |
| --- | --- | --- |
| Pages | 1,443 | Everything below |
| Total tokens | ~2.3M | No agent can read the wiki; the index must be a map, not a copy |
| Folders | 263 | A flat sidebar list is unusable; the tree exists because of this |
| Folders ≥3 levels deep | 236 | The tree must collapse, not just indent |
| Largest folder | 673 pages | The folder document had to paginate |
| Pages changed in 7 days | 303 | A gate becomes a 300-item queue → "Accept All" |
| Pages changed in 24h | 56 | The wiki is under constant agent modification |
| Modified files rewritten in place | 60 of 75 | Deletion, not addition, is the risk |
| Prose deleted unreviewed | ~1,450 lines / 15 days | Triage weights deletion highest |
| Pages with agent `confidence:` | 1,156 | 959 "high", 202 "medium", **2 "low"** |
| Pages with a human sign-off | **0** | The verification ledger is the missing primitive |
| Full vault scan | 82ms | Scanning was never the bottleneck |

The `confidence:` finding is the sharpest one. Agents grade their own work and
essentially always pass, so that field carries no information. Meanwhile nothing in
the corpus had ever recorded a human confirming anything. Every page looked
identically trustworthy whether you had checked it personally or an agent had
invented it at 3am.

---

## 4. Architecture

One Next.js 16 app (App Router, React 19, TypeScript strict, Tailwind v4) serving
two shapes, plus a standalone MCP server and an Electron wrapper.

```
                          ┌──────────────────────────┐
   your agents  ─ MCP ──► │  mcp/server.mjs          │
   (Claude Code,          │  4 read tools, no write  │
    Cursor, Codex)        └────────────┬─────────────┘
                                       │ HTTP, journalled
                                       ▼
   browser / Electron ──────► ┌─────────────────────┐      ┌──────────────┐
                              │  Next.js app        │ ───► │  your vault  │
   phone (paired, token) ───► │  proxy.ts guards    │  fs  │  (markdown)  │
                              │  17 API routes      │ ◄─── │              │
                              └──────────┬──────────┘ watch└──────────────┘
                                         │
                                         ▼
                              ~/.lore  — config, journal, ledger,
                                         usage log, shadow copies,
                                         embeddings, remote token
```

### Source inventory

| Area | Files | Lines |
| --- | --- | --- |
| `components/` | 34 | 12,090 |
| `lib/` | 25 | 4,373 |
| `app/` | 23 | 1,519 |
| `electron/` | 2 | 456 |
| `mcp/` | 1 | 251 |

### Nothing goes in your vault

All state lives in `~/.lore`, deliberately outside the wiki so a pending anything
never shows up in a `git diff` of your notes:

| File | Holds |
| --- | --- |
| `config.json` | Which folders are linked, which is active |
| `journal-<key>.jsonl` | Every write to the vault, with lines added/removed |
| `shadow/<key>/` | Previous copy of each page, so a diff can be computed |
| `verified-<key>.json` | The verification ledger, hash-pinned |
| `usage.jsonl` | Every MCP tool call: reads, searches, misses |
| `embeddings-<key>.json` | Vectors for semantic search |
| `remote.json` | Paired-access token, mode 0600 |

The one file Lore can write **into** the vault is `AGENTS.md`, and only when you
press the button — fenced with `<!-- lore:begin -->` so anything you wrote outside
the fence survives.

---

## 5. The security boundary

Lore reads and writes arbitrary folders on the machine it runs on. That is the whole
point locally and a remote file disclosure vulnerability anywhere else. The boundary
is therefore the most important code in the repo.

### Three layers

**1. Bind address.** `npm run dev` and `npm start` bind `127.0.0.1`. Next's default
is `0.0.0.0`, which — measured live during the build — put the vault on the LAN where
anyone on the same wifi could read it and re-link it to any path. That was a real
defect, not a theoretical one.

**2. `proxy.ts`.** One file guards all 30 filesystem routes. It rejects any filesystem request
whose `Host` header is not loopback, covering the cases the bind does not: a manual
`-H 0.0.0.0`, a container publishing the port, a reverse proxy in front.

Guarding here rather than per-route is deliberate: a guard you must remember
thirty times is a guard that gets forgotten once.

**3. Site mode.** `LORE_MODE=site` makes every filesystem route return 404 and
redirects `/vault` to `/install`. It is also **inferred** from `VERCEL`, `NETLIFY`,
`RENDER`, `FLY_APP_NAME`, `RAILWAY_ENVIRONMENT`, `AWS_LAMBDA_FUNCTION_NAME` and
`K_SERVICE` — so deploying this repo somewhere without reading the docs fails safe.
Exposing a filesystem requires a deliberate `LORE_MODE=local`, never a forgotten step.

### The one sanctioned hole

Paired remote access, off by default. Enabling it mints 32 bytes from
`crypto.randomBytes` into a `0600` file. Every remote request must carry it;
comparison is `crypto.timingSafeEqual`; failures are rate-limited per IP. The token
is only ever revealed to a loopback caller, and that endpoint reads the request body
*before* the host check so a remote caller cannot distinguish a malformed request
from a rejected one.

Verified end to end: enable leaks no token, wrong token 403s, correct token 200s,
rotate and disable both revoke immediately.

**What it is not:** this is plain HTTP over a local network. It stops a stranger on
the same wifi guessing their way in. It does not protect against someone who can
already read your network traffic.

### Path traversal

Every read and write resolves through `resolveInVault()`, which rejects any path
escaping the vault root. Verified: `GET /api/page?path=../../../../etc/passwd` and
the equivalent `PUT` both return `{"error":"Path escapes the vault."}` and write
nothing.

---

## 6. Subsystems

### 6.1 The scanner (`lib/wiki.ts`)

Walks the vault, parses frontmatter with `gray-matter`, extracts tags, links and
plain text. Skips `.git`, `.obsidian`, `.trash`, `.smart-env`, `node_modules`.

**Link resolution.** An exact `[[path/to/page]]` match wins. Failing that, a *unique*
basename match resolves — Obsidian's short `[[Page]]` form. An ambiguous basename is
left unresolved rather than guessed, and surfaces in the health report as a dead link.

**Why `rawLinks` exists.** `links` is overwritten with resolved ids during indexing.
Without keeping the originals, a link that resolved to nothing would be
indistinguishable from no link at all — and the dead-link check would silently
always pass. It did, until it was caught.

**Why `plain` is held in memory.** Search reads it, so it never re-reads disk. A
personal wiki is a few MB of prose; paying that once per scan beats a file read per
page per keystroke.

**Tag extraction is conservative.** Inline `#tags` must contain a lowercase letter,
which rejects hex ids, commit SHAs and `#IFDEF` while accepting `#stack` and
`#project/lore`. Inferred tags cap at 12 per page; frontmatter tags are exempt,
because silently dropping what someone typed is worse than a long list.

### 6.2 The write journal (`lib/journal.ts`)

Watches the vault with `chokidar` and records every change: created, appended,
rewritten or deleted, with lines added and removed.

**Harness-agnostic by design.** It observes the filesystem, so it captures Claude
Code, Cursor, a shell script, Obsidian and your own hand equally. Nothing opts in,
so nothing can quietly opt out.

**Hash-authoritative.** A filesystem event is a *hint to go and re-hash*, never a
fact. The events genuinely lie: chokidar throttles `change` at 50ms with no trailing
event, so the last write in a burst can be dropped, and Windows libuv uses a 4KB
buffer whose overflow surfaces only as a null filename. A 90-second reconcile sweep
backstops the stream.

**Append vs rewrite.** "Appended" means every prior line still exists in order at the
top — the safe kind. Anything altering or dropping prior lines is a rewrite, which is
what deserves attention.

### 6.3 The verification ledger (`lib/verify.ts`)

Four trust states, computed from the ledger and the page's current content hash:

| State | Meaning |
| --- | --- |
| `verified` | Signed off, and the content still matches |
| `lapsed` | Signed off, but rewritten since |
| `aging` | Signed off more than 120 days ago |
| `unverified` | Never checked |

**Why the hash is of plain text, not the raw file.** A verification survives an agent
bumping `updated:` in frontmatter, but lapses the moment the prose changes.
Otherwise every automated metadata rewrite would silently invalidate work you did.

**Lapsed beats unverified** in triage ranking, because a page you once checked and an
agent has since rewritten is more alarming than one you never checked — you are
carrying a belief that may no longer hold.

### 6.4 Triage

Ranks the week's changes so you review five things instead of three hundred:

```
score = linesRemoved × 3          deletion is the unrecoverable outcome
      + linesAdded × 0.2          additions are cheap
      + log2(inbound + 1) × 8     blast radius, damped
      + 25 if lapsed / 10 if unverified
      + 12 if rewritten in place
```

Inbound links are log-damped because the difference between 2 and 20 inbound links
matters far more than 200 versus 400. Pure additions to pages nobody links to score
near zero — which is correct, because that is the bulk of 300 weekly changes and none
of it needs you.

### 6.5 The usage sensor (`lib/usage.ts`)

Every MCP tool call posts to `/api/mcp-event`, fire-and-forget so telemetry never
delays an agent's answer. Two reports come out of it:

- **What agents read.** Most pages in a large wiki are never opened again after
  being written. Knowing which ones carry the weight tells you what to keep sharp.
- **What agents could not find.** A search returning *nothing* is logged as a gap —
  a question your wiki failed to answer, which is a page worth writing. This is a
  to-do list generated from real demand rather than guesswork.

Only zero-result searches count as misses. A one-result search that answered the
question is a success, and treating it as a near-miss would bury real gaps in noise.

### 6.6 Context budget (`lib/tokens.ts`)

Counts the corpus with a real BPE tokenizer, not chars ÷ 4. The estimate is fine in
aggregate and wrong exactly where it matters: markdown is dense with punctuation,
paths and code, all of which tokenize far worse than prose. Being told a folder fits
when it does not is the one failure this feature exists to prevent.

### 6.7 Search

**Literal first.** Exact title 100, title prefix 60, title contains 40, tag 25, path
15, body 10. Deliberately not fuzzy: on a personal wiki an exact-ish title match is
almost always what you meant, and fuzzy ranking buries it under coincidental hits.

**Semantic second, and strictly additive.** Embeddings run on-device
(`all-MiniLM-L6-v2`, ~23MB, Apache-2.0). Results are labelled *related* and rank
below every literal hit, because a vector neighbour is a suggestion, not a match.

The floor is **0.30**, chosen from measurement:

```
TRUE  "how do I undo a deploy"   0.454     FALSE "banana pancakes"          0.140
TRUE  "when do we ship"          0.413     FALSE "my cat is asleep"         0.095
TRUE  "reverting a release"      0.368     FALSE "photosynthesis in ferns"  0.043
TRUE  "what database are we on"  0.154  ← and it ranked the WRONG page first
```

MiniLM is symmetric — trained on sentence pairs, not query-to-document retrieval — so
its absolute scores are uncalibrated. 0.30 separates every query it gets right from
every one it does not. The fourth case falls below the floor, and that is correct:
returning nothing beats returning a confident wrong answer in a tool whose premise is
knowing what to trust.

**Calibration caveat:** those numbers come from a nine-page fixture. Enough to prove
nonsense is rejected; nowhere near enough to tune a boundary. Re-measure on a few
hundred real pages before moving it.

### 6.8 The MCP server (`mcp/server.mjs`)

Four tools, stdio JSON-RPC 2.0, zero dependencies: `wiki_index`, `wiki_search`,
`wiki_read`, `wiki_health`. No write tool, no delete tool, no shell.

Four tools rather than twenty-one because an agent choosing between twenty-one
overlapping tools spends its budget choosing.

Tool failures return a result with `isError: true` rather than a protocol error, so
the agent sees the message and can recover. The error text names the likely cause —
"Is Lore running?" — because a dead local server is the failure mode most of the time.

### 6.9 Local models

**Embeddings** run in-process via transformers.js. **Generation** delegates to
Ollama — detected, never bundled, because Ollama is 1.49GB on Windows and LM Studio's
licence prohibits redistribution. Verified against a real machine: 8 models detected,
`gemma4:12b-mlx` recommended from the actual installed list rather than a guess.

Local models are **not** here to understand your wiki better than Claude does — they
cannot. They are here to compute what the UI needs, instantly and offline, over a
corpus that may contain client names and financials.

---

## 7. The interface

### Six destinations

| | What it is for |
| --- | --- |
| **Wiki** | Reading. A folder opens as one scrolling document of coloured sections |
| **Review** | What agents changed, ranked, and signing off on what you checked |
| **Insights** | What agents read, what they could not find, what it costs to hand over |
| **Explore** | Seven lenses: Browse, Graph, Map, Timeline, Compare, Duplicates, Schema |
| **Connections** | How agents get in — `AGENTS.md` and MCP config |
| **Settings** | The linked folder, health, remote access, local models |

### The reading layout

Three columns from `xl`, two from `lg`, one below:

- **Left rail** — the pages in this folder as a jump list, active one highlighted
- **Centre** — the document, held at a ~700px measure
- **Right rail** — everything connected to the section in view: edited, words, links
  in and out, tags, backlinks, outgoing links, semantically related pages

The measure stays at 700px because that is where prose is readable. Widening it to
fill a 2000px monitor would trade a real reading benefit for the appearance of
density; filling the gutters with context was the better trade.

Both rails follow a scroll spy that picks the topmost section past the upper quarter
of the viewport, **not** IntersectionObserver's most-visible: with sections of very
different lengths, most-visible keeps a long section selected while you are plainly
reading the short one after it.

### Design system

Adapted from Creed under MIT. Tokens in `app/globals.css` under `--lore-*`.

- **Two-surface structure** in both themes: page background, raised surface,
  hairline borders. Warm near-white `#f9f9f8` light; near-black `#0e0e0d` dark with
  foreground pulled off pure white so long reading stays comfortable.
- **Action colour** `#2563eb`, held constant across both themes. Holding it fixed is
  what makes it read as *the* brand colour rather than a theme variable.
- **Eight palette slots** carrying the product's colour identity. Every folder and
  page owns one, assigned by **position** — an earlier version hashed the page id and
  two adjacent sections promptly collided, which defeats the entire point.
  Each slot has three values: a saturated fill, a pale tint, and a darker ink that
  stays legible *on* that tint.
- **Scenery fades** are the signature. Sky art never crops hard against the page; it
  melts through a densely-sampled eased gradient, because a naive three-stop gradient
  bands visibly against a photographic sky.
- **Section marker is a short pill**, not a full-height rule. A rule spanning the
  whole section turns a long page into a stack of bracketed blocks.
- **Squircle bullets, never round dots.**

### The landing page

Six rotating sky scenes, one picked per request, each a light/dark pair of the same
composition at two times of day — the dark version edited from the light original so
the theme toggle reads as a change in time of day rather than two unrelated pictures.
The closing band reuses whichever scene the hero drew, anchored to its foot.

The hero is a **working simulator**, not a screenshot: trust bar moves, sign-off
promotes, a simulated agent rewrite lapses it. Rendered at the app's real type scale
(26px folder title, 18px section titles, 15px body) inside real macOS window chrome.
An earlier version squeezed the same content into 11–14px and read as a *diagram of*
a product rather than the product.

---

## 8. Platforms

| Platform | How | State |
| --- | --- | --- |
| Web | `npm run dev`, 127.0.0.1:4646 | Works |
| macOS | `npm run dist:mac` → dmg, arm64 + x64 | Builds, verified |
| Windows | `npm run dist:win` → nsis, x64 | Configured |
| Linux | `npm run dist:linux` → deb + AppImage | deb builds; AppImage needs Linux |
| Mobile | PWA, installable, off-canvas drawer | Works |
| iOS | Paired remote client, as a PWA | Works |

### Desktop

Electron spawns the Next standalone server as a child process on a free port, waits
until the port answers before creating the window, and kills the child on every exit
path. Those are the two classic Electron-Next failures: a window against a dead
server, and an orphaned server holding a port.

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload
exposes four named members and no generic `ipcRenderer` passthrough.

Verified by booting the server *from inside the packaged bundle* and curling it —
`/`, `/vault` and `/api/pages` all answer, bound to 127.0.0.1.

### Why iOS cannot be a native app

Lore's four load-bearing capabilities against what iOS permits:

| Capability | iOS |
| --- | --- |
| Reads the folder your wiki lives in | Sandboxed; your wiki is not on your phone |
| Runs an MCP server | No long-lived background servers |
| Watches the filesystem | Nothing to watch |
| Runs a Node server | No Node runtime |

A native iOS "Lore" would share the name and nothing else. The honest answer is a
paired remote client that talks to the machine which *has* the wiki, installed as a
PWA — no App Store, no review.

### The service worker

Caches the app **shell only**. Everything under `/api/` is network-only, because
caching a live filesystem would show people stale wiki content without telling them.

---

## 9. Every bug found, and what it taught

Catalogued because the pattern matters more than the individual fixes.

| Bug | Why it mattered |
| --- | --- |
| Dead-link detection silently always passed | Re-extracted links from plain text, where wikilinks had already been stripped. The health panel confidently reported "every link resolves" on a vault with a deliberate broken link. **The dangerous class: a feature that looks like it works.** |
| Trust computed from a stale cache | A page stayed "verified" after an agent rewrote it — the exact failure the feature exists to prevent. The scan cache had no way to learn about writes Lore did not make. |
| `Write AGENTS.md` destroyed hand-written files | Aimed squarely at the target user: anyone following the llm-wiki pattern already keeps one. Now fenced. |
| Markdown mask token corrupted prose | Code fences were masked with a bare numeric placeholder and restored with `/ (\d+) /g`, which also matches any year or version in the body. |
| Semantic search dead on this machine | transformers.js statically imports `sharp` pinned `^0.32`, whose binary comes from a postinstall script. `ignore-scripts` in `~/.npmrc` — a common hardening default — left it unbuilt. |
| 262 folders in a flat list | 236 of them three levels deep. The single thing that made the app feel like a toy. |
| `window.lore` had zero consumers | The Electron preload exposed a cross-platform folder picker and nothing called it, so the desktop app had no picker at all off macOS — while the install page said it did. |
| `viewport-fit=cover` missing | Every `env(safe-area-inset-*)` in the mobile shell resolved to 0. The safe-area handling was decorative. |
| `DesktopOnlyNotice` was a dead export | The graph still drew 1,443 nodes into a 310px canvas on a phone, despite a comment claiming otherwise. |
| 3 of 4 desktop artifacts shipped the stock icon | `build/icon.png` landed after they were packaged. |
| Inline tags matched hex identifiers | 71 junk tags of 195 on the real vault; one log file carried 43. |
| Escape-to-cancel lost in the editor swap | A silent regression in a destructive direction — textarea → CodeMirror dropped the cancel path. |
| 27px horizontal overflow at 375px | Grid items default to `min-width: auto`, so one `nowrap` element in a demo card propped an entire section open. |
| Server predating the build by 8 minutes | `pkill -f "next start"` never matched, because the running process is named `next-server`. Several rounds of testing were against stale code. |

### The pattern

Three of these — dead links, trust caching, `window.lore` — were features that
**appeared** to work. They shipped a comment or a UI string asserting a behaviour
that the code did not have. That is the failure mode worth guarding against, and it
is why the verification passes in this build were told to hunt for dishonest claims
as a first-class category rather than as a style note.

---

## 10. Decisions reversed

### The approval gate

**What it was.** An MCP `propose_edit` tool. Agents proposed changes; the change
landed in a Review queue as a diff with a reason and a risk tier; nothing touched the
vault until a human accepted.

**Why it was removed.** Three reasons, in increasing order of severity:

1. **It was unenforceable.** Demonstrated directly: a plain `Write` to a page in the
   vault succeeded and Lore did not notice. The wiki is a folder, so every tool on
   the machine can write to it. `propose_edit` was opt-in politeness competing with
   every agent's built-in write tool, and it lost.
2. **It was redundant.** Claude Code already asks permission before editing files. It
   was a second, weaker permission layer on top of one that already works.
3. **Even a perfect gate would fail.** At 303 changed pages per week, a gate produces
   a 303-item queue. The documented outcome of a queue that size is "Accept All" —
   which manufactures confidence and is therefore *worse* than no gate.

**What replaced it.** Promotion, not permission. Nothing is blocked. Lore watches the
filesystem instead, which captures every harness equally, ranks what happened by how
much it could cost, and records what a human actually checked.

### Semantic search as the product

An intermediate position held that the missing piece was retrieval — that literal
search failing on "how do I undo a deploy" was the core defect. That was also wrong,
for the same underlying reason: **frontier models already understand this wiki better
than any local model will.**

The consistent error in both reversals was trying to make Lore do the *thinking*,
when Claude already does the thinking. Lore's job is the part an agent in a terminal
cannot do: show you things, and keep the record.

Semantic search still ships — it is genuinely useful, and it is strictly additive to
literal search. It is a feature, not the thesis.

### A relative-only semantic threshold

Briefly, the semantic floor was lowered and paired with a purely relative cutoff.
It matched "banana pancakes" to a page about weekly scheduling, because **a relative
gate always returns something.** Reverted; the reasoning is in the source so nobody
re-attempts it.

---

## 11. Known limitations

Stated plainly rather than discovered later.

**Not signed.** No code signing is configured. macOS asks the user to approve the app
in System Settings; Windows SmartScreen warns. Fixing this needs an Apple Developer
membership (a free personal team cannot issue a Developer ID) and a Windows
certificate. This is the single largest gap before a general audience.

**AppImage cannot be built on macOS.** The bundled `mksquashfs` is a Linux ELF. The
`.deb` builds fine; AppImage needs a Linux machine or Docker.

**The semantic threshold is calibrated on nine pages.** See [§6.7](#67-search).

**The graph is desktop-only.** It says so on a phone rather than drawing 1,443 nodes
into a 310px canvas.

**No file watcher on the index cache beyond 90 seconds.** Edits made externally
appear on the next navigation or within the reconcile window, not instantly.

**The folder document paginates at 40 pages.** Correct for a 673-page folder, but it
means "the whole folder as one document" is really "the 40 most recently edited."

**Duplicate detection uses MinHash + LSH.** Research indicated roughly 28% of top
similarity hits on a real corpus are template artifacts — two pages sharing a house
structure. Treat its output as candidates, not findings.

**Remote access is plain HTTP.** It stops a stranger on your wifi guessing a token.
It does not protect against someone reading your network traffic.

**The palette repeats after eight.** A folder with more than eight pages reuses
colours further down the document. Adjacent sections still differ, which is what the
colour is for.

---

## 12. Working on it

```bash
npm install
npm run dev          # 127.0.0.1:4646
npm run build
npx tsc --noEmit

npm run dist:mac     # dmg, arm64 + x64
npm run dist:win     # nsis, x64
npm run dist:linux   # deb + AppImage (AppImage needs Linux)

LORE_MODE=site npm run build && LORE_MODE=site npm start   # the public site
```

### Conventions that are not negotiable

1. **Colours come from tokens.** `var(--lore-*)`, or `paletteVars(i)` with `.plate`,
   `.pal-dot`, `.pal-bar`, `.pal-title`, `.pal-chip`. Never raw hex, never Tailwind
   palette colours.
2. **Both themes, always.** No hardcoded white or black backgrounds.
3. **`min-w-0` on flex and grid children.** Grid items default to `min-width: auto`;
   one `nowrap` descendant will prop a whole section past the viewport.
4. **Comments explain WHY.** Not what the code does — why it does it that way, and
   what the alternative cost.
5. **Never claim a capability that is not implemented.** In a comment, a UI string,
   or a doc. Three real bugs in this build were features that only *appeared* to work.

### Verifying a change

Kill by port, not by process name — the running Next process is called `next-server`,
so `pkill -f "next start"` silently misses it and you will test stale code:

```bash
lsof -ti:4646 | xargs -r kill -9
```

Then check: `tsc` clean, `npm run build` clean, all six views render, no console
errors in light *and* dark, no horizontal overflow at 375 / 768 / 1440.

---

## 13. Appendix — verified constants

Read from source at time of writing.

| Constant | Value | Where |
| --- | --- | --- |
| Palette slots | 8 | `lib/palette.ts` |
| Verification decay | 120 days | `lib/verify.ts` |
| Triage: deletion weight | × 3 | `lib/verify.ts` |
| Triage: addition weight | × 0.2 | `lib/verify.ts` |
| Triage: blast radius | log2(inbound+1) × 8 | `lib/verify.ts` |
| Semantic floor | 0.30 | `lib/embeddings.ts` |
| Search: exact title | +100 | `lib/wiki.ts` |
| Search: title prefix | +60 | `lib/wiki.ts` |
| Search: title contains | +40 | `lib/wiki.ts` |
| Search: tag match | +25 | `lib/wiki.ts` |
| Search: path match | +15 | `lib/wiki.ts` |
| Search: body match | +10 | `lib/wiki.ts` |
| Staleness: pricing | 30 days | `lib/wiki.ts` |
| Staleness: clients/projects | 60 days | `lib/wiki.ts` |
| Staleness: tooling | 90 days | `lib/wiki.ts` |
| Staleness: default | 180 days | `lib/wiki.ts` |
| Inline tag cap | 12 per page | `lib/wiki.ts` |
| Folder page size | 40 | `app/api/folder/route.ts` |
| Journal reconcile | 90s | `lib/journal.ts` |
| Index cache TTL | 4s | `lib/wiki.ts` |

### The other documents

| Document | Covers |
| --- | --- |
| `README.md` | What it is, quickstart, connecting agents |
| `DOCUMENTATION.md` | Architecture and full HTTP API reference |
| `DEPLOY.md` | The two shapes, and verifying a deployment is locked down |
| `docs/BUILD-LOG.md` | Chronological record, including designs later replaced |
| `docs/COMPETITIVE-RESEARCH.md` | The landscape survey that shaped the feature set |
| `electron/README.md` | Desktop packaging, per platform |

### Credits

Design language adapted from [Creed](https://github.com/connorhpbrn/creed) by Connor
Hepburn, MIT. Creed manages one context file; Lore takes the same sensibility to a
whole wiki. If you want the single-file version, use Creed — it is the better tool
for that job.

Sky photography generated for this project. Lore is MIT licensed.

---

## 14. The fifty

A later pass added fifty capabilities in thirteen commits. They are grouped here
by what they are for rather than by the order they were built, because the order
was an artefact of which ones shared a dependency.

**The agent surface.** `wiki_write` (attributed, lands unverified, append by
default), `wiki_changes` (catch up in one call instead of re-reading the corpus),
`wiki_context` (`/api/pack` — the best N tokens on a subject, split at headings,
picked greedily by score-per-token, every passage citing its page). MCP over HTTP
at `/api/mcp` for clients that cannot spawn a process. Per-agent bearer tokens
with roles and folder scopes, stored hashed and shown once.

**Trust.** Page history with rollback and history search — the journal knew a
page had lost 400 lines and could never give them back. Quarantine, which is the
half of trust Lore can actually enforce: it cannot stop an agent writing, but it
decides what it hands over. Section-level sign-off, keyed by heading. Editable
review windows per vault. A decay forecast. Attribution finally joined onto
Review, having been written and read by nothing since the Claude Code hook
shipped.

**Retrieval.** BM25 with PageRank authority, replacing literal phrase matching
that scored zero on "postgres backup" against a page saying "backup of the
postgres cluster". Aliases, so renaming a page stops silently shredding the link
graph. Link suggestions, masked against code, headings and existing links.

**Analysis.** Contradiction detection (narrow and numeric — an LLM asked to do
this across 1,400 pages confabulates). Confidence calibration against what humans
actually confirmed. Gap clustering over the miss log. Orphan rescue. Corpus value
and a health trend sampled at most daily.

**Authoring.** Templates and daily notes, slash commands, inline rewrite,
dictation, attachments by content hash, mermaid and maths, a per-page outline.

**Ingestion.** Web capture, PDFs, transcripts grouped by speaker, and git for
repo-backed wikis.

**Platform.** A CLI that reimplements nothing and starts its own server, a CI
action that can fail a pull request, comments, an activity feed, webhooks.

The pattern worth carrying forward is in the bugs, not the features. Four of them
— dynamic imports resolving into a torn-down effect, sections split from
markdown-stripped text, a `??` swallowed by a ternary, an orphaned `next-server`
holding port 4646 — all shipped looking correct and were caught only by running
the thing and measuring the result. None would have survived a careful reading,
because a careful reading is what produced them.
