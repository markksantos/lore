# Lore — technical documentation

Everything a maintainer needs: architecture, the trust model, the data model,
the API surface, the design system, and the constraints that shaped each.

---

## 1. Architecture

Lore is a single Next.js 16 app (App Router, React 19, Tailwind v4) that runs on
`127.0.0.1:4646` and talks to the user's filesystem through the Node runtime.
There is no database, no account, no cloud service, and no build-time content
step. The only authentication anywhere is the optional paired-remote token
(§10), which is off until the user switches it on.

```
┌──────────────┐   HTTP    ┌────────────────────┐   fs    ┌─────────────┐
│  Browser UI  │ ────────► │  Next.js API route │ ──────► │ Your wiki   │
│  (/vault)    │           │  (node runtime)    │ ◄────── │ (markdown)  │
└──────────────┘           └────────────────────┘  watch  └─────────────┘
                                     ▲
                              JSON-RPC over stdio
                                     │
                           ┌─────────────────────┐
                           │  mcp/server.mjs     │ ◄── Claude Code, Cursor,
                           │  (7 tools, stdio)   │     Claude Desktop, Codex
                           └─────────────────────┘
                                     ▲
                              JSON-RPC over HTTP
                                     │
                           ┌─────────────────────┐
                           │  /api/mcp           │ ◄── ChatGPT, phones, hosted
                           │  (bearer token)     │     agents — anything that
                           └─────────────────────┘     cannot spawn a process
```

Two arrows matter more than the boxes.

**The MCP server is a client of the app**, not a second implementation. It holds
no filesystem logic — it calls the same HTTP endpoints the UI does. Two code
paths to the same files is how two tools end up disagreeing about what "the vault
root" means.

**The filesystem arrow points both ways.** Lore does not only write when asked;
it watches. That is what makes it harness-agnostic: it observes the folder, so it
captures Claude Code, Cursor, a shell script, Obsidian and a human's own hand
equally, and nothing has to opt in.

### The desktop shell (`electron/`)

There is no static bundle to load into a window — every route handler is
`runtime: "nodejs"` and reads the user's filesystem — so `electron/main.js` does
one job: spawn Next's **standalone** server (`output: "standalone"` in
`next.config.ts`) as a child process on `127.0.0.1:4646` — falling back to an
OS-assigned free port if 4646 is taken, usually by `npm run dev` — and point a
`BrowserWindow` at it once it answers.

Two failures shaped it. Showing the window before the server responds renders a
connection error and the app looks broken on first launch, so the window is not
created until a probe of `/api/vault` comes back. And leaving the child alive
after quit holds the port, so the next launch cannot bind it — every exit path
kills it.

`electron-builder.yml` ships the standalone build as `extraResources` rather
than packing it into the asar, because the standalone server is a real Node
program that reads its chunks and traced `node_modules` from disk. `mcp/` is
copied alongside it: the Connections screen prints a config pointing at
`${cwd}/mcp/server.mjs`, and the server chdirs into that directory.

### Two deployment shapes (`proxy.ts`, `lib/mode.ts`)

One codebase serves two shapes, and `proxy.ts` — Next 16's renamed middleware —
is the boundary between them.

- **local** — the real app. Loopback only. Full filesystem access.
- **site** — the marketing pages only. Every one of the thirty
  filesystem-touching routes returns 404, and `/vault` redirects to `/install`.

`isSiteMode()` returns true when `LORE_MODE=site`, false when `LORE_MODE=local`,
and otherwise infers site mode from any recognised host's environment (`VERCEL`,
`NETLIFY`, `RENDER`, `FLY_APP_NAME`, `RAILWAY_ENVIRONMENT`,
`AWS_LAMBDA_FUNCTION_NAME`, `K_SERVICE`). The bias is deliberate: deploying this
repo somewhere without reading the docs cannot expose a filesystem, because the
dangerous outcome requires an explicit opt-in rather than merely forgetting to
opt out. `electron/main.js` sets `LORE_MODE=local` explicitly so a stray
`VERCEL` in the user's shell cannot 404 the desktop app's own routes.

In local mode the same file guards non-loopback callers. A request whose `Host`
is not loopback is refused with 403 unless it carries the remote token, and
repeated failures from one address are rate-limited. The loopback *bind* is the
real protection — `Host` and `x-forwarded-for` are both attacker-controlled, so
the header check is a hint that catches the accident (a container publishing the
port, a `-H 0.0.0.0`), not a peer check.

### Why local-first

Every competitor surveyed either owns your data or owns your folder layout
(`raw/` → `wiki/` skeletons). Lore's wedge is that it adapts to the folder you
already have. That forces local-first: the moment there's a server, there's a
sync story, an account, and a reason to move your files.

---

## 2. Why the approval gate was removed

Lore shipped, briefly, as an approval queue: an MCP `propose_edit` tool wrote to
a pending list, a human accepted, and only then did the file change. That design
is gone. This section exists so it does not come back.

### What the measurement showed

Against a real vault at `~/Documents/wiki`:

| | |
| --- | --- |
| Pages | 1,424 |
| Tokens | ~2.3M — 12× a 200k context window |
| Changed in 7 days | 303 |
| Changed in 24h | 56 |
| Modified files that were in-place rewrites, not appends | 60 of 75 |
| Prose deleted, unreviewed | ~1,450 lines in 15 days |
| Pages carrying an agent-written `confidence:` | 1,156 → 959 high, 202 medium, **2 low** |
| Pages carrying any human `reviewed` / `verified` field | **0** |

### Three independent failures

1. **Unenforceable.** Proved directly: a plain `Write` to a page bypassed
   `propose_edit` entirely and Lore did not notice. The gate competed with every
   agent's built-in file-write tool and lost. A local folder has a hundred write
   paths and Lore controls one of them.
2. **Redundant.** Claude Code already asks before editing files. The gate was a
   second, weaker permission layer stacked on a working one.
3. **Fails even when it works.** 303 changes a week through a gate is a 303-item
   queue. A 303-item queue resolves to "Accept All", which manufactures
   confidence — strictly worse than no gate, because now you believe something.

The self-reported `confidence:` numbers are the same failure in miniature.
Agents grade their own homework and pass 83% of the time, so the field carries no
information at all.

### What replaced it: promotion, not permission

- Agents write freely. Nothing is blocked, and no tool asks permission.
- Everything lands `unverified`. That is the honest default, because it is true.
- A human promotes what they have actually checked.
- The promotion is **pinned to a content hash**, so an agent rewriting a verified
  page lapses it automatically and it returns to the top of the list.

Trust that cannot lapse is not trust, it is a sticker.

The corollary is that Lore's position in the MCP path is worthless as a *gate*
but unique as a *sensor*. It is the only place that sees what agents ask of the
wiki, which is where the Insights reports come from.

---

## 3. The write journal (`lib/journal.ts`)

### What it records

One JSONL line per content change, in `~/.lore/journal-<vaultKey>.jsonl`:

```ts
type WriteEvent = {
  at: number;
  relPath: string;
  kind: "created" | "appended" | "rewritten" | "deleted";
  linesAdded: number;
  linesRemoved: number;
  hash: string;
};
```

`vaultKey` is the first 10 hex chars of a SHA-1 of the vault's absolute path, so
two linked wikis never share a journal.

The fields are chosen to answer one question — *did an agent quietly delete
something I cared about?* — so removals are tracked as carefully as additions,
and rewrites are classified separately from appends.

### Classification

Each write is diffed against a **shadow copy** of the file as Lore last saw it,
kept under `~/.lore/shadow/<vaultKey>/`.

- Every prior line still present, in order, at the top → `appended`. The safe
  kind.
- Anything that alters or drops prior lines → `rewritten`. The kind worth a
  human's attention. Added/removed counts come from a common prefix/suffix trim.
- No shadow → `created`. No file → `deleted`.

### Hash-authoritative, with a reconcile sweep

**A filesystem event is treated as a hint to go and re-hash, never as a fact
about what happened.** Nothing is journalled unless the content hash actually
changed — agents and editors rewrite files with identical bytes surprisingly
often, and a journal full of no-op entries is a journal nobody reads.

