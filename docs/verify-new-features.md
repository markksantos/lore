# Verify: two new features + five panel fixes

Lead review of four hostile verification passes (admission control, timeline frame containment, auto-wiki privacy/offsets, enrich/proxy/brief). Every claim below was re-checked against the source by the lead; claims that rested on a line citation alone were dropped, and are listed as such.

**Scope under review**
- Feature 1 — AUTO-WIKI (`lib/listen.ts`, `/api/listen`)
- Feature 2 — Timeline / screen recorder reader (`lib/timeline.ts`, `/api/timeline/frame`)
- Panel fixes 1–5 from `docs/panel-round-4.md` §5 (ask can't kill the process · dead screens · default-install Brief · latency cliff · MCP search + Host guard)

**Result: 5 dealbreakers, 11 majors, 2 minors confirmed. 3 claims dropped.**

---

## 1. Confirmed defects, ranked

### DEALBREAKERS

**D1 — Private keys reach the model. `lib/listen.ts:274`**
`distil()` scrubs *after* `renderTurns()` clips each turn to 700 chars (`:250`). The PEM pattern (`:124`) requires both `-----BEGIN-----` and `-----END-----`; a normal ~1.6KB RSA key loses its END marker to the clip, the regex fails, and the key body goes to Ollama verbatim.
*Artifact:* lead re-ran the verbatim regex array against a 1621-char PEM → after clip+scrub the output still contains `BEGIN RSA PRIVATE KEY` and 701 chars of key material. Reproduces the verifier's finding exactly.

**D2 — The most common `.env` shape is not scrubbed at all. `lib/listen.ts:125`**
`\b(password|passwd|secret|token|api[_-]?key)\s*[=:]` cannot match after an underscore — `_` is a word char, so there is no `\b` before `TOKEN` in `CLOUDFLARE_API_TOKEN=`. Screaming-snake env vars are the single most common way a secret enters a transcript.
*Artifact:* lead re-ran scrub — `CLOUDFLARE_API_TOKEN=<40-hex>`, `AWS_SECRET_ACCESS_KEY=…` and `DB_PASSWORD="correct horse battery staple"` all returned **unchanged**.

**D3 — SSRF: the loopback block is dead code for IPv6 and alternate forms. `lib/enrich.ts:141-150`**
The guard compares `host === "::1"`, but `new URL("http://[::1]/").hostname` is `"[::1]"` — brackets included. `0.0.0.0` and `localhost.` are not in the list at all. All three are allowed, fetched, and extracted for filing.
*Artifact:* `/tmp/lore-probe/loopback-e2e.mjs` → `[::1]:8902 ALLOWED + FETCHED + EXTRACTED`, same for `0.0.0.0` and `localhost.`

**D4 — SSRF: the filter is textual, not resolved. `lib/enrich.ts:141-150`**
Any public hostname whose DNS points at 127.0.0.1 walks straight through. A fake NAS admin panel on 127.0.0.1:8901 was fetched and **filed into the vault** as an article.
*Artifact:* `/tmp/lore-probe/ssrf-e2e.mjs` → `normaliseUrl -> http://localtest.me:8901/storage` then `FILED as capture/articles/nas-admin-storage.md`. `dig +short localtest.me` → `127.0.0.1`.

**D5 — Read-only mode does not gate `/api/undo`. `lib/safety.ts:83-91`**
`VAULT_WRITERS` lists 8 routes; `/api/undo` is not one of them — verified by reading the map. `app/api/undo/route.ts:71` calls `writeRaw()` and the route contains no `readOnly` check of its own. With `readOnly:true` the revert loop runs and returns 200 while `/api/page` POST correctly 403s. Read-only is the product's one enforced boundary; it has a hole.
*Artifact:* `curl -X POST -d '{"agent":"ZZZ-nonexistent-agent-probe","days":1}' /api/undo` → `200 {"ok":true,…}`; lead confirmed both the missing map entry and the `writeRaw` call in source.

### MAJORS

**M1 — Streaming asks escape the ask gate. `app/api/ask/route.ts:147` + `:407`**
`return new Response(stream)` sits inside the `askGate.run()` callback. `ReadableStream`'s async `start()` is never awaited by `run()`, so the slot is released the instant the Response object is constructed — before a single token is generated. The UI always sends `stream:true` (`ask-view.tsx:181`), so N concurrent UI asks = N concurrent Ollama generations. This is the exact failure panel fix #1 and #4 exist to prevent.
*Artifact:* live probe was inferential (during an in-flight stream, 5 probes produced only ONE instant 503 with `load {running:1,queued:3}` and D4 queue-timed-out at 30.0s — impossible if the stream held the slot). **Lead promoted this to confirmed by direct source read**, which is unambiguous: the callback returns a Response, `run()`'s `finally` releases, generation continues outside the gate.

**M2 — `frameFor` is not symlink-safe. `lib/timeline.ts:257-259`**
`path.resolve()` does not resolve links and `fs.stat()` follows them, so a symlink planted anywhere inside the recorder store turns the containment check into decoration and serves any file on disk. No `fs.realpath` anywhere in the function.
*Artifact:* `/tmp/attack-frame.mjs` — row `etcdir/passwd` (`etcdir` → `/etc`): `frameFor()` returned a path under `DesktopRecord/`, SERVED BYTES `"##\n# User Database…"`.

**M3 — The frame-containment test passes vacuously. `scripts/test-timeline.mjs:50` vs `:64`, asserted at `:112`**
`STORE` is `$SCRATCH/Library/Application Support/DesktopRecord` (3 levels below SCRATCH) but the hostile row uses `../../../../outside.jpg` (4 levels), resolving to `os.tmpdir()/outside.jpg` where nothing is planted. The test is refused by `stat()`, not by containment — delete the containment line and it still passes. The one test the file's own header calls "the one that matters" tests nothing.
*Artifact:* `/tmp/attack-frame.mjs` (`cap-evil-6666` resolves to `/var/folders/…/T/outside.jpg`, `exists=false`; still returns null with the containment line removed); lead re-verified the path arithmetic in the test source.

**M4 — Many more secret shapes slip `scrub()`. `lib/listen.ts:117-127`**
Bare 40-hex tokens, Google `AIza…` keys, `github_pat_` fine-grained PATs (`gh[pousr]_` misses `ghi`), `xoxc-` Slack tokens, base64 blobs, and any quoted secret containing a space (`[^\s'"]{8,}` dies at the first space).
*Artifact:* lead re-ran the verbatim patterns — 6 of 8 representative secrets returned unchanged, including `9f86d081…` (40-hex), `AIzaSyD-…`, `github_pat_11…`, `xoxc-…`.

**M5 — Every delta after the first read silently drops its first record. `lib/listen.ts:460`**
`if (from > 0) delta = delta.slice(delta.indexOf("\n") + 1)` runs unconditionally, but appends start exactly at a line boundary — so the "torn line" correction eats a whole valid JSONL record on every sweep after the first.
*Artifact:* verifier repro — appended `turn C` + `turn D` after sweep 1; sweep 2's delta contained only `turn D`. Lead confirmed the unconditional slice in source.

**M6 — A `conversations.json` export over 512KB is silently destroyed. `lib/listen.ts:452, 470-471, 486-491`**
The `MAX_DELTA_BYTES` clamp reads only the trailing 512KB of what is a single-line JSON document; `JSON.parse` fails, 0 turns → `nothing` → **state advances and the file is archived to `done/` as processed** with zero facts filed. The user's whole ChatGPT history disappears and the app reports success.
*Artifact:* verifier repro — 623KB export yielded 0 turns through the sweep read path vs 5000 turns from the full file.

**M7 — No Origin / Sec-Fetch / content-type check anywhere.**
The Host guard (panel fix #5) landed and is solid, but any web page can still issue a preflight-free simple POST to `http://localhost:4646/api/*` with a valid Host and it executes. Combined with D5 this means a visited web page can revert a day of a user's wiki.
*Artifact:* `curl -X POST -H 'Content-Type: text/plain' -H 'Origin: https://evil.example' /api/undo` → 200; grep for `sec-fetch` / `headers.get("origin")` across `app/`, `lib/`, `proxy.ts` returns nothing.

**M8 — `extractArticle` files pure boilerplate as articles. `lib/enrich.ts:286-289`**
The 400-char floor is not a quality signal. An IAB cookie-consent banner (555 chars) and a JS-required SPA shell plus legal blurb (575 chars) both pass and become vault pages.
*Artifact:* `/tmp/lore-probe/article-probe.mjs` → `SPA shell + cookie banner: EXTRACTED (len 555)`, `JS-required shell + legal div: EXTRACTED (len 575)`.

**M9 — `lineFrom` collapses to a stub. `lib/brief.ts:413-414`**
`cut.slice(0, cut.lastIndexOf(" "))` — when the chosen line's only early space is at index 7, a 187-char line renders as the 8-char headline `Source:…`.
*Artifact:* `/tmp/lore-probe/brief-probe.mjs` → `OUT: "Source:…" (len 8)`.

**M10 — `lineFrom` still cuts mid-word. `lib/brief.ts:413-414`**
A 195-char line with no spaces gives `lastIndexOf(" ") === -1`, so `slice(0, -1)` returns 176 chars ending mid-token and silently drops a character. Panel fix #3(a) says explicitly "cut at a sentence boundary, **never mid-word**" — that fix did not land.
*Artifact:* `/tmp/lore-probe/brief-probe2.mjs` → output ends `…&compare=previousperiod&gr…`, len 177.

**M11 — `lineFrom` still returns collages. `lib/brief.ts` line selection**
A markdown table header row is emitted verbatim as the brief's one-line summary, e.g. `| Role | Start Here | Your Output |`. This is the same class of failure 9/9 panelists flagged in §2.2.
*Artifact:* `/tmp/lore-probe/real-scan.mjs` over 1382 real pages → `clients/samantha-borgos/source-docs-2026-07-24/TEAM_OPERATIONS_GUIDE.md` → `| Role | Start Here | Your Output |`.

### MINORS

**m1 — Brief lines delete underscores from identifiers.** `MAX_RETRY_COUNT` renders as `MAXRETRYCOUNT`, `user_id` as `userid`. Cause: `index-core.ts:132` `.replace(/[*_~]/g,"")`, repeated by `brief.ts:436`. *Artifact:* `/tmp/lore-probe/brief-probe3.mjs`.

**m2 — `normaliseUrl` covers only RFC1918.** `169.254.169.254` (cloud metadata), `fe80::`, `fd00::`, `100.64.0.0/10` (CGNAT/Tailscale), and `nas.lan` / `printer.home.arpa` all pass. *Artifact:* `/tmp/lore-probe/enrich-probe.mjs`. Subsumed by D4 — the fix is a resolve-then-check, not a longer regex.

---

## 2. Dropped — claimed without a reproducing artifact

These are code-reading arguments only. They may well be real; they are not confirmed, and none of them gate the ship on their own.

- **Growing-log deltas >512KB permanently lose the middle** (`listen.ts:452` + `:488/:521`). Plausible from the clamp-plus-state-advance shape, but no execution was shown. Worth a repro during the D1/D2 fix pass — it is the same clamp as M6.
- **Same delta filed twice when a POST commits but its response is lost** (`listen.ts:506-527`). Cited lines only; no induced failure, no observed duplicate.
- **Inbox file re-filed every sweep if `archiveInboxFile`'s rename fails** (`listen.ts:381-400`, `:532-536`). Cited lines only; the rename was never made to fail.

---

## 3. Verified healthy

- Non-stream `/api/ask` under 6-way concurrency: 2×200 serialised, 2 instant 503s at the queue cap, 2 queue-timeouts at exactly 30.0s — process survived, RSS flat 1.18GB → 1.17GB.
- Health stayed fast under burst: `/api/vault` 200 in 1.16s at peak retrieval, 5ms after.
- `gate.ts` leaks no slots on any error path: timer-reject only fires while still queued, resolve clears the timer synchronously, rejected acquires never increment `running`, `run()` releases in `finally`.
- SSE client killed mid-generation: same PID, health 200 in 3ms, next ask admitted and answered — no wedged slot.
- `cancel()` → `clientGone.abort()` genuinely aborts the upstream Ollama fetch; the enqueue-throw path is caught, so a disconnected reader cannot crash the process.
- 503 bodies are honest: `{busy:true, load:{running,queued}}` with `retry-after: 5`.
- The uuid regex rejects `../../etc/passwd`, `%2e%2e`, `%00`, and trailing `\n` / `\r\n` — JS `$` is end-of-string, no Python-style newline bypass.
- An absolute `image_path` outside the store is refused, and the containment check is load-bearing there.
- Sibling-prefix escape `../DesktopRecordEvil/x.jpg` is refused — the `+ path.sep` is present and correct.
- A directory-valued `image_path` is refused by the `isFile()` guard.
- Timeline SQL is parameterized, the DB handle is opened read-only, and `frameFor` has exactly one caller.
- A failed wiki POST does not advance the byte offset — the delta is retried next sweep.
- `distil()` returns `no-model` when Ollama is absent; no code path ever POSTs or dumps a raw transcript — only `outcome.bullets`.
- Model **output** is scrubbed too: every bullet passes through `scrub()` before filing.
- Everything is local: Ollama is hardcoded to `127.0.0.1:11434`, the wiki write goes to `127.0.0.1:<port>` only.
- OpenAI `sk-proj-`, `sk-ant-`, `sk_live_`, `ghp_`, `AKIA`, JWTs, complete PEMs and `user:pass@` URLs are correctly redacted (re-verified by the lead against the verbatim regexes).
- `busy` / `no-model` outcomes break the sweep loop with state untouched — no offset advance, no loss.
- All 45 `/api/*` paths return 403 with `Host: evil.example` — panel fix #5's Host guard landed.
- Path tricks do not evade the Host guard: `//api`, `/api//`, trailing slash, `%2f`, `/api/../api` all 403.
- `normaliseUrl` correctly blocks RFC1918 literals plus `127.1`, `2130706433`, `0x7f000001`, trailing-dot IPv4 and uppercase `LOCALHOST`.
- `extractArticle` correctly refuses a bare SPA shell and a 322-char login-wall interstitial.
- `lineFrom` drops headings and prefers prose over frontmatter fields.
- `/api/review` guards its own vault write with a `readOnly` check (`app/api/review/route.ts:127`) — the pattern `/api/undo` should have copied.

---

## 4. Verdict

**Do not ship.** Auto-wiki is a privacy feature whose scrubber misses the two most common secret shapes on disk (D1, D2) while advancing state and archiving the source as processed, and enrich will fetch and file anything a hostname resolves to including loopback (D3, D4) — either of which turns "your wiki, local and private" into a false claim; `/api/undo` walks straight past read-only (D5), and with no CSRF check (M7) an open browser tab can trigger it. Of the five panel fixes, #5 landed clean, #1/#4 landed only for non-streaming asks while the UI exclusively streams (M1), and #3's "never mid-word" is still violated three ways (M9–M11). Minimum to ship: D1–D5 and M1, M2, M3 — everything else is fixable in the next pass.
