# Build log

A record of what was built, what was decided, and what went wrong. The three
rounds were written during the build, not reconstructed after it; the closing
section is explicitly marked as the exception.

Built 2026-07-26 and 2026-07-27.

---

# Round one — the first build

Everything in this section describes the **original** design. Rounds two and
three replaced most of it. It is kept because the reasoning is the record, but
nothing here should be read as how Lore works now.

## Brief

Clone the product sensibility of [Creed](https://github.com/connorhpbrn/creed) —
its UI, its landing page, its simplicity — but aim it at a whole **wiki** rather
than a single context file. New name, new sky art. Research the existing players
first. Store it properly under `~/Developer`.

## Source study

Cloned `connorhpbrn/creed` and read it rather than guessing at it.

**What Creed actually is:** a Next.js 16 SaaS — Supabase, Stripe, Clerk-style
auth, an MCP server with OAuth 2.1, company workspaces, seat billing. Some single
components run to 170KB. The polish is real and the design system is unusually
well documented in `app/globals.css`.

**What was taken:** the design language only — the token structure, the scenery
fade gradients, the type scale, the squircle bullets, the hero/product-shot/
finale-band page rhythm, and the propose→approve interaction model. Creed is MIT
licensed and is credited in the README.

**What was rejected:** the entire cloud spine. Supabase, Stripe, auth, seats,
OAuth, credits. For a product whose pitch is "point it at your folder", a server
is a liability — it immediately implies a sync story, an account, and a reason to
move the user's files.

## Naming

**Lore** — one syllable, a noun meaning the accumulated body of what is known.
Parallel to Creed (a body of belief) without echoing it.

## Research

A background agent surveyed all nine briefed products plus two that weren't on
the brief. Full report in [COMPETITIVE-RESEARCH.md](./COMPETITIVE-RESEARCH.md).
The findings that changed the build:

| Finding | What it changed |
| --- | --- |
| Only 1 of 9 briefed products ships MCP. Obsidian has no official MCP. | MCP moved from nice-to-have to a launch requirement. |
| Nobody has built the trust layer between an agent and a wiki it can write to. Six documented drift types; citation drift is worst. | **The review queue became the product**, not a feature. Removed the write tool entirely. |
| Everyone imposes a folder skeleton (`raw/` → `wiki/`). | Lore infers structure instead. Zero required layout. |
| Staleness has no clock anywhere in the field. Different content rots at different rates. | Per-kind staleness windows (30/60/90/180 days) rather than one global threshold. |
| ~150–200 pages is where an agent stops holding `index.md` in context and starts duplicating. | The generated map is a compact one-liner per page, not full content. |
| Logseq 2.0 moved canonical data into SQLite; file-based Logseq is maintenance-only. | Confirms the "your files stay files" wedge. Used on the landing page. |
| Wikiwise — the closest thing to this brief — shipped 8 releases in 12 days and died in April. llm_wiki shipped 54 and took 15k stars. | Scope kept deliberately small so it's maintainable. |

Explicitly **not** built, on the research's advice: a graph algorithm, a rich
text editor, a bundled AI assistant, a custom data model, a bottomless ingest
pipeline.

## Art

Four assets, generated with nano-banana (Gemini 3 Pro Image), 16:9, 2K, resized
to 1672px.

The light hero was generated twice — the first pass came back too pale in the
upper third, and the hero headline is white. The second pass specified "rich,
deep saturated cerulean filling the top two thirds", which holds the type.

The dark twins were produced by **editing** the light originals ("convert this
exact scene to night, keep the identical composition") rather than generating
separately, so the theme toggle reads as a time-of-day change on one photograph
instead of a swap between two unrelated images.

## What was built

- Landing page: hero, product-shot replica, problem, how-it-works, health,
  steps, FAQ, finale band, footer. Light and dark.
- Vault app: onboarding, sidebar with folder tree + search, reader with resolved
  wikilinks and backlinks, markdown editor, review queue, health report, agents
  wiring screen.
- Engine: scanning, frontmatter, wikilink/backlink resolution, ranked search,
  health scoring, agent index generation.
- MCP server: 5 tools, stdio, zero dependencies.
- HTTP API: 7 route files.

---

## Bugs found and fixed during QA

### 1. Dead-link detection silently always passed

`health()` re-derived link targets by running `extractLinks()` over `page.plain`
— but `plain` is the *plain text* rendering, in which `toPlainText()` has already
replaced `[[target]]` with its label. There were no wikilinks left to find, so
`unresolved` was always `[]`.

This is the dangerous class of bug: the demo vault had a deliberate
`[[missing-page]]` link, the health panel rendered "Every link resolves", and it
looked like a passing feature.

**Fix:** added `rawLinks` to `WikiPage`, capturing targets before resolution
overwrites `links`. Verified: `missing-page` now reports as a dead link from
`stack/postgres-notes`.

### 2. Markdown mask token corrupted prose

Code fences were masked with a bare ` <n> ` placeholder and restored with
`/ (\d+) /g`. That regex also matches any standalone number in the body — a year,
a version, a price — and would replace it with a code block.

**Fix:** prefixed token (`LOREMASK<n>`).

### 3. Every page rendered its title twice

Notes almost always open with `# Their Own Title`, which then rendered below the
page header showing the same string.

**Fix:** `stripLeadingTitle()` drops a leading H1 when it matches the title.

### 4. Wikilinks rendered as raw paths

`[[stack/deploy-pipeline]]` rendered as the literal path mid-sentence, which
reads as a file listing rather than a wiki.

**Fix:** resolved links now render the target page's title; explicit `|alias`
still wins.

### 5. Real client names in the public landing page

The product-shot replica was seeded with real client names and real pricing rules
as placeholder content. That would have shipped to a public marketing page.

**Fix:** replaced with generic sample content. Noted in the component so it isn't
reintroduced.

### 6. Mobile headline overflow risk

`whitespace-nowrap` on "for all your agents" was edge-to-edge at 420px and would
overflow below that.

**Fix:** `md:whitespace-nowrap` — the two-line lockup holds on tablet and up, and
wraps below. Verified no horizontal overflow at 375/414/768px.

---

## Investigated and dismissed

**Hydration mismatch on the landing page.** Playwright reported "Hydration failed
because the server rendered text didn't match the client" on every landing-page
shot against the dev server. Rather than guess, both servers were tested
side by side:

```
http://localhost:4646 (dev)  — 4 errors  (script-tag warning + hydration, both schemes)
http://localhost:4747 (prod) — 0 errors
```

Dev-only, originating in Next's own `SegmentViewNode` dev instrumentation. No
application code change. Production is clean in both light and dark.

---

## Verification performed

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean, 10 routes |
| Path traversal — `GET` and `PUT` with `../../../etc/passwd` | both rejected, nothing written |
| Propose → queue → accept → file written | verified on disk |
| Double-accept | rejected: "Proposal was already resolved." |
| Risk inference | `replace` → high, `append` → medium, `create` → low |
| Queue ordering | pending first, highest risk first |
| MCP `initialize` / `tools/list` / `tools/call` | all respond correctly |
| MCP `propose_edit` | proposal appears in queue, file unchanged |
| Console errors, production, light + dark | zero |
| Horizontal overflow at 375 / 414 / 768px | none |

QA ran against a synthetic 8-page demo vault, **not** the real wiki on this
machine — that vault contains client names and financial detail, and this session
was screen-recorded.

---

# Round two — the rebuild

Mark reviewed round one and rejected it on two counts: the design wasn't
anywhere near as colourful as Creed's, and the app didn't work the way it should.
Both were correct.

## Diagnosis

Rather than reason from the text I'd scraped, I rendered Creed's saved landing
page with Playwright and screenshotted their app demo at 2x. That settled it.

**Colour.** I had copied Creed's plate variables into my stylesheet
(`--plate-proposal: #4f9eff`, `--plate-direct: #ff9c5e`, …) and then never used
them. Their stat blocks are solid saturated panels with white type; every
how-it-works module sits inside a thick colour frame; there are fifteen accent
tints because every section of the file owns a colour. I shipped neutral cards,
hairline borders and one green accent.

**Shape — the real miss.** Creed's app is a *single scrolling document*. Sidebar
is three items (File / Connections / Settings) plus a Sections list with coloured
dots. The main pane stacks sections down one page, each with a coloured left rule
and coloured title, editable inline, with one global
`+11 −0 · 1 proposal · Reject all · Accept all` bar at the top and individual
proposals appearing *inside the section they change*.

I had built a file explorer: chevron folder tree, click a file, it opens in a
pane, proposals live in a separate Review tab. That is Obsidian's paradigm
wearing Creed's paint — exactly what the brief said not to do. I defaulted to the
obvious structure instead of translating theirs.

## The one decision I couldn't make alone

Creed has ten sections; Mark's wiki has well over a thousand pages. "One
scrolling document" doesn't survive that without deciding what "the document"
is. Three options went back with ASCII previews. Mark picked **a folder is the
document** — the sidebar lists folders, each opens as one continuous scroll of
its pages.

Round two made that call from a page count of 579, which was low: the
round-three audit walked the tree properly and measured 1,424. The decision
holds either way — both numbers are far past ten sections — but the figure this
round reasoned from was wrong.

For colour he asked to see the options rather than read descriptions of them, so
`docs/style-options.html` renders three treatments over identical content
(landing panels, framed modules, and the app view) with a light/dark toggle. He
picked **Creed's exact hues**.

## What changed

| Before | After |
| --- | --- |
| 4-tab nav: Pages / Review / Health / Agents | 3: Wiki / Connections / Settings |
| Chevron file tree | Folders with coloured dots |
| One file open at a time | Folder as one scrolling document |
| Proposals in a separate Review tab | Inline, inside the section they change |
| No bulk action | Global `Accept all` / `Reject all` per folder |
| Health as a nav tab | Folded into Settings |
| Monochrome green | Eight-slot plate palette, solid panels, thick frames |

New: `lib/palette.ts`, `app/api/folder`, `components/lore/folder-document.tsx`,
`components/lore/page-section.tsx`, `components/lore/settings-view.tsx`,
`resolveMany()` for bulk resolve. Deleted: `review-view.tsx`, `page-view.tsx`,
`health-view.tsx`.

## Bugs found in round two

**Two sections rendered the same colour.** Page colour was assigned by hashing
the page id, and with eight slots a collision inside a three-page folder is
likely enough to hit immediately — which it did. Adjacent sections being the same
colour defeats the entire point. Now assigned by position within the folder, so
neighbours are never equal.

**The outgoing-links row duplicated the prose.** Each section listed its
outgoing links beneath the body, but wikilinks already render inline and are
already clickable, so every link appeared twice. Row removed.

**A callout inside a coloured section drew a blue rule.** `blockquote::before`
was hardcoded to the action blue, so a pink section sprouted a blue bar. It now
inherits `--plate`.

**Stale copy.** The FAQ and the how-it-works body still told users their changes
"wait in Review" — a screen that no longer exists. Rewritten to describe the
inline flow.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean, 11 routes |
| `/api/folder?path=stack` | 3 sections, 1 incoming, totals `+12 −0` across 2 proposals |
| Console errors, production, light + dark | zero |
| Horizontal overflow at 375 / 768px | none |
| Landing + app, both themes | screenshotted and reviewed by eye |

---

# Round three — the rethink

Mark pushed back twice, and was right both times.

**First:** "why is it asking permission to edit files? Claude Code already does
that." **Second:** "Claude understands my wiki better than a local model would —
that's not the moat. What it can't do is help me *see* my wiki."

Both landed. The audit and two research passes confirmed them with measurement.

## What the measurement showed

Against the real vault at `~/Documents/wiki`:

| | |
| --- | --- |
| Pages | 1,424 |
| Tokens | ~2.3M — 12× a 200k window |
| Changed in 7 days | 303 |
| Changed in 24h | 56 |
| In-place rewrites | 60 of 75 modified files |
| Prose deleted, unreviewed | ~1,450 lines in 15 days |
| Pages with agent `confidence:` | 1,156 — 83% graded `high`, the rest `medium`, **none `low`** |
| Pages with any human `reviewed`/`verified` | **0** |

Agents rewrite ~300 pages a week, grade their own work "high" 83% of the time,
and nothing in the corpus has ever recorded a human confirmation.

That row originally read "2 low", which was a miscounting artifact worth naming
because it is the same shape of error as the `find -newermt` one below. A naive
`grep '^confidence:'` matches the line `confidence: high | medium | low` inside
`SCHEMA.md` and `content/youtube/SCHEMA.md` — those are the field's *documented
values*, not two pages graded low. Re-run against the vault, the count of pages
carrying `confidence: low` is zero. No agent has ever graded its own work low.

## Three things I got wrong

1. **The review queue was unenforceable.** Proved it: a direct `Write` to a page
   bypassed `propose_edit` entirely and Lore did not notice. The gate competed
   with every agent's built-in write tool and lost.
2. **It was also redundant.** Claude Code already asks before editing files. I
   built a second, weaker permission layer on top of a working one.
3. **Even a perfect gate would fail.** 303 changes/week through a gate is a
   303-item queue, which resolves to "Accept All" and manufactures confidence —
   worse than no gate.

And one I got wrong twice: I proposed governance, then retrieval. Both were me
trying to make Lore do the *thinking*, when Claude already does the thinking.

**A measurement error, corrected:** I told Mark the wiki was dead — "0 edits in
7 days". That came from `find -newermt`, which returns 0 for every window on
this system while the newest edit is minutes old. `stat` gave the truth. Never
trust a single tool's date arithmetic without a second opinion.

## What replaced it

**Promotion, not permission.** Agents write freely. Everything lands
`unverified`. A human promotes what they actually checked, and the promotion is
pinned to a content hash — so an agent rewriting a verified page drops it
straight back to the top of the list. Trust that cannot lapse is a sticker.

Three primitives, all only possible because Lore sits in the MCP path and on the
filesystem:

- `lib/journal.ts` — harness-agnostic write journal. Watches the filesystem, so
  it captures Claude Code, Cursor, a script and your own hand equally. Nothing
  opts in. Hash-authoritative with a 90s reconcile, because the events lie.
- `lib/verify.ts` — the verification ledger and the triage ranking. Weighted by
  lines deleted, blast radius (inbound links, log-damped), and lapsed-vs-never.
- `lib/usage.ts` — what agents read, and every search that returned nothing.
  Each miss is a question the wiki failed to answer: a to-write list from real
  demand instead of guesswork.

## Bugs found during this round

**Trust computed from a stale cache.** Verifying a page then rewriting it left
it reporting "verified" — the exact failure the feature exists to prevent. The
scan cache had no way to learn about writes Lore did not make. Fixed: the
watcher invalidates it, and the trust endpoint never reads cached.

**`Write AGENTS.md` destroyed hand-written files.** The target user already keeps
a hand-maintained `AGENTS.md` (Mark's is 48 lines). The button regenerated it
wholesale. Now fenced with `<!-- lore:begin -->` — everything outside is
preserved, a file without the fence gets appended to, `?force=1` to replace.

**A folder endpoint that could not survive the real vault.** `clients/` holds 654
pages and the endpoint returned all of them with full source. Now paginated,
40 at a time, newest first.

## Research corrections worth keeping

- **Gemma 4 exists** (April 2026, Apache 2.0). I nearly asserted it did not.
  Mark already had it pulled locally — `gemma4:latest`, `gemma4:12b-nothink`
  and `gemma4:12b-mlx`, though not the plain `gemma4:12b` tag `lib/ollama.ts`
  prefers first.
- **Electron over Tauri** — Lore is a Node server app; all route handlers are
  `runtime: "nodejs"`. Tauri has no Node, and 8 sourced Tauri→Electron
  migrations blame webview divergence.
- **`osascript` is an 80% folder picker today**, without packaging anything.
  `/api/pick` shells out to it and returns 501 elsewhere, so the browser build is
  macOS-only. The File System Access API is Chromium-only, Safari will not ship
  it, and its handles expose no path — so it could not feed the MCP server
  anyway.
- **Licence trap avoided:** `@cosmograph/*` is CC-BY-NC. The graph uses d3-force.
- **Obsidian ships no first-party semantic search and no local model**, and no
  official MCP server either. Everything past the core is a community plugin,
  independently maintained. That gap is real.

## What the team built

Eight modules, built in parallel: graph (d3-force on one canvas), markdown
editor, coverage treemap (squarified), faceted explorer, near-duplicate
detection (MinHash + LSH banding), schema conformance grid, timeline, split
compare.

`propose_edit` is gone. The MCP server is four read tools that journal every
call — a sensor, not a gate.

---

# After round three

Unlike everything above, this section was reconstructed from the commit history
rather than written during the build. It exists because the log stops before the
code does, and the last nav shape it actually states is round two's three items —
which was already wrong by the end of round three.

- **Six destinations, not three.** Wiki, Review, Insights, Explore, Connections,
  Settings. This landed in round three itself; the round-three write-up just
  never said so.

Shipped after the round-three commit:

- **Two deployment shapes.** `LORE_MODE=site` builds the marketing page with
  every filesystem route dead; local is the real app on loopback. `proxy.ts` is
  the single boundary, on the reasoning that a guard which must be remembered at
  sixteen endpoints will eventually be forgotten at one.
- **Electron desktop** — macOS dmg, Windows nsis, Linux AppImage + deb
  (`electron-builder.yml`), plus a PWA and a service worker.
- **Paired remote access** — off until switched on, 32 random bytes stored 0600,
  constant-time comparison, rate-limited. Plain HTTP on the LAN: it stops a
  stranger on the same wifi guessing in, and does not protect the traffic. Not
  for hotel wifi.
- **Semantic search** and local models via Ollama.

The three rounds above are the design history. This list is the state of the
code; it is not an account of why any of it was decided.