That design is not defensive programming; the event stream genuinely under-reports
a burst, which is exactly the shape of an agent's edits:

- **chokidar suppresses duplicate `change` events for 50ms and never emits a
  trailing one** (`_throttle(EV.CHANGE, path, 50)` — the suppressed events are
  counted and dropped). This path is live before the initial scan finishes, and
  whenever `awaitWriteFinish` is off.
- **With `awaitWriteFinish` on — which is how Lore watches — a run of writes
  collapses into a single event** emitted once the file has been stable for
  400ms. Every intermediate state is invisible, and if the process is not around
  when that timer fires, nothing is emitted at all.

So a **reconcile sweep runs every 90 seconds**: walk the vault, hash every page,
journal anything that differs from its shadow. Hashing a 1,400-page corpus is
well under a second, so this is cheap enough to run on a timer and is the only
reason the journal does not silently miss the bursts an agent produces. The
interval is a deliberate trade — frequent enough that a missed burst surfaces
while you still remember causing it, rare enough that the cost is invisible.

`awaitWriteFinish` (400ms stability, 100ms poll) is what absorbs a save that
lands in pieces: the event is held until the file stops changing, so one save is
one journal line. The unlink/add pair an editor's temp-file-and-rename produces
is collapsed by chokidar's own `atomic` handling, which is on by default for
non-polling watchers and which Lore therefore does not set.

### Cache invalidation

Every journalled change calls `invalidateVault(root)`. The scan cache (4s TTL)
has no other way to learn about a write Lore did not make, and a stale index
means reporting a page as verified after an agent has already rewritten it — the
precise failure the whole feature exists to catch.

### Lifecycle

Watching starts on the first `GET /api/review` rather than at boot: there is no
point journalling a vault nobody has opened, and it keeps startup instant. The
shadow directory is primed from the current vault on that same request, so the
first real edit produces a meaningful diff instead of reporting every page as
newly created.

Journal writes are wrapped in `try/catch` and swallowed. Observation must never
break the thing being observed.

### Attribution (optional)

The journal knows *what* changed but not *who* changed it — a filesystem watcher
cannot know. `lib/harness.ts` closes that gap for one harness: a Claude Code
`PostToolUse` hook matching `Write|Edit|MultiEdit` POSTs to `/api/harness`, which
appends to `~/.lore/attribution.jsonl` (`{ at, file, agent, tool }`).

It is opt-in, single-harness, and deliberately non-load-bearing. The hook runs
inside the user's agent loop, so that endpoint returns 204 on every path —
including malformed bodies — and never blocks or fails loudly. Writes outside
the active vault are dropped, so this stays a record of who edited the wiki
rather than a log of everything the user's tools touched.

**Collecting is all it does today.** `attributionByPath()` exists to join the log
onto `WriteEvent.relPath`, but no route and no view calls it, so Review shows
every change unattributed whether or not the hook is installed.

---

## 4. The trust model (`lib/verify.ts`)

### The ledger

`~/.lore/verified-<vaultKey>.json`, a flat map of page id → verification:

```ts
type Verification = { hash: string; at: number; by: string; note?: string };
```

It lives outside the vault so a verification never shows up in a `git diff` of
the user's notes.

### The four states

| State | Meaning |
| --- | --- |
| `unverified` | No human has ever signed this page off. The default, and the honest one |
| `verified` | Signed off, and the content still hashes to what was signed |
| `lapsed` | Signed off, then rewritten. The hash no longer matches |
| `aging` | Signed off more than **120 days** ago and untouched since |

`lapsed` is the state the product exists for. `aging` exists because a
verification with no clock quietly becomes a lie about a page nobody has looked
at in a year.

### What the hash covers

The ledger pins a SHA-1 (first 16 hex chars) of the page's **plain-text body**,
not the raw file. That is deliberate: a verification survives an agent bumping
`updated:` in frontmatter, but lapses the moment the actual prose changes.
Otherwise every automated metadata rewrite would silently invalidate work you
did check.

Trust is always computed from a **forced, uncached** index scan. A trust verdict
computed from a stale cache is worse than no verdict, because it says "verified"
about content that has already changed.

---

## 5. Triage — ranking 300 changes down to five

`triage()` scores every page written in the window and returns the top 12.
Repeated writes to the same page collapse into a single item carrying its most
severe numbers, so an agent that saved eight times does not occupy eight slots.

| Term | Weight | What it encodes |
| --- | --- | --- |
| Lines removed | `× 3` | Deletion is the risk. Agents rewrite in place far more than they append, and deleted prose is the only truly unrecoverable outcome |
| Lines added | `× 0.2` | Additions are usually fine. Present so a large new page is not invisible, small so it cannot dominate |
| Inbound links | `log₂(n + 1) × 8` | Blast radius. A bad edit to a hub propagates into every answer that walks the graph. Log-damped because 2 → 20 inbound links matters far more than 200 → 400 |
| Trust: `lapsed` | `+25` | You had checked this and an agent has since rewritten it. You are carrying a belief that may no longer hold |
| Trust: `unverified` | `+10` | Never checked — worth attention, but less alarming than a belief that has quietly gone stale |
| Kind: `rewritten` | `+12` | In-place rewrites are the dangerous shape, independent of size |

Pure additions to pages nobody links to score near zero. That is correct: it is
the bulk of the 300 weekly changes, and none of it needs a human.

