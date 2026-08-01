# Improve Round 5 — synthesis of 7 specialist plans

Seven specialists diagnosed Lore. 6 plans are **measured**, 1 is **reasoned**, 0 are **speculative**.
Every change below traces to a grounding artifact (offline harness logs, curl output, grep hits, panel doc, or a saved patch). Nothing had to be dropped for lacking one. File existence and key line claims re-verified against the working tree 2026-08-01; two stale line numbers corrected (noted inline).

---

## 1. Ranked table

Ranked by measured value × breadth. Measured > reasoned > speculative.

| # | Area | Finding (compressed) | Value if done | Confidence |
|---|------|----------------------|---------------|------------|
| 1 | **Retrieval ceiling** (`lib/pack.ts` + `lib/rerank.ts`) | No term-coverage reward lets term-spammy pages beat the page holding every query term; rerank judge sees only 500 chars and demoted 3/20 correct #1s whose answer sits deeper. | recall@1 55%→65%, recall@5 95%→100% (measured, offline harness reproducing API baseline exactly); the one never-found page becomes retrievable. Touches **every Ask question**. | measured |
| 2 | **First-run experience** | Default post-onboarding screen (Brief) is guaranteed empty on every fresh install (journal-only), with no route to Ask/search which work instantly. Marketing never states the agent-written-markdown prerequisite. | Every new user's first screen routes to instant value instead of an empty box; wrong-audience visitors self-select out in sentence one. | measured |
| 3 | **Dead code + unreachable features** | 4 routes with zero callers; HTTP MCP 401s unconditionally (no path mints its token), contradicting DOCUMENTATION.md:13; `lib/fact-history.ts` and `pwa-install.tsx` never imported in any commit. | ~450 provably dead lines deleted; 3 deliberately-built features (HTTP MCP, publish, Obsidian plugin) become reachable; 1 drift-prone duplicate unified. | measured |
| 4 | **Landing page length** | 13 blocks / 2,830 words; 4 blocks are near-verbatim duplicates of other blocks or FAQ entries ("One 200k window" ×2, "2.3 million tokens" ×2, "Read-only" ×5). | 13→9 blocks, 2,830→~1,740 words (~4 fewer screens); zero claims lost — every cut survives elsewhere on the page. Hits every visitor. | measured |
| 5 | **Brief output quality** | Model lines beat fallback in all 8 real items, but 2-3/8 restate identity/bio instead of news because the prompt never asks for the most consequential fact nor says created-vs-diff. | The 2-3/8 title-restating home-screen lines become actual news; the 5-6 good lines untouched. Two prompt-string edits. | measured |
| 6 | **Answer quality at reduced budget** | 2500 is safe: 12/12 real /api/ask runs correct, golden page cited [1]-[3] every run; 2500 pack is a prefix of the 8000 pack. **DEFAULT_BUDGET=3000 needs no change** — this plan is validation, not work. | Confirms the 8s/question latency cut loses zero answer quality. Remaining change is a one-line comment fix. | measured |
| 7 | **Pricing page** | Full commercial apparatus (3 cards, cycle toggle, matrices) for tiers with no checkout; 2/3 cards render "Not open yet" (verified live). 7/9 panel: dead weight — but the honesty itself was praised by 7. | Kills the dead-weight complaint while keeping the praised honesty; ~2 screens → 1; zero broken links, zero new backend. | **reasoned** |

Ranked below all measured plans per the confidence rule. It is still worth doing — evidence is live curl + panel-round-4.md:59-68,105,118 — but its "1 screen does the same work" claim is argued, not measured.

---

## 2. Top 4 — exact changes, ready to implement

### #1 Retrieval ceiling

| File | Change |
|------|--------|
| `/Users/markksantos/Developer/Web Apps/lore/lib/pack.ts` | In `buildPack`, multiply each passage's score by `(0.5 + 0.5 * coverage)`, where coverage = idf-weighted fraction of corpus-present query terms found in the passage (distinct terms, body or title/heading). **Exact working diff saved at `/Users/markksantos/.claude/jobs/b9ad0859/tmp/coverage-proposal.patch`** (verified present). Use passage-only coverage — page-floor/page-avg variants measured worse. Known trade: kellyann41 drops 1→5 lexically; reranker keeps it top-5. |
| `/Users/markksantos/Developer/Web Apps/lore/lib/rerank.ts` | Raise `EXCERPT` from 500 to 1600 (line 33) so the judge sees whole passages (splitSections caps ~400 tokens ≈ 1600 chars). Measured with the coverage change: reranked recall@1 11→13/20, recall@5 20/20; both recurring judge regressions (matthewgranberg, francescovila) disappear. Judge prompt ~2× longer → rerank calls somewhat slower. untamed_skies flip persists (genuine judge error, not truncation — accept it). |
| `/Users/markksantos/Developer/Web Apps/lore/lib/pack.ts` (git hygiene, **do before pushing** — main is 33 ahead of origin) | Reconcile commit 98eba40: it swept the in-flight coverage experiment into HEAD:lib/pack.ts (4 EXPERIMENT markers). Working tree holds intended stock scoring + the new signals field. Commit or amend so the experiment doesn't ship unreviewed and the working-tree diff stops reading as a behavior revert. |

