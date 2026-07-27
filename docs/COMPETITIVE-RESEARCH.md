# Competitive Analysis — "The Wiki for All Your Agents"

Research date: 2026-07-26. All claims below were fetched live; anything unreachable is marked
**[UNREACHABLE]** rather than guessed.

**Method / provenance.** Repo metrics (stars, forks, issues, licences, commit recency, release
dates, file trees) come from the GitHub API directly, not from scraped pages. Pricing comes from
each vendor's own pricing page or App Store listing. Product claims are quoted from READMEs,
marketing sites, and official docs. Two things could not be read: **mcpmarket.com** (HTTP 429 on
every attempt, two independent fetchers) and **capacities.io/pricing** rendered only its preamble,
so Capacities' numbers are corroborated from a third-party feature database and press coverage
rather than the vendor page — treat those two figures as the least certain in this document.

---

## 0. The context you are entering

This category did not exist before **April 4, 2026**, when Andrej Karpathy published the
[`llm-wiki.md` gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). It hit
~5,000 stars in its first week and 274 points / 89 comments on Hacker News. The pattern is three
layers:

1. **`raw/`** — immutable curated sources. The LLM reads, never writes.
2. **`wiki/`** — LLM-compiled markdown pages (entity, concept, comparison, timeline), each with
   title, summary, tags, body, backlinks.
3. **Schema file** (`CLAUDE.md` / `AGENTS.md`) — editorial style guide the agent reads before any
   operation: naming conventions, page structure, cross-referencing rules, conflict resolution,
   lint checklist.

Plus two special files: **`index.md`** (agent-facing catalog, one line per page, read first) and
**`log.md`** (chronological record of every operation).

Every single product in this report is either (a) a pre-existing PKM app retrofitting AI, or
(b) an implementation of that gist shipped within 90 days of it. The field is 3 months old.
Mark's own wiki at `~/Documents/wiki` (SCHEMA.md / index.md / log.md / raw/ / queries/ /
AGENTS.md / validate_wiki.py) is already a hand-rolled instance of exactly this pattern — which is
the strongest possible signal that the "connect an existing wiki directory" wedge is real.

---

## 0b. The field at a glance

| Product | Unit | Agent access | Local? | Price | Scale / health |
|---|---|---|---|---|---|
| **KEEL** | markdown files, fixed skeleton | ❌ none (Electron IPC only, **0 MCP hits in repo**) | ✅ full | Free MIT | 44 ★, 1 dev, v0.5.1 |
| **Bamboo** | markdown notes + collections | ❌ none (in-app AI sidebar) | ⚠️ iCloud container | $2.99/mo · $29.99/yr | ~0 reviews, weeks old |
| **Obsidian** | markdown files in a folder | ⚠️ community MCP only; official **CLI (Feb 2026)** | ✅ full | Free · Sync $4 · Publish $8 | 20k ★ releases repo, daily |
| **Logseq** | **blocks** (→ SQLite in 2.0) | ❌ none first-party | ⚠️ **leaving markdown** | Free, Sync still beta | 44k ★, 933 issues, 2.0 beta |
| **Capacities** | **typed objects** | ✅ official MCP + OAuth, but capture-only | ❌ cloud-first | $9.99–$12.49/mo | 50k users, PH 4.8 |
| **Wikiwise** | markdown folder, Karpathy scaffold | ⚠️ embedded terminal + scaffolded skills, **no MCP** | ✅ full | Free GPL-3.0 | 229 ★, **dead since 2026-04-22** |
| **llm_wiki** | projects → compiled pages + graph | ✅✅ **MCP + HTTP :19828 + published skill** | ✅ full | Free GPL-3.0 | **15,186 ★**, 54 releases |
| **llm-wiki-manager** | Karpathy `raw/`+`wiki/` | ✅ skill only (agentskills.io) | ✅ full | Free MIT | 51 ★, quiet since 06-11 |
| **mcpmarket skill page** | — | — | — | — | **[UNREACHABLE 429]** — it's a directory listing of #8 |
| *OpenKnowledge (adj.)* | markdown/mdx in a git project | ✅✅ `ok init` writes MCP+skills for every harness | ✅ full | Free GPL-3.0 | **3,121 ★**, YC-backed |
| *Basic Memory (adj.)* | observations + relations | ✅✅ 21 MCP tools | ✅ + cloud | **$15/mo** cloud | 3,514 ★, since 2024 |

Two products in this table ship a real multi-agent protocol surface *and* are alive. Neither of
them is on the original brief.

---

## 1. KEEL — https://keel-labs.org/ · https://github.com/Keel-Labs/keel

| | |
|---|---|
| **Positioning** | "An AI assistant whose memory belongs to you. Local-first Mac app, plain markdown workspace, bring your own model." |
| **Repo** | 44 ★ · 7 forks · 15 open issues · MIT · TypeScript/Electron · created 2026-04-05 · last push 2026-07-22 |
| **Latest** | v0.5.1 (2026-07-22). 13 releases since v0.1.0 beta on 2026-04-27. |
| **Maintainer** | One person. README: "Built and maintained by one person… response times variable." |

**Core mental model.** A *workspace folder* (default `~/Keel`) of plain markdown, with a fixed
skeleton:

```
keel.md                    # home page
tasks.md                   # global task list
projects/{slug}/           # per-project folders
daily-log/                 # daily briefs + EOD summaries
knowledge-bases/{slug}/    # "wiki bases"
.config/keel.db            # SQLite index (FTS), optional LanceDB vectors
```

The atomic unit is a **file**, not a block. Keel's own "context engine" indexes the workspace,
assembles a system prompt per conversation (relevant project context, recent captures, open tasks,
search hits), and writes captures/decisions/tasks back as markdown.

**How agents interact with it — this is the critical finding.** They don't. A code search across
the repo for `mcp` returns **0 hits**. `docs/API.md` documents exactly one surface: the Electron
IPC bridge `window.keel` (getSettings, chat, file read/write, tasks, wiki bases, meetings,
reminders). Explicitly absent: **no HTTP/REST API, no MCP server, no CLI, no plugin system.**
The markdown is on your disk, so Claude Code can `Read` it — but only by accident of it being
files. Keel is an *AI assistant that happens to store memory as markdown*, not a wiki that serves
agents.

**Onboarding.** Download universal DMG (macOS) or NSIS x64 installer (Windows) → drag to
Applications → on first launch paste an API key (Anthropic / OpenAI / OpenRouter / Ollama base
URL). Then `/create-kb` and `/refresh-kb` slash commands build per-project knowledge bases from
markdown + PDFs.

**Pricing.** Free, MIT, self-hosted. GitHub Sponsors / Buy Me a Coffee only. BYO API key.

**Local vs cloud.** Fully local-first. "No telemetry, no account, no server." Local Whisper
binaries shipped as a separate release asset for transcription.