Each item carries a plain-English `why` built from the same signals ("42 lines
removed · 11 pages link here · you had verified this"), because a score with no
explanation is a number people learn to ignore.

### Hubs

`hubs()` returns the ten most-linked pages with their trust state, independent of
whether anything touched them this week. They deserve verification as a standing
policy rather than by accident.

---

## 6. The usage sensor (`lib/usage.ts`)

Every MCP tool call is reported to `/api/mcp-event` and appended to
`~/.lore/usage.jsonl`. Four event shapes: `read`, `search` (with hit count),
`index`, `health`.

Two signals matter, and neither exists anywhere else:

- **Reads** — which pages actually get opened. On a 1,400-page wiki most pages
  are never read again after they are written. Knowing which carry the weight
  tells you what to keep sharp. Pages with no reads in the window are reported as
  *cold* — `coldCount` is the true total, and the payload carries the first 200
  ids.
- **Misses** — searches that returned nothing. Each one is a question the wiki
  could not answer, which is a page worth writing: a to-do list from real demand
  instead of guesswork.

**A miss is `hits === 0`, nothing else.** Low-hit searches are deliberately not
counted as near-misses: a one-result search that answered the question is a
success, and treating it as a miss would bury the real gaps under noise. Queries
are lowercased and trimmed before grouping, so `"Pricing"` and `"pricing "`
collapse into one gap.

The log is append-only JSONL, trimmed to the most recent 50,000 events on read.
A torn final line from a killed process is skipped, never fatal. Recording is
fire-and-forget in both directions — the MCP server does not await the POST, and
the route returns 204 unconditionally. An agent's answer must never be delayed by
bookkeeping.

Default report window is 30 days.

---

## 7. Context budget (`lib/tokens.ts`)

A 1,400-page wiki is roughly 2.3M tokens — 12× a 200k window. Almost nobody knows
that number about their own notes, because nothing measures it.

Counting uses a **real BPE tokenizer** (`gpt-tokenizer`), not chars ÷ 4. The
estimate is fine in aggregate and wrong exactly where it matters: markdown is
dense with punctuation, paths and code, all of which tokenize far worse than
prose. Being told a folder fits when it does not is the one failure this exists
to prevent. The tokenizer can reject pathological input (lone surrogates from a
mangled paste), so `countTokens` falls back to `length / 4` rather than failing
the whole report.

The counts are GPT-family. Claude's tokenizer differs by a few percent, which is
immaterial against a 200k window when the answer is "this folder is 1.1M tokens".

`indexTokens` is what an agent pays just to orient — the size of the generated
map from `/api/agent`.

**Outliers are relative, not absolute:** a page counts as an outlier above
`max(mean × 6, 2000)` tokens. A 4k-token page is unremarkable in a wiki of essays
and alarming in a wiki of one-liners.

---

## 8. Data model

### `WikiPage` (server, `lib/wiki.ts`)

| Field | Notes |
| --- | --- |
| `id` | Vault-relative path, no extension, POSIX separators. The stable key |
| `relPath` | Vault-relative path with extension |
| `title` | `frontmatter.title` → `frontmatter.name` → first `# H1` → filename, in that order |
| `folder` | Vault-relative directory; `""` for root-level pages |
| `tags` | Frontmatter `tags`/`tag` plus inline `#tags` found outside code |
| `frontmatter` | Parsed YAML. Server-only — stripped before the client |
| `excerpt` | First 240 chars of plain text |
| `words`, `mtime` | For the health report and list rows |
| `links` | Outgoing links **resolved to real page ids** |
| `rawLinks` | The same targets before resolution — cleaned (anchor, alias and extension stripped) but not matched against any page. Server-only |
| `plain` | Whole body as plain text. Server-only; search and hashing read it |

Inline tags have to earn their place: a candidate is kept only if it contains a
lowercase letter and is not all-caps/digits, and no more than 12 inferred tags
are kept per page. Measured on a 1,441-page vault the naive "anything after a
`#`" rule produced 71 junk tags out of 195 and gave one append-only log page 43
of them — hex ids, ticket codes, `#IFDEF`. Frontmatter tags are exempt from both
tests, because those were typed deliberately.

`rawLinks` exists because `links` is overwritten with resolved ids during
indexing. Without keeping the originals, a link that resolved to nothing would be
indistinguishable from no link at all — and the dead-link check would silently
always pass. It did, until QA caught it.

`plain` is held in the index so search never re-reads the disk. A personal wiki
is a few MB of prose; paying that once per scan beats a file read per page per
keystroke.

Malformed YAML never hides a note: the parse is wrapped, and a failure treats the
whole file as body. Files that cannot be read at all land in `index.errors` and
are surfaced in the UI rather than dropped.

### Link resolution

An `[[Exact/Path]]` match wins. Failing that, a **unique** basename match
resolves — this is how Obsidian's short `[[Page]]` form works. An ambiguous
basename is left unresolved rather than guessed.

**The two link checks do not agree, and this is a known hole.** Indexing needs a
*unique* basename to resolve; the health report's dead-link test accepts *any*
basename match. A `[[spec]]` with two `spec.md` files in the vault therefore
produces no link, no backlink — and no dead-link report either. It is invisible
in both directions.

### Scan scope

`.md` / `.mdx` only. `.git`, `.obsidian`, `.trash`, `.smart-env`, `node_modules`,
`.next`, `__pycache__` and dot-directories are skipped — the point is to sit on
top of an existing Obsidian vault without indexing its config or its bin.

---

## 9. Path safety

Lore is an HTTP server with filesystem write access, so there are two boundaries
and they answer different questions. `proxy.ts` decides **who may call** (§1);
`resolveInVault()` decides **what a call may touch**. Every read and write
resolves the requested path against the vault root and throws if the result
escapes it:

```ts
const absolute = path.resolve(root, relPath);
const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
if (absolute !== root && !absolute.startsWith(rootWithSep)) {
  throw new Error("Path escapes the vault.");
}
```

Verified against a running instance: `GET /api/page?path=../../../../../etc/passwd`
returns `{"error":"Path escapes the vault."}` with 404 and
`PUT /api/page {"path":"../../../../../tmp/pwned.md"}` returns the same error
with 400. Neither reads nor writes anything.

The MCP install endpoint takes the server path from `process.cwd()` rather than
from the request body, so a stray caller cannot write an arbitrary command into
an agent's config file.

---

## 10. HTTP API

Seventeen routes, all `runtime: "nodejs"`, `dynamic: "force-dynamic"`. Errors
return `{ "error": "message" }` with a non-2xx status. A read that needs a vault
when none is linked returns 409; the exceptions are `/api/page`, which answers
404 on `GET` and 400 on the write verbs, and `/api/vault`, `/api/pick` and
`/api/remote`, which need no vault at all.

### Vault

| Method | Route | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/vault` | — | `{ vaults, activeVault, suggestions }` |
| `POST` | `/api/vault` | `{ action: "link", path }` | `{ vault }` |
| `POST` | `/api/vault` | `{ action: "activate" \| "unlink", root }` | `{ ok }` |
| `POST` | `/api/pick` | — | `{ path }`, `{ cancelled: true }`, or 501 |

`suggestions` is only computed on first run. It probes seven common locations and
reports only those that exist *and* already contain markdown — a suggestion the
user has to verify is worse than no suggestion.

`/api/pick` shells out to `osascript` for a native folder picker and returns 501
(not an error) off macOS, so the UI can fall back to the text field without
treating it as a failure. The browser cannot do this job: the File System Access
API is Chrome/Edge-only, and its handles expose no path — so a vault chosen that
way could not be handed to the MCP server or written to Lore's config.

### Pages

| Method | Route | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/pages` | `?refresh=1` forces a rescan | full `VaultIndex` |
| `GET` | `/api/folder` | `?path=` `?offset=` `?limit=` | `{ folder, sections, incoming, totals, total, offset, limit, hasMore }` |
| `GET` | `/api/page` | `?path=` | `{ page, frontmatter, raw, backlinks, outgoing }` |
| `PUT` | `/api/page` | `{ path, content }` | `{ ok, savedAt }` |
| `POST` | `/api/page` | `{ path, content }` | `{ ok, path }` — 409 if it exists |
| `DELETE` | `/api/page` | `?path=` | `{ ok }` |

`POST` opens with the `wx` flag, so creating never clobbers an existing note.

`/api/folder` returns pages *with their full source* in one request, because the
folder is the unit the user reads — fetching bodies lazily while they scroll
would make the document assemble itself in front of them. It is paginated
(default 40, max 200, newest-edited first) because one measured vault keeps 654
pages in a single folder and returning all of them would be a multi-megabyte
response rendering thousands of DOM nodes.

### Review and trust

| Method | Route | Body / query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/review` | `?days=` (default 7) | `{ watching, days, events, counts, triage, hubs }` |
| `POST` | `/api/review` | `{ action: "verify", pageId, note? }` | `{ ok, trust: "verified" }` |
| `POST` | `/api/review` | `{ action: "unverify", pageId }` | `{ ok, trust: "unverified" }` |

`GET` is also what starts the filesystem watcher and primes the shadow copies.
`counts` is the whole-corpus trust split; `triage` is the ranked list; `hubs` is
the standing blast-radius list.

### Insights

| Method | Route | Query | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/usage` | `?days=` (default 30) | the usage report — hot, cold, gaps, daily, agents |
| `GET` | `/api/budget` | — | the context budget — totals, per-folder, outliers |
| `POST` | `/api/mcp-event` | `{ t, agent, … }` | always 204 |

`/api/budget` tokenizes the whole vault, so it is the one endpoint that may take
a second on a large corpus. It is a page the user opens deliberately, never
polled, which makes that an acceptable trade for an accurate number.

### Search, health, agents

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/search?q=` | `{ results: [{ page, score, snippet, semantic? }], semantic }` — literal hits, then semantic ones if the embedding index is ready |
| `GET` | `/api/semantic?q=` or `?related=` | `{ results, status }` — local embeddings, empty when unavailable |
| `POST` | `/api/semantic` | schedules an index refresh; returns current `status` |
| `GET` | `/api/health` | the health report (below) |
| `GET` | `/api/agent` | the vault map as `text/markdown` |
| `POST` | `/api/agent` | writes that map into `AGENTS.md`; `?force=1` replaces the whole file |
| `GET` | `/api/harness` | what is wired up on this machine, plus the exact config snippets |
| `POST` | `/api/harness` | `{ action: "install-hook" \| "install-mcp", target }`, or a hook payload (204) |
| `GET` | `/api/ai` | `{ host, running, models, error, recommended, reason }` — what Ollama has locally |
| `POST` | `/api/ai` | `{ task: "summarize" \| "tags" \| "title", text, model?, existing? }` → `{ model, task, text \| tags }`; 503 when no local model |

`/api/ai` is the only route that talks to something other than the filesystem,
and it talks to `127.0.0.1:11434`. Lore detects Ollama and never ships it; when
it is absent the feature is absent and nothing else in the app depends on it.
The three tasks are extraction, not authorship — they compress what the page
already says, which is what a small local model is actually good at.

`POST /api/agent` fences its output between `<!-- lore:begin -->` and
`<!-- lore:end -->`. Everything outside the fence is preserved verbatim; a file
with no fence gets the map appended below what is already there. This was a
data-loss bug aimed squarely at the target user — anyone following the llm-wiki
pattern already keeps a hand-written `AGENTS.md`, and the button used to destroy
it.

### Remote access

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/remote` | — | `{ enabled, port, pairedAt, hasToken, addresses, urls, listening }` |
| `POST` | `/api/remote` | `{ action: "enable", port? }` | the same status |
| `POST` | `/api/remote` | `{ action: "disable" \| "rotate" }` | the same status |
| `POST` | `/api/remote` | `{ action: "reveal" }` | `{ token }`, `no-store`; 409 when remote access is off |

Off until switched on. `GET` never carries the token — `hasToken` is a boolean,
because a caller needs to know whether a secret exists, never what it is.

Every `POST` is refused with 403 unless the request arrives on loopback, and the
body is parsed *before* that check so a malformed remote request gets the same
403 as a well-formed one rather than a 400 that confirms the endpoint parses
input. That test duplicates the one in `proxy.ts` on purpose: `proxy.ts` is the
layer that lets a token-authenticated device through, so a paired phone that
gets past it must still not be able to mint a new secret, read the current one,
or switch remote access off and lock the owner out from across the room.

`listening` is measured rather than assumed, and measured whether the switch is
on or off, because both mismatches are worth telling the user about: on and
unreachable means the pairing link will not connect, off but reachable means the
port was opened by hand and the machine is exposed.

### Residual: the removed gate, and how long it survived

Removing the gate from the *product* did not remove it from the *tree*. Deleting
`propose_edit` from the MCP server took away the only way to create a proposal,
and the feature then looked gone from every angle a user could see: the queue was
always empty, so the accept/reject UI never rendered.

Underneath, all of it was still wired up. `lib/proposals.ts` still carried a
header comment asserting the removed design word for word — *"agents never write
directly … nothing touches the vault until a human accepts it"* — `/api/folder`
still attached pending proposals to every section, the folder document still had
an **Accept all** / **Reject all** bar, and `POST /api/proposals` was still live
on loopback and could still write into the vault through `writeRaw`/`createPage`.

A doc audit found it. **It is now deleted** — the module, the route, the
`/api/folder` fields, the inline diff UI, the ghost "incoming page" sections, and
the entry in `proxy.ts`. `/api/proposals` returns 404; the API surface is 16
routes, not 17.

Worth keeping the shape of this in mind, because it is the same failure as the
dead-link bug and the stale-cache trust bug: **the visible surface agreed with
the intended design, so nothing prompted anyone to check the layer underneath.**
An empty queue and a removed queue look identical from the UI. The difference was
a live write path into the user's wiki that no longer had any legitimate caller.

---

## 11. Search ranking

Deliberately **not** fuzzy. On a personal wiki an exact-ish title match is almost
always the thing you meant, and fuzzy ranking buries it under coincidental body
hits.

| Signal | Score |
| --- | --- |
| Exact title match | +100 |
| Title starts with query | +60 |
| Title contains query | +40 |
| Tag contains query | +25 |
| Path (page id) contains query | +15 |
| Body contains query | +10 |

The three title bands are exclusive — a title scores once, at its best band.
Everything else adds on top. Ties break on `mtime`, newest first, and the top 40
are returned. Snippets are centred on the match (60 characters of lead-in, 200
total), not taken from the top of the page, so the user sees the hit rather than
the first 200 characters of an unrelated intro.

### Semantic results are additive

`/api/search` appends up to 12 semantic hits after the literal ones, and only
when the local embedding index reports `ready`. They carry `semantic: true` and a score of
`-1`, which sorts them below every literal hit without needing a label — a vector
neighbour is a suggestion, not a match. Literal search stays primary because an
exact-ish title hit is almost always the thing you meant; semantic exists because
literal alone fails on real questions ("how do I undo a deploy" finds nothing on a
wiki whose page says "Rollback is a revert commit"). If the index is still
building, failed, or the model never downloaded, search silently degrades to
literal only.

---

## 12. Health report

| Check | What it means |
| --- | --- |
| **Orphans** | No backlinks *and* no outgoing links. An agent walking your links never reaches them |
| **Dead links** | A `[[wikilink]]` or relative markdown link whose target matches no page, counted once per link rather than per target. Each one is a page you meant to write |
| **Stale** | Past its review window |
| **Untagged** | The cheapest findability signal, missing |

### Staleness windows

A single global threshold either screams about everything or catches nothing, so
the window is chosen by what the page is about — matched against its id and
title. **First rule that matches wins, in this order:**

| Pattern | Window |
| --- | --- |
| `pricing`, `cost`, `rate`, `invoice` | 30 days |
| `tool`, `stack`, `version`, `setup`, `install`, `config` | 90 days |
| `client`, `project`, `status`, `roadmap` | 60 days |
| everything else | 180 days |

The order is load-bearing and not obviously right: a page called
`client-stack-setup` matches both the 90-day rule and the 60-day rule, and gets
90 because that rule is tested first.

### Score

```
max(0, round(
  100
   − (orphans / pages) × 35
   − min(deadLinks / pages, 1) × 30
   − (stale / pages) × 20
   − (untagged / pages) × 15
))
```

Weighted so the two things that actually make a wiki unusable to an agent —
orphans and dead links — cost more than a missing tag. Only the dead-link term
is capped, because it is the only count that can exceed the number of pages: one
page can hold twenty broken links.

---

## 13. Markdown rendering

`marked` with GFM, plus two pre-passes for syntax markdown doesn't own.

**Order matters.** Fenced blocks and code spans are masked out *first*, so a
`[[` inside a code sample isn't rewritten into a link and stops being the thing
it documents. The mask token is prefixed (`LOREMASK<n>`) rather than a bare
number, because an unprefixed numeric placeholder also matches a year or a
version in the prose and corrupts it on the way back out.

- **Wikilinks** resolve to the target's *title*, not its path —
  `[[stack/deploy-pipeline]]` reading as "Deploy pipeline" mid-sentence is the
  difference between a wiki and a file listing. An explicit `|alias` always wins.
  Unresolved links render with a dashed border: an unbuilt page is a to-do, not
  an error.
- **Inline tags** render as pills, matched only when preceded by whitespace or
  `(`, so a `# heading` is never mistaken for one.
- **A leading `# H1` that repeats the page title is dropped**, since the title is
  already in the section header and rendering both makes every page look broken.

Raw HTML passes through, matching Obsidian. These are the user's own local files
rendered in their own browser — there is no untrusted author to sanitise against,
and stripping it would break every note that embeds a table or `<details>`.

---

## 14. Design system

Adapted from Creed (MIT). Tokens live in `app/globals.css`: surfaces and text as
`--lore-*`, plate colours as `--pal-*`, the sky fades as `--scenery-*`, plus the
Tailwind-facing aliases (`--background`, `--foreground`, `--card`, `--border`,
`--muted`) that `@theme inline` maps to utility classes. `.dark` redefines every
one of them.

**Two-surface structure, both themes.** A page background, a raised surface, and
hairline borders — light mode on warm near-white (`#f9f9f8`), dark on near-black
(`#0e0e0d`) with foreground pulled off pure white so long reading stays easy.

**Action colour** is `#2563eb`, held constant across both themes — primary CTAs,
sign-off buttons, focus rings. Holding it fixed is what makes it read as *the*
brand colour rather than a theme variable.

**Plates** carry the product's colour identity. Eight slots (`--pal-1` …
`--pal-8`) — Creed's five plate hues plus three from the same family — assigned
by stable index in `lib/palette.ts`. Every folder and every page owns one, so a
wiki reads as a set of coloured objects rather than a grey file list.