Evidence: offline harness importing real `buildPack` (job tmp/golden-offline*.mjs) reproduced the API baseline exactly (8/20@1); logs in tmp/failures.json.

### #2 First-run experience

| File | Change |
|------|--------|
| `/Users/markksantos/Developer/Web Apps/lore/components/lore/brief-view.tsx` | In the `!data?.items.length` empty state (lines 317-322), add two buttons: "Ask your wiki a question" and "Search your N pages", wired via a new `onNavigate(view)` prop passed from vault-app.tsx (which already owns `setView` — verified at vault-app.tsx:42). Keep existing honest copy above them. **`onNavigate` must be optional** — the /web browser build also renders BriefView. |
| `/Users/markksantos/Developer/Web Apps/lore/components/marketing/landing.tsx` | Add one plain audience sentence to the sub-CTA line (~line 160): "Built for people whose AI already writes markdown files on their machine. If nothing writes files for you, Lore has nothing to show you." One sentence, no new section — hero copy is the panel's most-praised asset. |
| `/Users/markksantos/Developer/Web Apps/lore/components/marketing/landing.tsx` | Add FAQ entry near the top of the FAQ array (~line 671): "Do I need AI agents for this to be useful?" — without an agent-written markdown folder the Brief, watcher, and gap log have nothing to show; Lore is not a note-taking app. |
| `/Users/markksantos/Developer/Web Apps/lore/components/lore/onboarding.tsx` | In DoneStep bullets (~line 601): add "The Brief starts empty and fills as agents write; Ask and search work on all your pages right now." Keep the bullet list at 3 items. |

Evidence: vault-app.tsx:42 `view="brief"` default (re-verified); lib/brief.ts `buildBrief(index, events)` is journal-only; all 7 v0.1.0 release assets curl HTTP 200; proxy.ts:167 /vault→/web.

### #3 Dead code + unreachable features

| File | Change |
|------|--------|
| `/Users/markksantos/Developer/Web Apps/lore/lib/fact-history.ts` | **Delete** (113 lines). Zero importers in working tree and in every commit on any branch (`git log --all -S 'fact-history' -- app components` empty). Born dead in 22befe5. |
| `/Users/markksantos/Developer/Web Apps/lore/components/marketing/pwa-install.tsx` | **Delete** (156 lines). Imported nowhere in any commit; only file referencing `beforeinstallprompt`. Installability actually ships via `app/manifest.ts` + `public/sw.js` — those stay. |
| `/Users/markksantos/Developer/Web Apps/lore/components/lore/connections-view.tsx` | Make HTTP MCP reachable: add access-token issue/revoke UI (GET/POST/DELETE `/api/access`) to this MCP-setup screen; list `/api/access` + `/api/mcp` in DOCUMENTATION.md's API table. Today `/api/mcp` 401s unconditionally (app/api/mcp/route.ts:76-82) because nothing can mint its bearer token. **Token minting must stay loopback-only (mirror /api/remote's guard)** or pairing becomes a remote privilege grant. |
| `/Users/markksantos/Developer/Web Apps/lore/app/api/collab/route.ts` + `lib/collab.ts` | Delete the route plus the comment/webhook/section-signoff halves of lib/collab.ts; **keep `recordActivity`** as a plain JSONL audit logger (5 route callers). No component ever fetched /api/collab; webhooks can never be registered so `fireWebhooks` always no-ops. If team features are genuinely near-term, wire a UI instead — but that's a product call, not this round's. |
| `/Users/markksantos/Developer/Web Apps/lore/bin/lore.mjs` + `components/lore/settings-view.tsx` | Wire e9eb94a's two finished orphans: `lore publish <prefix>` CLI command hitting GET `/api/publish`, and an Obsidian plugin install button (POST `/api/obsidian`) in settings-view. Document both routes. Cover publish's quarantine filter with one test — it could leak pages if the filter regresses. |
| `/Users/markksantos/Developer/Web Apps/lore/lib/utils.ts` | Export `jaccard(a: Set<string>, b: Set<string>)`; replace the two identical private copies `overlap()` (lib/gaps.ts:45) and `overlapOf()` (lib/write-feedback.ts:57). **Keep the `\|\|1` zero-size guard form** so both call sites behave identically. Do NOT touch canon.ts `overlap()` (overlap coefficient — different measure) or pack.ts `idfFor` (documented purity constraint). |

