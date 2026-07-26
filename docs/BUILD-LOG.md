# Build log

A record of what was built, what was decided, and what went wrong — written
during the build, not reconstructed after it.

Built 2026-07-26.

---

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
Parallel to Creed (a body of belief) without echoing it. Brand file: `lore.md`.

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