Each slot has three values, because one colour cannot do all three jobs:

| Var | Job |
| --- | --- |
| `--pal-N` | saturated fill: solid panels, module frames, section rules, dots |
| `--pal-N-tint` | pale wash behind coloured type |
| `--pal-N-ink` | darker companion that stays legible *on* that tint |

Components set them as inline custom properties (`--plate`, `--plate-tint`,
`--plate-ink`) via `paletteVars(i)` rather than class names, so one stylesheet
rule serves all eight slots and Tailwind never sees a dynamically-built class it
would purge.

Folders take their slot by **position** in the sidebar, and pages by **position
within the folder** — adjacent items are therefore never the same colour. An
earlier version hashed the page id, and two adjacent sections promptly collided,
which is precisely what the colour exists to prevent. `slotForKey()` (hashed)
survives for views where there is no meaningful position, such as the two panes
of Compare.

**Type.** The landing page has six named classes in `app/globals.css` —
`.t-hero`, `.t-section`, `.t-step`, `.t-lede`, `.t-body`, `.t-meta` — and the
rendered-note surface has its own (`.lore-prose`, 16px/1.75). The app's own
chrome has no such classes: it sets sizes inline as Tailwind arbitrary values,
clustered on 26px view titles, 18px section titles, 15px body, 13px meta and
11px labels. That cluster is a convention, not a constraint — big tabular
numerals (30/40/42px) and a handful of one-offs (9, 10, 12, 14, 17, 22, 27px)
exist outside it, so a size does have to be chosen by hand when a new view is
added.