### #4 Landing page length

All in `/Users/markksantos/Developer/Web Apps/lore/components/marketing/landing.tsx`:

| Change | Detail |
|--------|--------|
| Delete **Safety** | Remove `<Safety />` at line 65 and the function (lines 277-315). Covered by hero line 161, Measured stat lines 201-207, FAQ #1/#2/#5. −221 words. |
| Delete **Ask** | Remove `<Ask />` at line 68 and the function (lines 402-436). Its lede (line 415) restates HowItWorks item 2 (line 345) almost word for word. Zero `id=` anchors target it. −131 words. |
| Delete **Budget** | Remove `<Budget />` at line 69 and the function (lines 438-464). **Keep the BudgetDemo import — still used at line 343**; removing it breaks HowItWorks item 2. −108 words. |
| Trim **WhyNotJustAsk** | Delete the second Reveal row (lines 248-266, three git cards + comment). Keep the closing paragraph at 268-272. Git objection stays in FAQ #3 (line 682). −149 words. |
| Delete **Platforms** | Remove `<Platforms />` at line 71 and the function (lines 495-602), but **move its CTA Reveal block (lines 588-599, "Get Lore for your machine") to the end of Steps** after the grid closing at line 661. Remove the now-unused `Smartphone` import (line 12) or lint fails. /download (HTTP 200) carries platform detail. |
| Trim FAQ 14→9 | Delete entries at lines 689-691 (#5 undo — covered by #1), 693-695 (#6 agent capabilities — #7 lists tools), 701-703 (#8 CLI/CI), 713-715 (#11 snapshot size), 725-727 (#14 hosted-sync encryption — nothing is open yet). ~−385 words. CLI/CI discovery needs a docs home if it lacks one. |

Note: these line numbers predate the round-5 edits from plan #2 above (audience sentence + new FAQ entry, same file). **Apply the landing-page cuts first, then the first-run additions**, or re-locate lines after the first edit — don't trust both sets of absolute line numbers simultaneously.

---

## 3. Already fine — do not re-open

- **Budget number (DEFAULT_BUDGET=3000, lib/pack.ts:191).** 2500 validated with 12 real /api/ask runs: all correct, golden page cited [1]-[3] every time, 2500 pack is a strict prefix of the 8000 pack — the extra ~5,500 tokens were never-cited passages. 3000 is a superset of 2500 and equally validated. Multi-part answers stayed complete at 2500 (one case *better* than 8000). **1500 remains unsafe** — do not push lower. Only remaining item: fix the stale doc comment at pack.ts:175 ("the human-facing default stays 8k" contradicts DEFAULT_BUDGET two lines below — verified still present). Optional cheap re-check: re-run the reranker golden eval at budget 3000, since the 40→55% rerank uplift was measured pre-cut.
- **Remaining retrieval misses** are sibling-page label ambiguity — the answer genuinely exists on both pages. No change proposed; don't chase them.
- **First-run has no dead ends**: all 7 v0.1.0 release assets HTTP 200, site-mode /vault→/web redirect works, harness snippet valid. The empty-Brief problem (#2 above) is the only first-run defect.
- **Brief model lines beat the fallback in all 8 of 8 real items**; 5-6/8 are genuinely good. The synthesis pipeline itself is sound — only the prompt needs the two edits in plan #5.
- **"Not open yet" honesty on /pricing** is praised by 7/9 panelists. Whatever happens to the pricing page, keep that answer verbatim; the defect is the apparatus around it. lib/pricing.ts's top-of-file comment IS the correct commercial story.
- **canon.ts `overlap()`** (overlap coefficient) and **pack.ts `idfFor`** (purity constraint) are deliberate, not duplicates. Leave them.
- **PWA installability** ships via app/manifest.ts + public/sw.js and keeps working after the pwa-install.tsx deletion.

## 4. Plans NOT ready to implement

**None.** No plan carries 'speculative' confidence this round. The one non-measured plan (#7 pricing, 'reasoned') is grounded in live curl output and panel-round-4.md and is safe to implement, but it ranks below every measured plan and its payoff is argued rather than measured — do it after the top 4.

Lower-ranked but ready (not detailed above): **#5 Brief prompts** — two string edits in app/api/brief/route.ts (SYSTEM line 95: "pick the most consequential fact… never a sentence the page title already implies"; generate() line 166: prepend created-vs-diff context). In-memory lineCache keeps old-style lines until evidence changes or restart — expected, not a bug. **#6 Budget** — comment fix only, see §3.
