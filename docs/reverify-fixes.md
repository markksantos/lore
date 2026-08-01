# Re-verify: fixes for Lore's confirmed defects

Four verifiers re-attacked the shipped fixes. Every claim below is backed by a reproducing artifact; anything without one was dropped.

**Score: 18/18 originally-confirmed defects re-verified fixed. 0 still open. 2 new defects the fixes introduced (1 major, 1 minor).**

## 1. Defects claimed fixed

| id | fixed? | evidence |
|----|--------|----------|
| M1 | YES | 6 concurrent stream asks: only 1 gen at a time — req1[.97–16.6s], req2 ttfb=17.65s (no overlap); 4x 503 (running:1, queued:3); health=4ms mid-burst; PID 97998 unchanged; fresh ask 200 (no gate leak). |
| D5 | YES | `POST /api/undo` with no CSRF header -> 403 `{readOnly:true}`; `safety.ts:95` lists `'/api/undo':['POST']` in `VAULT_WRITERS`; `proxy.ts:147` gate. |
| M7 | YES | `/api/listen` (non-writer): `Sec-Fetch-Site: cross-site` -> 403; same-origin -> 200; `none` -> 200. `proxy.ts:129-137`. |
| M2 | YES | store symlink `pwned.png -> /etc/passwd`, row `img_path='pwned.png'` -> live 404, no `root:` in body; `realpath` rejects (`timeline.ts:267`). |
| M3 | YES | `img_path '/etc/passwd'` -> 404; `'../../etc/passwd'` (exists) -> 404; legit in-store png -> 200 with PNG magic; zero leak. |
| D1 | YES | PEM with END clipped: `BEGIN-PRIVATE-KEY` pattern has `|$` alt (`listen.ts:132`) + `MII` fallback; `scrubtest.mjs` OUT=`[redacted]`, REDACTED=true. |
| D2 | YES | `CLOUDFLARE_API_TOKEN=<40hex>` hit by assignment pattern (lookbehind, not `\b`, `listen.ts:139`); `scrubtest.mjs` OUT=`[redacted]`. |
| M4 | YES | `distil()` scrubs full turn text (`listen.ts:298`) BEFORE `renderTurns` 700-clip; `AWS_SECRET` / `DB_PASSWORD` two-word / `AIza` / `github_pat` / `password` all -> `[redacted]`. |
| M5 | YES | trim gated on `clamped` (`listen.ts:521`); `simtest.mjs` non-clamped append kept `THE-NEW-FIRST-RECORD`; no-trailing-newline variant kept new rec too. |
| M6 | YES | 754KB `conversations.json`: `isWholeDoc` from=0 read full 771750B, 4000 turns, FIRST marker present; corrupt >512KB json NOT archived (`simtest.mjs`). |
| D3 | YES | `normaliseUrl` on `http://{0.0.0.0,127.1,fd00::1,nas.lan}/` = null; `isPrivateHostLiteral=true`; all FETCHABLE=false (`test-reattack-ssrf.mjs`). |
| D4 | YES | `localtest.me` resolves `::1`+`127.0.0.1` (dns lookup); `isPublicHost('localtest.me')=false` => FETCHABLE=false — not a DNS-fail false-pass. |
| m2 | YES | `2130706433`, `0x7f000001`, `169.254.169.254`, `100.64.0.1`, `fd00::1` -> `isPrivateHostLiteral=true`, `normaliseUrl=null`; `example.com` & `8.8.8.8` still FETCHABLE=true. |
| M8 | YES | 735-char / 3-para / 6-sentence cookie banner (7 boilerplate hits) + JS-shell+legal both `extractArticle()=null`; real 3-para article still extracts. |
| M9 | YES | `lineFrom('Source: ' + 185*x)` -> 180-char output ending `…`, not the old 8-char `Source:…` stub. |
| M10 | YES | `lineFrom(195*'A', no spaces)` -> clean 179-char hard cut + `…`, first 179 chars intact, no `slice(0,-1)` dropped char. |
| M11 | YES | `lineFrom(table row)` -> `'Changed, but the page has no readable body'`; collage input picks clean prose line, no `\|` or ` - ` fuse. |
| m1 | YES | `lineFrom('...MAX_RETRY_COUNT... _this_ __emphasised__')` keeps `MAX_RETRY_COUNT` intact, strips `_this_`->`this` & `__emphasised__`->`emphasised`. |

## 2. Still open

**None.** No verifier reported a `stillOpen` item in any of the four areas. Nothing from the original defect set survived the fixes.

## 3. New defects the fixes introduced

Both have reproducing artifacts and stand.

### NEW-1 — MAJOR — scrubber leaks any hex run >64 chars
- **Where:** `lib/listen.ts:142`, bare-hex pattern `[A-Fa-f0-9]{40,64}(?![\w-])`.
- **Claim:** The upper bound of 64 means a hex-encoded 512-bit key, a doubled token, or a SHA-512 passes through UNREDACTED. The scrubber's entire job is to keep secrets out of distilled turns; this is a live secret-leak path.
- **Artifact:** `node`: 65-, 66-, 80-, 128-char hex all print `NO MATCH (leaks)`; `scrubtest2.mjs` — 128-hex OUT prints the full hex, `REDACTED?false`.
- **Verdict:** Real blocker for the listener/scrubber feature. Fix is trivial and mandatory: drop the `64` cap (e.g. `{40,}` or `{40,64}` -> `{40,}`) so long hex runs are redacted, not exempted. Given the ON-AIR / secret-hygiene posture this cannot ship as-is.

### NEW-2 — MINOR — boilerplate gate over-blocks genuine short articles
- **Where:** `lib/enrich.ts` `extractArticle` (the M8 boilerplate gate).
- **Claim:** Any real article under 2500 chars that mentions 2+ legal phrases (e.g. "Privacy Policy" + "Terms of Service") is rejected as boilerplate and silently dropped — a false-negative.
- **Artifact:** 802-char real privacy-law news article, 2 boilerplate hits, <2500 chars -> `extractArticle()=null`.
- **Verdict:** Not a hard blocker — it silently drops some legit short articles rather than leaking or crashing. Should be tightened (raise the hit threshold, or require boilerplate density rather than raw count) but does not gate ship.

## 4. Final verdict

- **Panel fixes (admission control M1 + timeline/privacy D5/M7/M2/M3):** SHIPPABLE. All re-verified fixed under adversarial re-attack, no regressions, no new defects in these areas.
- **Enrich / SSRF + extraction feature (D3/D4/m2/M8–M11/m1):** SHIPPABLE with a known minor. Every fix held; only residual is NEW-2, a silent over-block of some short articles — cosmetic-tier, not a leak or crash. Ship, then tighten the gate.
- **Listener / scrubber feature (D1/D2/M4/M5/M6):** NOT SHIPPABLE until NEW-1 is fixed. All five original fixes held, but the fixes introduced a fresh secret-leak (`listen.ts:142` exempts hex runs >64 chars). A scrubber that leaks 512-bit keys defeats its own purpose. One-line fix, then re-verify with the 128-hex artifact.

**Bottom line:** 3 of 4 areas green. The one blocker is a single-line hex-cap bug in the scrubber (NEW-1). Fix that, re-run `scrubtest2.mjs`, and the full set — both features + panel — is shippable. NEW-2 is a follow-up, not a gate.