**Squircle bullets, never round dots** (`border-radius: 0.13em` on a `0.4em`
square) — the one detail that stops a markdown list reading as browser default.

**The section marker is a short pill, not a full-height rule** (`.pal-bar`:
3px × 2.25rem, beside the title). A rule spanning the whole section turns a long
page into a stack of bracketed blocks; the pill marks the heading and lets the
body align flush with it.

### Scenery

Sky art is never cropped hard against the page; it melts through a multi-stop
eased gradient. `--scenery-fade-down` melts art downward into the page (hero,
onboarding); `--scenery-fade-band` is a matched pair of fades around a clear
centre, framing the closing band so it joins both the section above and the
footer below with no visible seam. Stops are densely sampled along an ease curve;
a naive three-stop gradient bands visibly against a photographic sky.

Twelve assets in `public/assets/landing/scenery/` — six scenes, each a
`hero-N.png` / `hero-N-dark.png` pair. The dark version of each is the *same
composition at night*, produced by editing the light original rather than
generating separately, so the theme toggle reads as a change in time of day
rather than a swap between two unrelated pictures.

**One scene is picked per request** (`lib/scenery.ts`), so the page greets you
differently every visit without ever looking like a different product. The roll
happens on the server and is passed down as a prop: a client-side roll would
either mismatch the server's HTML during hydration or leave the hero blank until
after first paint. This is why `app/page.tsx` is `force-dynamic` — the rotation is
its only dynamic input. The closing band reuses whichever scene the hero drew,
anchored to the foot of the image, so the page opens and closes in the same world
with no second set of assets to keep in sync.

`SceneryImage` self-heals: if a file 404s it renders a labelled placeholder
naming the exact path to drop the art into, so a half-finished fork never ships a
silent blank band.

---

## 15. Motion

Four primitives in `lib/anim.ts` drive everything that moves, so the whole site
shares one easing curve (`EASE = [0.22, 1, 0.36, 1]`).

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
- **A resting frame, not frame zero.** Every looping demo declares a `restStep` —
  the frame that best explains the idea as a still. Under
  `prefers-reduced-motion` it parks there and never advances.

The landing page's product shot is a working replica of the app, not a picture,
and is rendered at the app's **real type scale** rather than shrunk to fit. An
earlier version squeezed the same content into 11–14px and the result read as a
*diagram of* a product rather than the product. If the shot needs to be smaller,
the card gets smaller — the type does not. The document measure inside it is a
centred 700px column; letting the body run the full width of the pane makes every
screen look airy and unresolved.

`components/marketing/browser-chrome.tsx` frames it with real traffic-light
colours and a centred address pill, because three flat grey circles read as a
placeholder. It is entirely decorative and `aria-hidden`, so a screen reader is
never offered a browser toolbar that does nothing.

### Layout note

Grid and flex items default to `min-width: auto`, so a single `nowrap` element
inside a demo card can prop an entire section open past the viewport — this
happened, and cost 27px of horizontal overflow at 375px. Demo cards therefore
carry `min-w-0 overflow-hidden`, and every grid that holds one carries
`min-w-0`.

---

## 16. MCP server

`mcp/server.mjs` — stdio JSON-RPC 2.0, zero dependencies. The protocol surface
needed is four methods (`initialize`, `tools/list`, `tools/call`, `ping`) plus
swallowing the `notifications/initialized` notification, so a dependency would
cost more than it saves. Protocol version `2025-06-18`. Anything else answers
`-32601`.

Four tools: `wiki_index`, `wiki_search`, `wiki_read`, `wiki_health`. **No write
tool, no delete tool, no shell, no `propose_edit`.** Four rather than twenty-one
because an agent that has to choose between twenty-one overlapping tools spends
its budget choosing.

One detail in the tool surface is load-bearing:

- A zero-result `wiki_search` returns *"No pages match … This gap has been logged
  for the human to fill."* The wording nudges the agent to say so out loud instead
  of quietly inventing an answer, and the miss is the most valuable thing the
  server can observe.

Tool failures return a `result` with `isError: true` rather than a protocol
error, so the agent sees the message and can recover. The error text names the
likely cause — "Is Lore running?" — because a dead local server is the failure
mode most of the time.

### Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `LORE_URL` | `http://127.0.0.1:4646` | Where the app is listening |
| `LORE_AGENT_NAME` | `MCP agent` | The name this client is logged under in Insights |

---

## 17. The observers — Lore and the machine it runs on

Everything above this section is about a folder of markdown. This section is
about the other half of the product: seven features that read the computer Lore
is installed on. They share a foundation, a consent model and a set of promises,
and those are documented here once rather than seven times.

### 17.1 What they are

| Feature | What it reads | What it gives you |
| --- | --- | --- |
| **Ghost** | Your screen, every few seconds | "What was that error twenty minutes ago" |
| **Ledger** | Transcripts your AI tools already keep | One search box over every AI conversation |
| **Oracle** | Files, mail, calendar, Messages, Notes, browser history, photos | One question across your whole digital life |
| **Understudy** | Writing you have already done | Drafts measured against how you actually write |
| **Twin** | Folders you nominate | Notices repeated filing and offers to take it over |
| **Chorus** | Only the question you type | Several models argue, then answer, and name the split |
| **Prophet** | What the other observers found | Speaks first, when it has something worth saying |

Chorus is the odd one out and is grouped here anyway: it observes nothing, but
it is the only other feature that is about the machine rather than the wiki.

### 17.2 Consent (`lib/observers.ts`)

One file decides whether any observer may run, and every one of them asks it
before doing anything.

```
mayObserve(id) === enabled(id) && !paused && !quietHours
```

Four properties, all deliberate:

- **Off by default, individually.** There is no master switch that turns on six
  things at once. `DEFAULT_OBSERVERS` has every `enabled` set to `false`, and
  `scripts/test-observers.mjs` asserts it.
- **The check is per tick, never cached.** A job that was allowed when it was
  scheduled asks again every time it fires, which is what makes pausing take
  effect within one tick rather than one restart.
- **It fails closed on anything that is not literally `true`.** A hand-edited
  `"enabled": "yes"` is not consent. This is checked twice — once when the file
  is parsed and once at the gate — because the gate accepts a config object from
  any caller.