**Genuinely good (steal-worthy):**
- The **daily brief / end-of-day summary loop**. Morning brief from workspace + open tasks +
  yesterday's loose ends; structured EOD summary written back into `daily-log/`. This is the only
  product in the set with a *temporal rhythm* — a reason to open it every day.
- **Model interchangeability as the headline promise.** "Claude today, GPT tomorrow, a local
  Llama on a flight." Frames vendor lock-in as the enemy, not note-taking.
- **Meeting transcription → structured summary with decisions and action items**, written into
  the wiki. Real ingest of a source type nobody else in this list handles.
- Scheduled jobs (recurring prompts) — cron for your knowledge base.
- Honest README with an explicit "What doesn't work yet" section.

**Weak (the gap):**
- **No MCP, no CLI, no HTTP API.** The wiki is a walled garden with a markdown floor. Everything
  useful is trapped behind an Electron IPC bridge that only Keel's own renderer can call. A
  competitor whose entire thesis is "your wiki, readable by *every* agent" beats this on its
  central claim.
- **Scope sprawl.** Weather. News. Google Calendar. Google Docs. X/Twitter bookmark sync *and post
  publishing*. To-dos with due dates and desktop notifications. Reminders. Voice input. A dashboard.
  This is five products at v0.5 with 44 stars, one maintainer, and no multi-device sync.
- **No multi-Mac sync, no sharing, no teams.** Explicitly listed as not working.
- It owns the folder layout. You can't point Keel at an existing wiki and have it respect your
  schema — you get `keel.md`, `tasks.md`, `daily-log/`.

---

## 2. Bamboo: AI Markdown Notes — App Store id6753059522

| | |
|---|---|
| **Positioning** | Subtitle: "Write, Link & Organize". Product Hunt: "Markdown notes with AI under your control" |
| **Developer** | 志贵 陈 / Johnny Chan (@zhigui) — solo indie |
| **Launched** | ~early July 2026. 118 Product Hunt upvotes. App Store: "hasn't received enough ratings or reviews to display an overview" |
| **Platforms** | iPhone / iPad / Mac / Vision Pro — **iOS 26.0+, macOS 26.0+** (very aggressive OS floor) |
| **Size** | 57.2 MB · Productivity |

**Core mental model.** Files. Markdown notes organized into **collections**, connected by
**wiki links**. Editor supports syntax highlighting, task lists, tables, wiki links, footnotes,
highlights, math, images, attachments. Plus web clipping, import/export, backups.

**How agents interact with it.** **They don't.** No MCP, no API, no shortcuts/URL-scheme surface
documented anywhere on the App Store listing or the Product Hunt thread. "AI" here means an
in-app assistant: you connect a provider (any OpenAI-compatible endpoint — the maker confirmed
Ollama and LM Studio work) and it can "draft, rewrite, summarize, brainstorm" inside a note.
It's a chat sidebar, not an agent surface. Notes sync via **iCloud**, which on iOS means an app
container — so an external agent on your Mac can't reliably reach them.

**Onboarding.** Install from App Store → free tier, start writing immediately → optionally paste
an API key in settings to enable AI. Genuinely the lowest-friction onboarding in this entire
report: zero config, zero terminal, zero account.