- **Every change is logged.** `~/.lore/observers-log.jsonl` records what was
  switched and when, so "how long has this been watching me" has an answer.

Pause is a *timestamp*, not a boolean. A boolean plus a `setTimeout` resumes
silently across a restart; a deadline survives one.

Quiet hours wrap midnight. `22:00–07:00` is the shape everybody configures and
the naive comparison is false for every hour of it, so both directions are
handled and both are tested.

### 17.3 Storage (`lib/signal-store.ts`)

The wiki half of Lore stores everything as append-only JSONL, which is right for
a few thousand records read whole. The observers are a different size of
problem: Ghost writes a frame every fifteen seconds, Ledger indexed 2,090
conversations and 55,403 messages on the development machine, and Oracle wants
every email on the disk in one searchable place.

So: SQLite with FTS5, one database per observer under `~/.lore/db/`.

`node:sqlite` — the engine inside Node itself. No native module, no `node-gyp`,
no `electron-rebuild`, no prebuilt binary to miss an architecture. The packaged
desktop app gets the same engine as `next dev` because it is the same engine.

It is reached through `process.getBuiltinModule("node:sqlite")` rather than
imported. A static import of a module a given Node might not have is a boot
failure for the whole server; and Next's bundler rewrites static specifiers, so
it tries to inline a builtin that has no browser equivalent. The first attempt
used `createRequire(import.meta.url)`, which works under plain Node and returns
null under Turbopack — so every observer reported "this build of Node has no
SQLite" on a Node that plainly had it.

One database per observer is a privacy decision as much as an engineering one:
"delete everything Ghost knows about me" is `rm`, not a migration. `dropDb`
removes the `-wal` and `-shm` sidecars too, because deleting only the `.db`
leaves a write-ahead log holding the very rows the user just asked to be rid of.

**Reading other applications' databases.** Messages, Notes, Photos and every
Chromium browser keep a live SQLite file that is frequently locked. `openForeignCopy`
snapshots it and its WAL sidecars to a scratch directory and opens the copy
read-only, so Lore can never be the reason somebody's message history is
corrupt.

**FTS5 queries are always escaped.** `-`, `*`, `"`, `:`, `(`, `^` and the bare
words `AND`/`OR`/`NOT` are query syntax. Passing a human sentence through
unescaped either throws on the apostrophe in "client's" or silently reinterprets
"not found" as a boolean negation and returns the opposite of what was asked —
and both have the same symptom in the UI. `ftsQuery` quotes every token;
`ftsLadder` degrades from AND to OR so a five-word question with one absent word
still finds something.

### 17.4 The background loop (`lib/daemon.ts`)

One loop, inside the Next server process that is already running.

Deliberately **not** a separate daemon. A second process is a second thing to
install, supervise, update, kill on uninstall and explain in a support thread,
and its only advantage is surviving the app being closed — which for a tool that
watches your screen is a liability rather than a feature. Quitting Lore stops
Lore watching.

| Job | Every | Gated on |
| --- | --- | --- |
| `ghost:capture` | the user's setting (default 15s) | ghost |
| `ghost:describe` | 25s | ghost |
| `ghost:forget` | 1h | **nothing** |
| `ledger:index` | 10m | ledger |
| `oracle:index` | 5m | oracle |
| `twin:watch` | 60s | twin |
| `twin:mine` | 30m | twin |
| `twin:run` | 2m | twin |
| `understudy:learn` | 6h | understudy |
| `prophet:think` | 3m | prophet |

`ghost:forget` is ungated on purpose. Retention *deletes* things; skipping it
while Ghost is paused would mean pausing quietly extends how long the
screenshots are kept, which is the opposite of what pausing is for.

Jobs cannot overlap themselves, failures back off exponentially to a ten-minute
ceiling, and nothing throws out of the loop — an unhandled rejection in a
background timer takes the whole server with it under Node's defaults, and the
server is also the user's wiki.

### 17.5 Ghost (`lib/ghost.ts`)

Three loops that never block each other: capture (cheap, does no thinking),
describe (expensive, a queue rather than a step), forget (hourly).

**Capture.** `screencapture -x -o -t jpg -D n`, then `sips -Z 1440` to shrink
it. The order matters and is the privacy design: the frontmost application is
checked FIRST, and if it is on the never-capture list the function returns
without ever invoking the shutter. There is no moment at which a 1Password
window exists as a file on disk. The default list is eleven password managers.

Not knowing which application is in front is a reason NOT to capture. macOS
answers that question through Automation permission, which is separate from
screen recording and routinely absent while it is granted — and a first version
read `if (app && excluded.includes(app))`, so on exactly that machine the
never-capture list did nothing at all. Three reviewers found it independently.
Failing closed costs Ghost entirely on a Mac without Automation permission, so
it is a setting (`captureWhenAppUnknown`) rather than a rule, and the default is
the safe one.

`-D n` is not optional either. Given one output path and three screens,
`screencapture` writes three files and only the first was recorded — the other
two being screenshots that no retention pass and no "forget everything" could
ever reach. Capturing every display means one invocation per display, each
recorded as its own frame.

**Deduplication.** A 64-bit average hash via a 16×16 BMP that `sips` renders —
a decoder Lore does not have to ship and a format simple enough to read in
twenty lines. Frames within 5 of 64 bits are the same scene: a moving cursor, a
blinking caret and a ticking clock all read as unchanged, while a tab or window
switch does not. At one frame every fifteen seconds a working day is 2,880
captures and fewer than one in eight is a genuinely new scene.

**Description.** A local vision model writes two things per frame: one sentence
naming the app and the task, and the visible text verbatim. Both go through the
same secret scrubber the transcript listener uses, so a key on screen becomes a
redaction in the index rather than a searchable secret.

The vision model is chosen as *the largest under 24 GB*. Largest, because
describing a screen is comprehension and a small model produces confident
nonsense; under a ceiling, because a model that cannot finish between frames
produces a permanent backlog and evicts whatever Ask had resident.

**Recall.** `parseWhen` turns "twenty minutes ago" into a window before any
retrieval happens — a model asked to output a timestamp will cheerfully output a
plausible one. The window is a *filter*, not a ranking signal: if the asker said
"twenty minutes ago" then a perfect text match from Tuesday is the wrong answer.
When the words match nothing but the moment was named, frames are sampled evenly
across the window rather than taking the first N.

Frames are served `no-store`. They were `immutable, max-age=86400` on the
reasoning that a frame id never points at different pixels — but SQLite reuses
rowids after a delete, so forgetting a frame and capturing another re-serves the
deleted screenshot for the rest of the day. "Forget this frame" has to mean it,
including in the cache of the tab that showed it.

Measured on the development machine: capture 1.2 s, description 7 s, recall
11.5 s end to end.

### 17.6 Ledger (`lib/ledger.ts`)

Full-text first, on purpose. The failure mode of an "AI memory" product is a
semantic index that returns vibes; you searched for `createReadStream` because
you remember typing `createReadStream`, and an exact match is not a lesser
answer than a plausible one. The local model sits on top, never in between.

Sources: Claude Code JSONL, Codex rollouts, Cursor and Windsurf's `state.vscdb`
key-value store, the Claude desktop app's session records (used for *titles*,
which the JSONL transcripts do not carry), and exports dropped into
`~/.lore/ledger/imports` — both ChatGPT's message graph and Claude.ai's flat
array are understood.

Incremental by file fingerprint (size + mtime). Measured: a first pass over
2,090 conversations took 63 s; the next pass skipped 2,084 files in 1.0 s.

**Titles are not the first user turn.** That rule produced eight consecutive
rows reading `Base directory for this skill: …/fiverr-inbox`, which identifies
the skill and not one of the eight conversations. Slash-command wrappers, hook
announcements, resumed-session caveats and system reminders are stripped and
skipped; if every human turn is machinery, the assistant's opening line is used.

### 17.7 Oracle (`lib/oracle.ts`, `lib/oracle-sources.ts`)

Seven adapters, one shape: `probe()` says whether the source exists on this Mac
and why not, `collect()` is an async generator so a mailbox of eighty thousand
messages costs one message of memory at a time.

Three parsing hazards, all of which shipped as bugs before they were fixed:

- **Big integers.** `message.date` on a modern Mac is nanoseconds since 2001 —
  about 8.1 × 10¹⁷, two orders of magnitude past what a JavaScript number holds
  exactly. `node:sqlite` does not round it; it refuses the row outright, which
  took the entire Messages source down with one throw. The epoch conversion now
  happens inside SQL. Chromium's microseconds-since-1601 had the same problem.
- **Mixed units in one column.** Messages switched from seconds to nanoseconds
  in macOS 10.13 and did not migrate the old rows, so a single database holds
  both.
- **Sentinels.** A real calendar on the development machine has rows whose
  `start_date` decodes to February 1604. `appleTime` rejects anything before
  1990 or more than a decade out.

Newer Messages rows leave `text` null and put the message in an
`NSKeyedArchiver` blob; `decodeAttributedBody` scans it for its longest
printable run, which is the message, because the rest of the archive is class
names. Apple Notes stores each note as a gzipped protobuf, handled the same way.

Passes are **bounded** — a few thousand items per source — so a first index of a
decade of mail completes over several passes rather than in one twenty-minute
stall, and can be interrupted without losing what it already did.

**Two cursors, not one.** A single forward cursor is wrong for every source that
yields newest-first, which is most of them: the first pass takes the newest N
and advances the cursor past them, and the second correctly finds nothing newer
and reports the source COMPLETE with a decade unread. Reproduced against real
browser history: 150 rows, then "complete" forever. So each source keeps `since`
(walk forward for new things) and `backfill` (walk backward through history),
and claims completion only when a backward walk has RUN and found nothing NEW.

"Nothing new" rather than "nothing at all", because rows whose timestamp is
unusable — a history entry with `last_visit_time` of zero — are re-yielded by
the `< bound` query on every pass forever, and testing for an empty yield meant
the source never once finished. After the fix, the same history walks
150 → 296 → 341 rows across five months and settles on the fourth pass.

Only timestamps in the PAST advance the forward cursor. The calendar stores
recurrences expanded years ahead — a real one on the development machine runs to
2031 — and one of those setting `since` means nothing is ever "new" again.

**Direction lives in `meta`, not in `who`.** Messages writes the counterparty
into `who` for both directions and Mail writes "sender → recipient", so nothing
downstream can tell who spoke last from that string. Prophet's awaiting-reply
card was unreachable for precisely this reason until the adapters started
recording `meta.fromMe` — mail deriving it from the Sent mailbox path.

### 17.8 Understudy (`lib/understudy.ts`, `lib/voice-core.ts`)

The measurements, not a description. Median sentence length, contraction rate
against contraction *opportunities*, punctuation habits per thousand words,
opener and closer phrases, and the words this person uses far more than baseline
English. Those go into the prompt as numbers, and the draft is measured the same
way afterwards and scored against them — so "sounds like me" becomes a diff
rather than an opinion, and a draft that reads wrong has a named reason
attached.

Audiences are separate profiles. The same person writes to a client and to a
friend differently, and one averaged voice is nobody's. An audience needs eight
samples before it gets its own numbers; below that the profile would be built on
a rounding error.

The stylometry lives in `lib/voice-core.ts` — pure, no filesystem, no model, no
network — following the same split as `index-core`, `health-core` and
`trust-core`. That is what lets the browser build run the real measurements over
a folder opened in a tab.

**It has no network path.** Not "we don't train on it": there is no code in this
module that opens a socket, and drafting refuses any provider that is not the
local Ollama. The corpus is somebody's private mail and messages, and the only
defensible design is one where it physically cannot go anywhere.

### 17.9 Twin (`lib/twin.ts`)

**What it watches:** files appearing, disappearing and moving inside folders you
nominate, and which application is in front. That is all. There is no keylogger
and there will not be — system-wide keyboard capture on macOS requires an
accessibility hook that can read every password you type, and no pattern worth
finding justifies building that.

A move is an unlink and an add with the same basename inside five seconds; the
filesystem does not report moves across directories and nothing else connects
them. A delete is recorded only once its move window closes with no matching
add, or every move would be logged twice.

**An automation is a rule, not a script.** It would have been less code to have
the model write shell and run it, and that would be a remote-code-execution
feature with a friendly name: a background process executing model-authored
shell against a home directory, where a hallucinated `rm` costs a folder. A rule
is a trigger plus a short list of verbs this file implements — move, copy,
sort-by-date — so it can be read in full before it runs, dry-run against real
files, and undone afterwards. The model still writes the *sentence* describing
it, which is the part it is good at.

New rules start in dry-run: they report what they would do and move nothing
until a person, having read a list of real files, decides otherwise. Runs are
capped at fifty files, so a mistake is fifty files to undo rather than two
thousand. `moveFile` falls back to copy-then-delete on `EXDEV`, because `rename`
fails the moment the destination is on another volume — which is exactly where
people file things.

Pattern signatures are joined with the ASCII unit separator, not a space: the
fields are paths, and `~/Documents/Client Work` would split into three.

### 17.10 Chorus (`lib/chorus.ts`, `lib/chorus-providers.ts`)

The only part of Lore that talks to the internet, isolated in one module for
exactly that reason.

Three rounds: independent answers in parallel, blind cross-critique, synthesis.

**The critique round is blind.** Panelists see the other answers labelled "A",
"B", "C" with no provider names attached, because a model told it is reviewing
Claude behaves differently from one reviewing an unattributed answer.

**The synthesis must name the split.** Its instruction says the disagreements
are the most valuable output, and the UI pulls them out above the answer. On a
hard question the disagreement between models is more informative than any
single confident paragraph, and smoothing it away destroys the only advantage of
having asked more than one.

One panelist failing does not stop the debate — a panel of two is still a panel,
and losing the whole run to one expired key is not acceptable. The chair is the
first panelist that actually *answered*, not `panel[0]`, which on a run where
the first provider's key had expired would hand the synthesis to a model that
failed.

**Keys** are read from the environment first, then from `~/.lore/chorus-keys.json`
at mode 0600 — created with that mode *before* the key is written, because
`writeFile`'s mode only applies when it creates the file and a pre-existing 0644
would leave the key world-readable. No endpoint returns a key, a prefix, a
length or a masked form. Provider error bodies are redacted before they reach a
screen, because some shapes echo the request back.

### 17.11 Prophet (`lib/prophet.ts`)

The failure mode is not "it misses something", it is "it becomes noise". An
agent that speaks when it has nothing to say gets muted within a week, and a
muted agent is worth nothing.

- Every card has a weight and the bar is high. Cards below it are computed,
  stored and never shown.
- Dismissing teaches it. Two dismissals of a kind halve its weight; six take it
  near zero, which puts every card of that kind permanently under the bar.
  Acting on one pulls it back.
- Every card has a dedupe key, so the same meeting does not produce a new card
  every three minutes. A dismissed card is never re-raised.
- It has **no sources of its own**. Every card derives from an observer the user
  already switched on, so the screen says which of them are live rather than
  leaving a permanently empty board to be interpreted.

Card kinds: meeting soon, meeting prep, gone quiet (median inter-contact gap
exceeded threefold — median, not mean, because one three-month silence in a
weekly correspondence would drag a mean far enough that nothing ever looks
late), awaiting reply (only for people who normally *do* reply, and only past
the time they normally take), monthly habit, a Twin pattern, and questions the
wiki could not answer.

### 17.12 Letting agents ask (`app/api/machine/route.ts`)

Lore already sits between your agents and your wiki over MCP. The observers add
three tools to that server:

| Tool | Reads |
| --- | --- |
| `machine_recall` | Ghost's screen observations, with a time window parsed from the question |
| `machine_conversations` | Ledger's index of past AI conversations |
| `machine_find` | Oracle's index of files, mail, calendar, messages and notes |

**This is its own consent, and off by default.** Switching Ghost on means a
model *on this machine* describes your screen. Answering an MCP call means what
it saw can be handed to whatever agent is connected — frequently a frontier
model on hardware you do not own. Those are different decisions, they are stored
in different fields (`shareWithAgents`), and the switch for the second one says
so in as many words.