**Pricing.** Free with IAP. **Monthly Pro $2.99 · Annual Pro $29.99.** Pro unlocks iCloud Sync,
HTML export, PDF export. AI is BYO-key with **no markup — pass-through billing direct to the
provider** (maker's words).

**Local vs cloud.** Local files + iCloud sync. Maker: notes "are not routed through Bamboo-owned
servers." No data collection declared.

**Genuinely good (steal-worthy):**
- **The pricing shape.** $2.99/mo for *sync and export*, AI is BYO-key at cost. That is the honest
  version of the deal every one of these products should be offering, and it undercuts Basic
  Memory's $15/mo by 5×.
- **Zero-config onboarding.** Download, type. No `init`, no scaffold, no schema file to read.
- **BYO-key with explicit "no markup, pass-through"** stated publicly by the founder. That single
  sentence is worth more trust than any privacy policy.
- Native across iPhone/iPad/Mac/Vision from day one.

**Weak (the gap):**
- **iOS 26 / macOS 26 minimum** cuts off a large share of installed base for no visible reason.
- **Zero agent story.** The word "agent" does not appear. In a world where the user's real
  interface is Claude Code, a notes app with an AI sidebar is the *old* shape of the product.
- **iCloud container ≈ agent-hostile.** Files that a local agent can't reliably path into are
  files that don't exist for your agents.
- No index/log/schema discipline — it's a notes app with wiki links, not a compiled wiki. Nothing
  fights drift, duplicates, or staleness.
- Solo dev, weeks old, ~0 reviews. No moat.

---

## 3. Obsidian — https://obsidian.md/

| | |
|---|---|
| **Positioning** | "Obsidian is the private and flexible writing app that adapts to the way you think." Pricing page headline: **"Free without limits. No sign-up required. No strings attached."** |
| **Scale** | `obsidianmd/obsidian-releases` 20,181 ★, pushed 2026-07-26 (daily activity). Closed-source app, open plugin ecosystem. |

**Core mental model.** **Files.** A vault is a plain folder of `.md` on your disk; the atomic unit
is a note, linked by `[[wikilinks]]`, with backlinks, tags, an outline, and a graph view. Everything
else is a plugin. The newer **Bases** feature adds database-style views over note frontmatter
(properties) without changing the storage model — still markdown, still a folder.

**How AI agents interact with it.** **No official MCP server.** What exists:
- **Obsidian CLI**, released **February 2026** — first-party, and the cleanest way for an agent
  outside Obsidian to read and write a vault.
- **Community MCP servers**, several, all with caveats:
  `MarkusPfundstein/mcp-obsidian` is the most established (~3,000 ★) but requires the **Local REST
  API** community plugin, which means **Obsidian must be running** for agents to reach the vault.
  `aaronsb/obsidian-mcp-plugin` runs as a plugin serving MCP over HTTP on `localhost:3001` with
  wikilink graph traversal, Dataview queries, and Bases support — but is beta and **BRAT-only**
  (not in the official plugin store).
- Community plugins in the store named `mcp-server` and `agent-mcp` exist but are third-party.
- **The real agent path today is simply: it's a folder of markdown, so Claude Code can `Read`/
  `Edit` it.** That is Obsidian's greatest strength and also why it has never needed to solve this.

**Onboarding.** Download → **create or open a vault (pick a folder)** → start typing. No account,
no signup, works offline forever. Then the long tail: install community plugins, pick a theme,
configure, repeat.

**Pricing (verified from obsidian.md/pricing).**
- **App: free without limits, personal *and* commercial.** FAQ, verbatim: "Do I have to pay for
  commercial use? **No.**"
- **Sync: $4/user/mo billed annually, $5/mo monthly** — E2E encryption, version history, shared
  vault collaboration.
- **Publish: $8/site/mo annually, $10/mo monthly** — web publishing, custom theme, graph + full
  text search.
- **Catalyst: $25 one-time** — beta access, badges, VIP channel.
- **Commercial: $50/user/year** — explicitly optional, a support license.
- 40% education/nonprofit discount on Sync and Publish. 7-day refunds on Sync/Publish only.

**Local vs cloud.** Maximally local. "Your data is stored locally on your device, making it
inaccessible to us… our apps do not collect telemetry data, and we never sell user data." Sync is
AES-256 E2E.

**Genuinely good (steal-worthy):**
- **"Free without limits, no sign-up"** is the strongest trust position in the category, and the
  paid products are *services* (sync, publish) rather than gates on your own data. Copy this shape
  exactly.
- **A vault is just a folder.** The reason Obsidian survived every competitor: zero lock-in makes
  trying it costless and leaving it costless, which paradoxically means nobody leaves.
- **Publish as a per-site product at $8/mo** — proven willingness to pay for turning a private
  vault into a public artifact.
- Instant, local, offline-first performance on very large vaults.
- Optional commercial license framed as patronage, not enforcement — bought voluntarily at scale.

**Weak (the gap a competitor could exploit):**
- **No official agent story at all.** In 2026 the canonical way to give Claude access to your
  Obsidian vault is a beta community plugin installed via BRAT, or a REST API plugin that only
  works while the app is open. For a product whose whole value is *your notes are just files*,
  this is a conspicuous hole.
- **Plugin fatigue is the standing complaint.** The vault is only as good as the 8–20 community
  plugins you assembled, each independently maintained, each a potential breakage on update.
  Capacities markets directly against this ("No configuration. No markdown syntax to memorize.
  No plugin rabbit holes.").
- **No compiled-wiki discipline.** Obsidian will happily hold 4,000 notes with no index, no log,
  no schema, and no lint. It is a *substrate*, not a knowledge system — which is exactly the layer
  a new product sits on top of rather than competing with.
- Closed source app.

---

## 4. Logseq — https://logseq.com/

| | |
|---|---|
| **Positioning** | "A privacy-first, open-source knowledge base." / "Connect your notes, increase understanding." |
| **Repo** | `logseq/logseq` **44,085 ★ · 2,739 forks · 933 open issues** · **AGPL-3.0** · Clojure · created 2020-05-23 · pushed 2026-07-25 |

**The headline fact: Logseq just left the plain-markdown category.**

Release history tells the story: `0.10.9` (Apr 2024) → `0.10.11`–`0.10.15` (May–Dec 2025) →
**`2.0.1` on 2026-07-13**. That two-year gap between meaningful releases was the "is Logseq dead?"
period, and it was spent on the DB rewrite.

**Logseq 2.0 Beta (the "DB version") shipped 2026-07-13.** It **stores the canonical version of
your data in a SQLite database**, replacing the markdown-file-per-page model. The product has split
in two: **Logseq OG** (file-based) is now **maintenance-only, no new features**; **Logseq**
(database) is the future. Sync is being replaced by **RTC (Real Time Collaboration)**, currently
alpha, as is the new mobile app.

**Core mental model.** **Blocks, not files.** Logseq is an outliner: every bullet is an
addressable block with its own ID, block references, block embeds, and queries. Journals/daily
notes are the default entry point. Pages are containers for blocks. This is why the DB migration
was necessary and why it can't be "just a folder" — the block graph was always fighting the file
format.

**How AI agents interact with it.** **Nothing first-party.** No official MCP, no official CLI, no
official API. Community MCP servers exist against the file-based version. **The DB version makes
this materially worse**: once the canonical store is SQLite, an agent can no longer just read
markdown off disk, and every community integration built against the file format is on borrowed
time.

**Onboarding.** Download desktop (macOS/Windows/Linux) or use the web app → pick a local graph
folder → start typing in today's journal. Learning curve is the outliner itself — the homepage
literally ships a tiered tutorial ("✍️Beginner / 🔍️Intermediate / 💼️Expert", "Tip 1: Think in
sections, use indentation").

**Pricing.** **Free forever for personal use**, open source AGPL-3.0. **Logseq Sync is still
labeled BETA on the homepage in July 2026** — encrypted file syncing across devices. No published
paid tier on the marketing site.

**Local vs cloud.** Historically local markdown files ("Markdown files — open your notes in other
tools" is still a homepage bullet, now partly obsolete). Going forward: local SQLite with SQLite
DB backups, plus RTC sync.

**Genuinely good (steal-worthy):**
- **Free forever + open source + local as the entire brand.** The homepage bullets are: Open
  source · Privacy first · Mobile apps · Markdown files · Strong community · Localization ·
  150+ Plugins · 30+ Themes. That's the honest list a local-first tool should be able to write.
- **Journals as the default surface.** You never face an empty "where does this go?" — today's
  date is always the answer. Capacities copied this; Keel copied this; it works.
- **Block references and embeds** — transclusion of a single bullet across pages is genuinely
  more granular than any file-level product here, and it's why power users stayed through a
  two-year drought.
- Real mobile apps (iOS + Android), which almost nothing else in this report has.
- 44k stars and 1,760 concurrent Discord users after a stalled release cycle — the community is
  the moat.

**Weak (the gap):**
- **The DB migration is an existential opening for a competitor.** Logseq spent its credibility on
  moving *away* from "your notes are markdown files you own." Every user who chose Logseq for that
  reason is now shopping. Say "plain markdown, forever, no database" and you are talking directly
  to them.
- **933 open issues.** Beta DB version, alpha RTC, alpha mobile, and Sync *still* in beta after
  years.
- **Outliner-shaped.** Block-first structure doesn't map cleanly onto wiki pages, onto agent
  file-editing, or onto how anyone writes prose. Agents are excellent at editing a markdown file
  and bad at surgically editing a block tree by UUID.
- **AGPL-3.0** — hostile to any commercial derivative.
- No agent story at all, first-party or planned.

---

## 5. Capacities — https://capacities.io/

| | |
|---|---|
| **Positioning** | "A studio for your mind." / "A home for everything you think, learn, and create. Capacities turns your ideas into connected objects, not files buried in folders." |
| **Scale** | Launched 2022. "Trusted by 50,000+ knowledge workers." Product Hunt Product of the Day, 4.8 / 198 reviews. 10,000+ Discord. |

**Core mental model.** **Typed objects**, and this is the whole pitch. Not files, not blocks —
a Person, a Book, a Project, an Idea, each an object with **properties**, linked to any other
object. The marketing runs an explicit side-by-side of a rotting folder tree
(`Work/Projects/2024/Q1/Client A/final_v2_FINAL.docx`) against an object graph, labeled "Messy,
deep, lost" vs "Clear, connected, alive." Daily note is the inbox. **Related Content** scans your
notes and surfaces places you wrote about something but never explicitly linked.

**How AI agents interact with it.** **An official MCP server exists** —
`docs.capacities.io/developer/model-context-protocol` — connectable via **OAuth** to any MCP client
(Claude Desktop, Roo Code, etc.). **API tokens must be generated from the Capacities desktop app.**
Notably, the documented tool surface is thin and mostly *read + capture*, not authorship:
list spaces, get space details, search content with filters, **save a weblink with metadata**,
**add an entry to your daily note**. Several unofficial MCP bridges exist
(`jem-computer/capacities-mcp`, `natkitten/capacities-mcp-bridge-unofficial`,
`shpaksht/capacities-mcp`) — which is itself a signal that the official one doesn't do enough.

**Onboarding.** Web/desktop signup → create a space → the app ships with pre-made object types
(Person, Book, Meeting…) → start in the daily note. Deliberately configuration-free: "No
configuration. No markdown syntax to memorize. No plugin rabbit holes. Just open Capacities and
start writing."

**Pricing.** Free core forever ("the core product of Capacities is and will remain free" — they
publish a "promise" page). **Pro $9.99/mo billed annually (~$7.99/mo on some annual framings),
Believer $12.49/mo billed annually.** AI assistant is a paid-tier feature; frontier-model access
is documented via your own API key / MCP connector / usage-based provider billing.

**Local vs cloud.** **Cloud-first.** Notes and media are stored in the app and synced to Capacities'
cloud; offline support is partial and explicitly caveated ("not all features are available
offline"). Mitigated by a genuinely good **Full Export** with **scheduled automated exports**
(Settings → Full Export → Automated Full Export → Add Schedule) producing clean human-readable
markdown with local links, ready for Obsidian/Logseq/Joplin.

**Genuinely good (steal-worthy):**
- **The anti-configuration pitch.** "Organizing has become the work" is the sharpest problem
  statement in this entire report, and it is aimed straight at Obsidian's plugin culture. Whoever
  builds the agent-wiki should write copy this good.
- **Related Content** — surfacing connections you made in prose but never linked. This is *exactly*
  the job an agent should do on a markdown wiki, and it's the single most-praised feature here
  ("It felt magical the first time a connection surfaced that I hadn't made consciously").
- **Scheduled automated full export** as a trust device: a cloud product that continuously hands
  you a clean local markdown copy. If you *must* touch the cloud, this is how.
- **Daily note as inbox**, zero-filing capture.
- Object types with properties, which is really just enforced frontmatter with a UI — worth
  stealing as an *optional* schema layer, not a mandatory one.

**Weak (the gap):**
- **It's not your files.** Your knowledge lives in Capacities' cloud in Capacities' object model;
  export is a periodic *copy*, not the source of truth. For anyone who wants agents reading their
  wiki directly off disk, Capacities is structurally disqualified.
- **The official MCP can capture but barely authors.** Save a link, append to daily note, search.
  An agent cannot maintain a Capacities knowledge base the way it can maintain a folder of
  markdown. Three unofficial bridges exist because of it.
- **$9.99–$12.49/mo** for a notes app whose AI is either extra or BYO-key, against Obsidian at
  free and Bamboo at $2.99.
- No plugins, no scripting, no local model, no self-host. The anti-configuration promise is also
  a ceiling.

---

## 6. Wikiwise — https://wiki-wise.com/ · https://github.com/TristanH/wikiwise

| | |
|---|---|
| **Positioning** | Site: "Build your own Wikipedia." / "Wikiwise is a native Mac app for setting up, customizing, and managing your own local-first markdown wiki with an AI agent." README: "A native macOS app that turns any folder of markdown files into a browsable, publishable wiki — maintained by your coding agent." |
| **Repo** | 229 ★ · 18 forks · 4 open issues · **GPL-3.0** · Swift/HTML · created 2026-04-10 |
| **Last push** | **2026-04-22** — i.e. **~3 months dormant.** Last release v0.1.9, 2026-04-21. 8 releases, all inside 12 days. |

**This is the closest existing product to the brief, and it has stalled.** That is the single most
important competitive fact in this report.

**Core mental model.** Point it at a folder. `.md` files become wiki pages, `[[wikilinks]]` connect
them. No database, no config, no account. Scaffold (copied from
`Sources/Wikiwise/Resources/scaffold/`) is pure Karpathy:

```
my-wiki/
  raw/            # immutable source documents
  wiki/           # agent-maintained markdown pages
    sources/      # one summary per ingested source
    home.md       # human entry point
    index.md      # agent catalog
    log.md        # chronological record
  site/           # build.js (JS compiler) + style.css + out/ (gitignored HTML)
  .claude/        # agent skills and settings
  CLAUDE.md       # wiki schema
  llm-wiki.md     # Karpathy's pattern, shipped as reference
```

**How agents interact with it.** Two ways, both file-level, **no MCP**:
1. **Embedded terminal** (SwiftTerm) — Claude Code runs *inside the app*, in the wiki folder.
2. **Scaffolded skills** — the wiki folder ships `.claude/skills/` (ingest, lint, import-readwise,
   digest) plus a top-level `AGENTS.md` for "cross-agent instructions for Cursor, Codex, etc."

So the agent contract is: the folder configures the agent, not a server. Elegant and portable.

**Onboarding (verbatim from README).** 1. Create a wiki — Wikiwise scaffolds folder structure,
build tools, agent skills. 2. Open your agent — built-in terminal or your own. 3. Add sources —
paste URLs, import from Readwise, or point at existing files. 4. Read and explore — search,
backlinks, graph visualization.

**Pricing.** Free, open source, GPL-3.0. Signed and notarized DMG (Apple Silicon + Intel).

**Local vs cloud.** Fully local. "No lock-in — just markdown on your Mac." Architecture: SwiftUI +
SwiftPM (no Xcode project), JavaScriptCore markdown→HTML compiler, FSEvents watcher for live
recompile, WKWebView render.

**Genuinely good (steal-worthy):**
- **"Point it at a folder"** as the entire onboarding. No import, no migration, no account.
  Exactly the wedge.
- **Publish in one click.** The wiki compiles to a clean static site; toggle edit ↔ browse
  instantly. Nobody else in this report closes the loop from private wiki → shareable artifact.
- **Shipping `llm-wiki.md` (Karpathy's own text) inside every scaffold** so the agent literally
  reads the pattern spec before working. Cheap, brilliant.
- **`AGENTS.md` + `.claude/skills/` in the wiki folder** = the wiki is self-describing to any
  harness. Zero server, zero protocol, works with Cursor/Codex/Claude Code today.
- FSEvents live recompile — edits from *any* source (agent, vim, Obsidian) show up instantly.

**Weak (the gap):**
- **Abandoned since 2026-04-22.** 4 open issues, one contributor, still v0.1.x.
- **GPL-3.0** — poisons commercial forks and scares off any team wanting to embed it.
- **macOS only**, no iOS/web/Windows.
- **No MCP server** — an agent that isn't sitting in the folder's CWD can't reach the wiki.
  ChatGPT, Claude Desktop, a remote Devin session: all blind.
- **No maintenance layer.** Ships a `lint` skill and nothing else: no drift detection, no
  contradiction resolution, no staleness review windows, no diff/approval gate on agent writes.
- Readwise import is the only first-class ingest connector.

---

## 7. llm_wiki (nashsu) — https://github.com/nashsu/llm_wiki

| | |
|---|---|
| **Positioning** | "A personal knowledge base that builds itself. LLM reads your documents, builds a structured wiki, and keeps it current." |
| **Repo** | **15,186 ★ · 1,788 forks** · 211 open issues · **GPL-3.0** (Copyright Yong Su; GitHub shows NOASSERTION but the LICENSE file is plain GPLv3) · TypeScript 70.9% / **Rust 25.0%** (Tauri) · created 2026-04-08 |
| **Velocity** | **54 releases** in ~3.5 months. Latest v0.6.5, 2026-07-20. 30 contributors. |

**This is the 800-lb gorilla.** Created four days after Karpathy's gist, now the #3256 repo on
GitHub globally. Anything a new entrant does will be compared to it.

**Core mental model.** A cross-platform desktop app (Tauri: Rust backend + TypeScript frontend)
with **projects**, each containing `raw/sources/` and a compiled wiki. Ingest is a
**two-step chain-of-thought**: the LLM analyzes a source first, then generates wiki pages with
source traceability and an incremental cache. On top sits a **4-signal knowledge graph**
(direct links, source overlap, Adamic-Adar, type affinity) with **Louvain community detection**
and cohesion scoring, plus optional LanceDB vector search.

**How agents interact with it.** The most complete agent story in the entire report:
- **Local HTTP JSON API on `127.0.0.1:19828`** (v0.5.4 release notes: "Enabled public access to API
  endpoints").
- **Bundled MCP server** exposing hybrid search, file read, graph traversal, source rescan.
- **Ready-made agent skill** — separate repo `nashsu/llm_wiki_skill` (120 ★, last push 2026-05-19),
  installs into Claude Code / Codex with one command: `npx skills add …`.
- Internally it also *consumes* skills: "scan and enable local `SKILL.md` folders, select skills
  with `/skill`" — the app runs its own tool-using Rust chat agent with shell approval.

**Onboarding.** Download a release build (macOS/Windows/Linux; portable Windows build added in
v0.5.4) → create a project → configure model providers per project (Chat and Ingest routed
independently, custom providers/headers supported) → drag in PDFs/Office/EPUB/MOBI/Org/images/URLs
→ watch the ingest queue compile pages.

**Pricing.** Free, open source, GPL-3.0. BYO model keys. Optional paid third-party services for
Deep Research (Tavily / SerpApi / SearXNG) and MinerU cloud PDF processing.

**Local vs cloud.** Local-first desktop app; `raw/sources/` is auto-watched via filesystem events.
Cloud only where you opt into a search or PDF-parsing provider.

**Genuinely good (steal-worthy):**
- **The MCP + local HTTP API + published skill trifecta.** One repo, three ways in. This is the
  bar for "agent-readable" and everyone else in this report fails it.
- **Async Review System** — "LLM flags items for human judgment, predefined actions, pre-generated
  search queries." The only shipped answer to *drift* in the whole field: the wiki surfaces its own
  uncertainty as a reviewable queue instead of silently rotting. v0.5.4 added **bulk management for
  wiki inspections and reviews**.
- **Source-grounded retrieval / "Read Sources Only" mode** — answer exclusively from original
  imported material. Direct antidote to citation drift.
- **Persistent ingest queue with crash recovery, cancel, retry, progress viz.** Boring
  infrastructure that makes a 500-document import survivable.
- Source folder auto-watch, Chrome web clipper, multimodal PDF image extraction with vision
  captions and jump-to-source.
- Project export/import archives — real portability between devices.

**Weak (the gap):**
- **Overwhelming.** The feature list above is ~20 bullets and I trimmed it. Louvain community
  detection and Adamic-Adar scoring are in a *personal notes app*. 211 open issues. This is a
  research playground, not a product with taste.
- **It owns your knowledge.** You import documents *into* llm_wiki projects. It is not designed to
  be pointed at an existing wiki directory you already maintain and asked to respect its schema.
- **GPL-3.0**, Chinese-origin solo-led project — real adoption friction for US/EU commercial teams.
- **No mobile, no sync, no sharing, no publish.**
- Documented community complaint on the underlying pattern: hand-built LLM wikis "break at scale…
  fine at around 50 sources, but past that, summaries go stale when sources are edited, adding new
  material forces a full rebuild"; users report "duplicate pages, messy links, and overlapping
  concepts." Past ~150–200 pages agents can't hold the index in context and start duplicating.
- Desktop-app-first means the wiki is a *destination*. Most people's actual agent work happens in
  a terminal in some other directory.

---

## 8. llm-wiki-manager (sametbrr) — https://github.com/sametbrr/llm-wiki-manager

| | |
|---|---|
| **Positioning** | "Skill for a persistent LLM-managed wiki — the LLM writes and cross-references while you curate sources." |
| **Repo** | 51 ★ · 10 forks · 0 open issues · **MIT** · Python 79.3% / Go Template 20.7% · created 2026-05-07 · last push 2026-06-11 · 6 releases, latest v1.4.0 |

**Core mental model.** Not an app — a **Claude Code skill** (agentskills.io-compatible). Karpathy's
pattern implemented as **8 operating modes, 5 idempotent Python scripts (stdlib only, no pip),
8 page templates, 11 reference documents.** Hard ownership rule: *"The LLM owns `wiki/` while you
own `raw/` — no exceptions."* Every operation appends to `log.md` via `append_log.py`; every new or
updated page touches `index.md` via `update_index.py`.

The 8 modes, auto-detected from natural language (no slash commands):

| Mode | What it does |
|---|---|
| Bootstrap | Scaffolds `raw/`, `wiki/`, `CLAUDE.md` from templates |
| Ingest | Source → summary → update entity/concept pages → index → log |
| Query | index → candidate pages → cited answer → offers to file the answer back |
| Update | Semantic sweep across all pages, **diff-before-write per page**, single log entry |
| Lint | `lint_wiki.py` → auto-saves `wiki/reports/lint-YYYY-MM-DD.md`, auto-tracked in index+log |
| Schema-evolve | "We should always do X going forward" → rewrites `CLAUDE.md` so future sessions inherit it |
| Multi-wiki | Routes between a per-project wiki and a long-lived global wiki (often an existing Obsidian vault) via an `External Wiki:` declaration in the project's `CLAUDE.md` |
| Teach | Explains the pattern, compares to RAG |

**How agents interact with it.** It *is* the agent interaction — a `SKILL.md` bundle. No MCP,
no server, no GUI. Requires Claude Code or any agentskills.io-compatible harness + Python 3.9+.

**Onboarding (verbatim).**
```bash
git clone https://github.com/sametbrr/llm-wiki-manager ~/.claude/skills/llm-wiki-manager
# or: gh skill install sametbrr/llm-wiki-manager   (gh CLI v2.90+)
# or: curl -L -o llm-wiki-manager.skill …/releases/latest/download/llm-wiki-manager.skill

mkdir ~/research/my-topic && cd ~/research/my-topic && claude
> "Set up an LLM wiki here. Topic: history of nutrition science."
```

**Pricing.** Free, MIT. **Local vs cloud.** Entirely local; runs on your agent's built-ins.

**Genuinely good (steal-worthy):**
- **Schema-evolve mode.** Say "we should always do X going forward" and the schema file rewrites
  itself so every future session inherits the convention. This is the single best idea in the whole
  report — the wiki teaches itself house style. Nobody else has it.
- **Diff-before-write per page** on Update mode. The only diff gate anywhere in this set.
- **Multi-wiki routing** — per-project wiki + global "second brain" (your existing Obsidian vault),
  declared in one line of `CLAUDE.md`. Directly addresses "connect my existing wiki directory."
- **Lint reports as first-class wiki artifacts** (`wiki/reports/lint-YYYY-MM-DD.md`, auto-indexed
  and logged) — the health check is itself a page you can browse over time.
- **Idempotent Python scripts, stdlib only, zero install.** Deterministic bookkeeping for the parts
  that must not be hallucinated (index, log).
- **No slash commands** — modes auto-detected from natural language.

**Weak (the gap):**
- **Claude-Code-shaped.** Named `CLAUDE.md`, installs to `~/.claude/skills/`. Portable in principle
  via agentskills.io, but there is no MCP server, so ChatGPT / Claude Desktop / any non-CLI agent
  cannot touch the wiki at all.
- **No GUI whatsoever.** You cannot browse, search, or read your wiki except by reading raw
  markdown files. No graph, no backlink panel, no publish.
- Last push 2026-06-11 — six weeks quiet.
- One contributor, 51 stars. Zero distribution.

---

## 9. "LLM Wiki Manager Skill" — https://mcpmarket.com/tools/skills/llm-wiki-manager

**[UNREACHABLE]** — mcpmarket.com returned **HTTP 429 Too Many Requests** on repeated attempts via
two independent fetchers. Nothing on that page was read directly.

What is verifiable from search-result metadata: mcpmarket is a **directory listing**, not a
separate product. The page indexes the same `sametbrr/llm-wiki-manager` skill covered in §8 —
the description text matches the repo README verbatim ("build and maintain a personal LLM-managed
wiki… the LLM does all the writing, cross-referencing, and bookkeeping while you curate sources and
ask questions", plus the multi-wiki routing and `append_log.py` / `update_index.py` details).

**The real finding here is the shelf, not the item.** mcpmarket carries at least four near-identical
competing skills — `llm-wiki-manager`, `project-wiki-manager`, `karpathy-llm-wiki-1`,
`llm-wiki-knowledge-base-2` — and that's one directory. **The "Karpathy wiki skill" is already a
commodity.** A new product cannot win by being skill #12. It wins on everything the skills
structurally cannot do: a UI, a protocol surface for non-CLI agents, and a maintenance layer.

---

## 10. Adjacent competitors you must know about

These weren't on the brief but two of them are more threatening than most that were.

**OpenKnowledge (Inkeep)** — https://openknowledge.ai · https://github.com/inkeep/open-knowledge
**3,121 ★ · 196 forks · 35 open issues · GPL-3.0 · TypeScript · created 2026-06-03 · last push
2026-07-25.** Y Combinator-backed docs-AI startup. Tagline: *"Beautiful, AI-native markdown editor
for humans and agents. Build knowledge bases, LLM wikis, and agent 2nd brains."* / *"A beautiful
markdown editor with integrations with Claude, Codex, and other harnesses. Private, local, and
free."*

```bash
npm install -g @inkeep/open-knowledge
cd your-project
ok init          # detects installed harnesses, writes config + MCP server + skills for each
ok start --open  # WYSIWYG web editor
```

`ok init` auto-detects which harnesses are installed (Claude Code, Claude Desktop, Cursor, Codex,
OpenCode, OpenClaw, Pi, GitHub Copilot CLI, LM Studio, Antigravity, Hermes) and writes config for
each, including a pre-built MCP server and skill definitions exposing vector search, wiki-link
navigation, and document editing. Agentic search is full-text + vector via Orama. Full WYSIWYG
markdown editing, file navigator, tabs, graph viewer, side-by-side AI editing, git/GitHub team
sync, embeddable HTML components. Files stay plain `.md`/`.mdx`, git-versioned, never routed
through their servers. Docs explicitly pitch "Set up an LLM Wiki — build a Karpathy-style LLM Wiki."
**This is the most direct, best-funded, fastest-moving competitor to the brief.** Its weaknesses:
GPL-3.0, `npm install -g` + CLI onboarding (developer-only), a full IDE's worth of surface area,
and it's a *project*-scoped editor rather than a personal-wiki manager — no daily rhythm, no
review/approval loop, no drift management.

**Basic Memory (Basic Machines)** — https://basicmemory.com ·
https://github.com/basicmachines-co/basic-memory
**3,514 ★ · 239 forks · 72 open issues · AGPL-3.0 · Python · created 2024-12-02 · last push
2026-07-25.** Tagline: *"Your AI never forgets again."* The **incumbent MCP memory layer**, and it
predates the Karpathy gist by 16 months. Markdown + frontmatter (title, type, permalink, tags),
content split into **Observations** (facts with `[category]` tags) and **Relations** (wiki links
forming a graph). Default `~/basic-memory`. Install: `uv tool install basic-memory`. Clients:
Claude Desktop, Claude Code, Codex CLI, Cursor, VS Code, ChatGPT Custom GPTs, Obsidian.

Its MCP toolset is the most complete published surface in the category:
`write_note`, `read_note`, `edit_note`, `move_note`, `delete_note`, `read_content`, `view_note`,
`search`, `search_notes`, `recent_activity`, `list_directory`, `build_context`,
`list_memory_projects`, `create_memory_project`, `get_current_project`, `sync_status`,
**`schema_infer`, `schema_validate`, `schema_diff`**, `cloud_info`, `release_notes`.

Note those three schema tools — Basic Memory is the only competitor treating the *schema itself* as
a validated, diffable object. **Pricing: $15/mo cloud, locked for life during beta ($19 regular),
7-day free trial, OSS code `BMFOSS` for another 20% off 3 months; teams same price.** That is the
price ceiling for this category. Weaknesses: AGPL-3.0, its own Observation/Relation formalism
imposed on your markdown, no first-party GUI (it borrows Obsidian's), and it's memory-shaped
(append facts) rather than wiki-shaped (compiled, curated, cited pages).

**llm-wiki.net (nvk)** — *"LLM-compiled knowledge bases for any AI agent with awesome outputs."*
Free, MIT, no servers/telemetry, data in `~/wiki/`. Distributed as a Claude Code plugin, an OpenAI
Codex marketplace plugin (`@wiki`), OpenCode instruction files, Pi/DS4 read-only launchers, and a
portable `AGENTS.md`. Onboarding is four commands: `/wiki init nutrition`,
`/wiki:research "…"`, `/wiki:query "…"`, `/wiki:audit`. Runs 5–10 parallel research agents and
generates reports/slides/study guides. Notable for the **multi-harness distribution strategy** and
for treating *deliverable generation* as the payoff.

**vanillaflava/llm-wiki-skills** — 54 ★, MIT, last push 2026-07-11. Six agent skills, explicitly
"works with Obsidian, Logseq, etc. or just folders on your local drive," **GUI install on Claude
Desktop, no terminal, no code.** Notable only for proving the no-terminal install path exists.
Author is candid: *"This is my personal implementation… It is not a product."*

**kfchou/wiki-skills**, **praneybehl/llm-wiki** (Claude plugin hub), **InfraNodus LLM Wiki skill** —
more of the same. The commodity point in §9 stands.

---

# SYNTHESIS

## 11. The single biggest unmet need

**Nobody has built the trust layer between an agent and a wiki it is allowed to write to.**

Every product here solves one of two halves and drops the other:

- **The PKM apps** (Obsidian, Logseq, Capacities, Bamboo) have the reading UX — browse, search,
  backlinks, graph — and no agent write path worth the name.
- **The wiki tools** (llm_wiki, Wikiwise, the skills, OpenKnowledge, Basic Memory) have agent write
  paths and no answer to what happens after 200 pages of unsupervised agent writes.

The second failure is the expensive one, and it is documented, not hypothetical. The recurring
field reports across HN, maintenance write-ups, and llm_wiki's own issue tracker:

- **Six named drift types** — source, concept, terminology, decision, **citation**, and structure
  drift. Citation drift is called "one of the most serious LLM Wiki failure modes" precisely
  because it *creates false confidence*: the page still reads authoritative after the claim has
  detached from its source.
- **Duplicate pages and orphaned links** appear as the standard failure at scale.
- **~150–200 pages** is where the agent can no longer hold `index.md` in context, so it stops
  seeing that a page exists and writes a second one.
- **~50 sources** is where hand-rolled versions break: "summaries go stale when sources are edited,
  adding new material forces a full rebuild."
- **Staleness has no clock.** Pricing pages need review every 7–30 days; tool-version pages
  30–90 days; architecture principles 6–18 months. No shipped product tracks a review date.

So the wiki is exactly as trustworthy as the last thing an agent wrote into it while you weren't
looking — and you have no diff, no approval queue, no confidence signal, and no way to ask
"what changed this week and why?"

Only two products even gesture at this. llm_wiki's **Async Review System** (LLM flags items for
human judgment) and llm-wiki-manager's **diff-before-write**. Neither is a full loop.

**The unmet need, stated as a product:** *a wiki that shows you what your agents did to it, lets
you approve or reject it, and actively fights its own decay — while staying plain markdown in a
folder you already own.*

Two secondary gaps worth naming, because they're cheap to close and everyone leaves them open:

1. **Non-CLI agents are locked out.** MCP is how ChatGPT, Claude Desktop, Devin, Manus, and a
   phone reach your wiki. Of the nine briefed products, exactly **one** ships an MCP server
   (llm_wiki). Skills-only distribution means your wiki exists only where a terminal exists.
2. **Everybody wants your folder.** llm_wiki imports into projects, Keel owns `~/Keel` with a
   fixed skeleton, Basic Memory imposes Observations/Relations, Bamboo lives in an iCloud
   container. The person who already maintains `~/Documents/wiki` with their own SCHEMA.md is
   asked to migrate. **"Connect the folder you already have, respect the schema you already
   wrote"** is unclaimed territory — Wikiwise claimed it and then stopped shipping in April.

---

## 12. Eight feature recommendations

Ordered by "what wins the first 1,000 users," not by build difficulty.

> **Superseded in part — recommendation 3 was built, measured, and reversed.**
>
> This section is the pre-build research position, kept as written. Two of its
> calls did not survive contact with a real vault:
>
> - **"The Review Queue — the actual product" (rec 3) was wrong.** It was built,
>   then removed once measurement showed the gate is unenforceable (agents have
>   their own write tools), redundant (Claude Code already asks), and worst at
>   exactly the volume that matters — 303 changes a week resolves to "Accept
>   All". Replaced by promotion-not-permission: agents write freely, everything
>   lands unverified, humans promote what they checked, and promotions are pinned
>   to a content hash so a rewrite lapses them. See DOCUMENTATION.md §2.
> - **The MCP surface in rec 2 is four read tools, not eight.** `propose_edit`
>   and `apply_edit` are gone with the queue; `ingest_source` was never built.
>
> The rest held up. Shipped: **1** (Connect Folder), **2** (harness detection and
> one-click wiring, at four tools), **4** (Wiki Health), **5** (staleness, with
> per-type windows via `STALE_DAYS` rules and a 180-day default), **6** (Schema),
> **7** (Review and Timeline). **Not built: 8** — there is no static publish. The
> only sharing that exists is the paired-remote token, which is a different thing:
> reaching your own machine from your own phone, not publishing to anyone.

### 1. `Connect Folder` — a real 30-second onboarding, no scaffold, no migration
One button: pick a directory. The app reads what's there and **infers the schema** rather than
imposing one — detects `index.md` / `log.md` / `SCHEMA.md` / `AGENTS.md` / `CLAUDE.md`, frontmatter
keys actually in use, `[[wikilink]]` vs `[]()` link style, folder taxonomy, naming convention.
Shows you a one-screen "here's what I found" summary and asks you to confirm. If the folder is
empty, *then* offer the Karpathy scaffold. Never rewrite a file on connect.

*Why:* This is the single differentiator. Wikiwise proved "point it at a folder" resonates
(229 ★ in 12 days) and then abandoned it. Everyone else demands migration. Steal Basic Memory's
`schema_infer` idea but run it at connect time, in a GUI, for a human.

### 2. One-click agent wiring: MCP server **and** skills, for every harness the user has
Detect installed harnesses and wire them all — the `ok init` move, but from a GUI with no npm and
no terminal. Ship **both** transports, because they serve different agents:
- **MCP server** (local stdio + an optional OAuth'd HTTP endpoint) so ChatGPT, Claude Desktop,
  Devin, and phones can reach the wiki.
- **A generated `AGENTS.md` + skill folder written into the wiki directory itself**, so Claude
  Code / Codex / Cursor working in that folder are configured by the folder — Wikiwise's trick,
  which needs no server at all.

Keep the MCP surface to ~8 tools, not Basic Memory's 21: `search`, `read_page`, `list_index`,
`propose_edit`, `apply_edit`, `ingest_source`, `recent_changes`, `get_schema`. Every tool call is
logged with the agent's identity.

### 3. The Review Queue — the actual product
Agent writes land as **proposals with a rendered diff**, not silent commits. Triage by risk tier,
which is the one design decision that makes this usable rather than annoying:

| Tier | Examples | Default |
|---|---|---|
| Low | link fixes, formatting, typos, backlinks, aliases, index entries | **auto-apply**, shown in a digest |
| Medium | new pages, new summaries, merging duplicates, recommendation changes | **review before commit** |
| High | deleting claims, rewriting a canonical page, changing a decision record, pricing/security/legal edits, resolving contradictions | **always human** |

Per-section or per-folder permission overrides, like Creed's per-section model. Approve/reject in
one keystroke; rejections write a note back into the schema so the agent learns the boundary.

*Why:* This is the unmet need from §11, and it converts "I'm scared to let agents write to my
notes" into the reason to install.

### 4. Wiki Health — a dashboard that runs the lint nobody runs
A single score plus a fixable list, refreshed on a schedule. Concretely check:
broken internal links · **orphan pages (no inbound links)** · near-duplicate titles ·
pages missing a `Sources` section · pages missing a review date · index entries missing for new
pages · inconsistent naming · claims with no source support · **contradictions between pages**.

Every finding has a "Fix with agent" button that dispatches a scoped task and returns a proposal
to the Review Queue. Persist each run as a dated page inside the wiki (`wiki/reports/`) the way
llm-wiki-manager does, so health itself is browsable history.

### 5. Staleness clocks with per-type review windows
Frontmatter gets `reviewed:` and `review_every:`. Defaults by page type, taken from real practice:
pricing/availability **7–30 days**, tool versions **30–90 days**, comparisons **30–180 days**,
glossary **3–12 months**, architecture principles **6–18 months**. Stale pages get a visible badge
in the reader and a queue entry offering a re-verify pass against `raw/`.

*Why:* Staleness is the most common drift type and literally zero shipped products track it.

### 6. Schema-evolve: the wiki learns your house style
A single natural-language line — "always cite the source date," "never create a page under 200
words," "client names go in `clients/`" — updates the schema file, and every future agent session
in every harness inherits it. Show the schema diff before writing.

*Why:* Stolen wholesale from `sametbrr/llm-wiki-manager`, the best idea in the field, currently
buried in a 51-star repo with no GUI. It also solves *style drift* (early pages terse, later pages
verbose) which nothing else addresses.

### 7. Changelog view: "what did my agents do to my wiki this week?"
`log.md` is the field's convention and it's a wall of text. Render it: filter by agent, by date, by
page, by risk tier. Diff any page across time. Per-agent stats — reads, edits, proposals, accept
rate. One-click revert of any change or any agent's whole session.

*Why:* Creed already proved the MCP health dashboard is what makes multi-agent writes feel safe.
It's also the honest answer to "is this thing helping?"

### 8. Publish + share, one click
Compile the wiki to a fast static site — private link by default, optional password, optional
public. Selective: publish a folder, not the vault.

*Why:* Wikiwise had this and nobody else does. It's the natural paid tier, it's the growth loop
(every published wiki is a landing page), and it dodges the trap of charging for AI you don't
provide.

**Pricing shape implied by the above:** free forever for connect + MCP + read + local agent writes.
Paid ($5–8/mo, undercutting Basic Memory's $15 and sitting near Bamboo's $2.99) for the Review
Queue history, Health scheduling, sync, and publishing. **BYO model key, pass-through, no markup**
— say it out loud like Bamboo's founder did.

---

## 13. What NOT to build

Each of these killed or bloated something in this report.

**1. Don't build a knowledge graph algorithm.**
llm_wiki ships Adamic-Adar link prediction, type-affinity scoring, and Louvain community detection
for cluster discovery — in a personal notes app. It has 211 open issues. The graph is a demo, not
a job to be done. A backlinks panel and a legible index page cover 95% of real use. If you build a
graph view, build it as a *picture*, not an inference engine.

**2. Don't build an editor.**
OpenKnowledge is a full WYSIWYG markdown IDE with tabs and a file navigator, competing with
Obsidian, VS Code, iA Writer, and every other editor the user already loves. You cannot win that
fight and you don't need to — the user's editor is fine, and the agent doesn't need a UI at all.
Ship an excellent *reader* (fast, searchable, backlinks, diffs) and a "Open in…" button.

**3. Don't become an AI assistant.**
Keel is at v0.5 with 44 stars and one maintainer, and it ships weather, news, Google Calendar,
Google Docs, X bookmark sync, X *post publishing*, to-dos with due dates, desktop notifications,
reminders, meeting transcription, voice input, and scheduled jobs — while having no multi-device
sync. Every hour spent on a chat sidebar is an hour not spent on the thing agents can't do
themselves. **The user already has Claude Code. Don't compete with the harness — serve it.**

**4. Don't invent a data model.**
Basic Memory imposes Observations-and-Relations on your markdown. Logseq's block-first outliner
model is why it can't be a normal folder of files. Capacities makes you file everything as a typed
object. Every custom model is a migration tax and a lock-in smell, and it breaks the promise that
your files stay yours. **Plain markdown, plus frontmatter that's optional and additive. Nothing
else.**

**5. Don't require a terminal, an `npm install -g`, or an API key to see value.**
`npm install -g @inkeep/open-knowledge && ok init` filters out everyone who isn't a developer —
and the people with the most valuable wikis (researchers, consultants, operators) frequently
aren't. Bamboo's onboarding is *install and type*. Match it: the app should show you your existing
wiki, rendered and searchable, before it asks for a single key.

**6. Don't build a fixed folder skeleton.**
Keel gives you `keel.md`, `tasks.md`, `daily-log/` whether you want them or not. That's fine for a
new user and disqualifying for someone with two years of notes. Scaffold only into empty folders;
otherwise adapt.

**7. Don't ship a rebuild-the-world ingest pipeline.**
Multi-format parsing (PDF/Office/EPUB/MOBI/Org), vision captioning of embedded images, MinerU,
Tavily/SerpApi/SearXNG deep research, a Chrome clipper, a crash-recovering queue — llm_wiki has all
of it and the community complaint is *still* "adding new material forces a full rebuild." Ingest is
a bottomless pit. Ship URL + markdown + PDF, delegate everything else to the user's agent, which
already has web fetch and file reading.

**8. Don't ship GPL.**
Wikiwise, llm_wiki, and OpenKnowledge are GPL-3.0; Basic Memory is AGPL-3.0. If you ever want a
team tier, an embed, or an acquisition, MIT or a source-available license is the move. (Keel and
the skills are MIT and lost nothing for it.)

**9. Don't charge for AI you don't provide.**
Basic Memory charges $15/mo for what is, at the local tier, a Python package. The credible model
in 2026 is BYO-key pass-through with the subscription attached to sync, history, health, and
publishing. Bamboo's founder saying "no markup, pass-through" in a public comment thread is worth
more than a pricing page.

**10. Don't stop shipping.**
The most instructive data point in this whole report isn't a feature — it's that **Wikiwise, the
product closest to this brief, shipped 8 releases in 12 days and then went silent on 2026-04-22.**
Meanwhile llm_wiki shipped 54 releases in 3.5 months and took 15,000 stars. In a category this
young, cadence *is* the moat.