The tools are listed to the agent even when sharing is off, and refuse with a
sentence the agent can relay: *"the person using this computer can turn it on
under Settings → What is watching"*. Hiding them would leave the agent saying
"I cannot do that", which is both less useful and less true.

Availability is computed from whether a feature has ROWS, not from whether its
consent timestamp is set. The first version keyed on the timestamp and reported
Ledger unavailable while it was answering with two thousand indexed
conversations, because that index had been built by a script rather than through
the switch.

### 17.13 Platforms

| | Local server | Desktop app | Browser (`/web`) | Deployed site |
| --- | --- | --- | --- | --- |
| Ghost | ✓ | ✓ + hotkey | — | — |
| Ledger | ✓ | ✓ | — | — |
| Oracle | ✓ | ✓ | — | — |
| Understudy | ✓ | ✓ + hotkey | measurement only | — |
| Twin | ✓ | ✓ | — | — |
| Chorus | ✓ | ✓ | — | — |
| Prophet | ✓ | ✓ + notifications | — | — |

The deployed site has no machine to observe and every filesystem route returns
404 there; `detectCapabilities` short-circuits in site mode rather than
reporting the *host's* capabilities as the visitor's.

In a browser tab the five that cannot run say so with a designed screen naming
what the feature does and why a page cannot do it — the browser's inability here
is a security property, not a gap. Understudy is the exception: its measurements
are pure arithmetic over pages the tab already has, so they run for real and
only drafting needs the app.

**Desktop additions.** The shell writes `~/.lore/desktop.json` with the
screen-recording permission status, which is answerable only through
`systemPreferences.getMediaAccessStatus` in the main process; the file is
rewritten every launch, removed on quit, and treated as stale after a day.
Global shortcuts are ⌘⇧G for Ghost and ⌘⇧D for Understudy — the two features
whose value is being available while another application is in front —
registered with the return value checked, because a shortcut another app already
owns fails silently. A menu-bar item carries the pause switch, and Prophet's
notifications are polled from the server so the threshold decision stays in one
place.

### 17.14 What is deliberately not built

- **Keyboard and mouse capture.** Twin's pitch mentioned them. Building it means
  an accessibility hook that reads every password typed on the machine.
- **Model-authored shell scripts.** See 17.9.
- **Ghost on Windows and Linux.** The capture path is `screencapture`; the
  feature reports itself unsupported elsewhere rather than half-working.
- **Cloud models for Understudy.** See 17.8.
- **Reading Claude.ai and ChatGPT directly.** Those conversations live on a
  server. Ledger reads their exports and says so, rather than listing them as
  sources and quietly indexing nothing.

---

---

## 18. Known limitations

Stated plainly rather than discovered later.

**Watching**

- **Nothing is journalled while Lore is not running.** Writes made with the app
  closed are caught by the next reconcile sweep, but they are timestamped at
  *detection* time, not at write time, so their position in the timeline is
  wrong.
- **Watching starts on the first Review load**, not at boot. In a session where
  Review is never opened, the journal does not advance and the reconcile timer
  never starts.
- **The reconcile sweep cannot see a deletion.** It walks the files that exist
  and compares each to its shadow, so a page deleted while Lore was closed is
  never journalled and its shadow copy stays behind. If a page is later created
  at that same path, it is classified as a rewrite of the old content rather
  than as a new page.
- **The journal has no author.** A filesystem watcher cannot know who wrote a
  file. The optional Claude Code hook records one, for that harness only, into
  `~/.lore/attribution.jsonl` — and nothing reads that file back, so no view
  shows an author today.
- **`WriteEvent.hash` is recorded but never read.** It hashes the raw file; the
  ledger pins a hash of the plain-text body, computed separately at verify time.
  The two are not comparable, and the field is currently vestigial.

**Trust**

- **Verification is whole-page and binary.** There is no section-level sign-off,
  so a one-line fix to a long verified page lapses the whole page.
- **`by` is always `"me"`.** There are no accounts, so the ledger's author field
  carries no information in a multi-person setting.
- **The `note` field is stored but the UI never sets it.** The API accepts it.
- **Trust does not reach the agent.** Neither `/api/page` nor `wiki_read`'s
  output carries a trust state — `PageMeta` has no such field — so an agent
  cannot prefer verified pages or flag unverified ones. `wiki_read`'s
  description used to tell the model to do both; the sentence was removed rather
  than left promising something the payload does not deliver. Trust is a
  human-facing signal only, until the field ships.
- **Decay is a fixed 120 days for every page**, even though the health report
  already knows that different kinds of content rot at different rates. Those two
  clocks should agree and do not.

**Scale**

- **Health and budget recompute over the whole vault on every request.** The 4s
  index cache spares the file reads, never the work: health walks every page's
  links and budget re-tokenizes every page. Fine to a few thousand pages; beyond
  that it wants incremental indexing.
- **The Duplicates and Schema lenses fetch page bodies from the browser.**
  Duplicates walks `/api/folder` a page of sections at a time and yields to the
  browser between work units (`requestIdleCallback`, falling back to
  `setTimeout`); Schema fetches `/api/page` per page through a
  six-at-a-time pool, because frontmatter is stripped from the index before it
  crosses the wire. On a very large vault they are the slowest things in the app.
- **A folder document loads full source for up to 200 pages at once.** The right
  unit for a personal wiki; a folder with many hundreds of pages wants
  virtualising.
- **The journal's diff is a common-prefix/suffix trim, not Myers.** Correct and
  free for small, mostly-additive edits; a large reordering renders as one big
  remove followed by one big add. This only ever feeds the journal's
  `linesAdded`/`linesRemoved` counters, so the cost of being wrong is a
  misleading number in Review, not a misleading diff on screen. Compare is the
  exception — it uses the `diff` package's word diff.

**Scope**

- **The vault UI assumes a wide window.** Below the `md` breakpoint the sidebar
  becomes a 17.5rem off-canvas drawer (backdrop, `inert` page behind it, Escape
  to close, focus handed back to the trigger) behind a top bar, but the views
  themselves are laid out for a desktop window. Above `md` the sidebar is a
  fixed 15.5rem column.
- **In a browser, the native folder picker is macOS-only.** `/api/pick` shells
  out to `osascript`, so a browser on Windows or Linux has to paste a path. The
  Electron shell has its own picker (`window.lore.chooseVaultFolder`) and that
  one works on all three platforms, which is why `canPickFolder()` tests for the
  bridge first.
- **No image or attachment handling.** Markdown only.
- **Rename and move are not exposed in the UI.** Create, edit and delete are.
- **The palette repeats after eight.** A folder with more than eight pages reuses
  colours further down the document. Adjacent sections still differ, which is
  what the colour is for.

**Loose ends**

- **Token counts are GPT-family**, a few percent off Claude's. The `index` usage
  event additionally logs a crude chars ÷ 4 estimate; only the Insights budget
  uses the real tokenizer.
- **Semantic search is not offline on first use.** The model weights (~23MB) are
  fetched once into `~/.lore/models`; everything after that is local. Page content
  never leaves the machine, but "no network at all" is not true on a cold start.
- **The desktop build is unsigned.** `electron/main.js`, `electron/preload.js`
  and `electron-builder.yml` are all present, but `electron-builder.yml` sets
  `identity: null` for macOS, so `dist:mac` produces a DMG that is neither
  signed nor notarised. The three packaging scripts (`dist:mac`, `dist:win`,
  `dist:linux`) run `npm run build` themselves; `npm run electron` does not, so
  it fails with a dialog until `.next/standalone` exists — the shell spawns that
  server rather than loading a static bundle.
- **A link whose basename is ambiguous disappears from both checks** — no
  resolved link, no dead-link report. See §8.
- **The removed approval gate left residual code behind for a day** — the
  module, route and accept/reject UI outlived the feature because an empty queue
  and a deleted queue look the same from the interface. Now deleted. See §10.
