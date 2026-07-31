# Lore — Panel Report

*Sixteen personas were run against Lore's pitch, code and real corpus. They are **archetypes**, not real named individuals: "obsidian-power-user", "seed-investor", "staff-engineer" etc. are simulated reviewers, not people who have seen your product. Four judges then graded the panel. Everything in code-quotes below I verified on disk.*

---

## The verdict

**0 of 16 would use it. 4 of 16 would try it. 12 said flatly no.** Mean disappointment-if-it-vanished: **1.8/10**. Not one panellist scored above 2. That is not a positioning failure; that is no demand.

The unanimous cause of death: all three designs — proposal queue, sign-off ledger, review screen — ask a human to supervise machine output at machine volume. You are the most motivated user this product will ever have and you have signed off **zero pages in a year**. That experiment is finished.

But the panel's own consensus fix is also already dead, and nobody checked. There is a real product here — one MCP tool that changes what lands in the context window — and it has never once been in your agents' path.

---

## What everyone agreed on

**1. Sign-off is dead and nobody is coming to do the homework. (16/16 — universal)**

Not one panellist defended it. This is the only unanimous finding in the entire panel.

> "You're the most motivated user this will ever have and you've never once used its main feature. That's not an activation problem, that's an autopsy." — *pmf-analyst*

> "Zero of 1,526 pages signed, by you, on your own wiki. That isn't an onboarding problem — it's a completed experiment with a clear result." — *oss-wiki-author*

> "Both dead designs asked a human to take responsibility for machine output at machine volume. Nobody signs 1,521 things. Stop shipping denominators as UI." — *design-lead*

I confirmed it on disk. `~/.lore/verified-*.json` for the real vault contains `{}` — zero entries. The only signatures that exist anywhere are **two pages in `~/.lore/demo-vault`** (`stack/postgres-notes`, `stack/auth-decisions`) and **one page called `moved/target`** in a test vault. Both are fixtures. Not a single real page has ever been signed.

**2. Nobody reads their AI's notes — which is the entire point of having the AI take them. (7/16)**

The headline is the product's own obituary.

> "My AI takes notes so I don't have to read them. Your headline is the product's obituary." — *ops-notion-person*

> "Nobody reads their AI's notes — that's the entire reason they had the AI take them. You built a reading room for a library no one visits." — *ai-researcher*

**3. ripgrep + your hand-curated index page already wins. (8/16)**

Your own CLAUDE.md sends agents to `wiki/_meta/hot.md` and the folder. It works. Five of seven MCP tools are dominated by that plus grep.

> "It's a weekend of code over a folder — Obsidian ships a plugin, Anthropic ships memory, and unbuilt $12/mo sync competes with git." — *seed-investor* (the "weekend" claim is false; see fairness judge)

**4. It measures the wiki; it never changes what the agent is served. (6/16)**

> "Lore measures the wiki; it never changes what lands in the context window. That is exactly why people say 'cool, not useful.'" — *ai-researcher*

> "Nobody signs off because signing off buys them nothing. Make the ledger change what the agent is allowed to say, and the sign-offs write themselves." — *enterprise-buyer*

**5. There is no job, no first screen, no 30-second demo. (7/16)**

I counted the UI: **19 view components** — review, duplicates, timeline, settings, policy, compare, explorer, schema, safety, ai, remote, graph, insights, connections, plus pricing/download/demo marketing views. Every panellist who opened it said the same thing.

> "Open it and in five seconds you learn nothing Finder didn't tell you." — *design-lead*

> "I can't film 'a list of changes you should feel bad about.' 28 views, zero moments." — *youtube-creator*

**6. Every screen is a tally of homework you haven't done. (4/16)**

> "Every number in this app is a tally of homework I didn't do. My notes are not a compliance audit and I am not the auditor." — *creative-nontech*

**7. Show me a number or I'm not installing it. (6/16)**

Six panellists independently gated adoption on the *identical* eval, unprompted: `wiki_context` vs `ripgrep + agent` vs `your index page`, measured on tokens-to-correct-answer and wrong-page-cited rate. It has never been run.

---

## Where they disagreed

**Write path vs read path — the sharpest split.**

- **Gate the write** (*devtools-founder*, *oss-wiki-author*): make `wiki_write` refuse the 1,527th page, auto-merge near-dupes, reject contradictions at creation. "Ship the compactor, not the inspection report."
- **Own the read** (*solo-founder*, *ai-researcher*, *staff-engineer*, *ops-notion-person*, *obsidian-power-user*): the write path isn't yours. Your own code says so — `lib/usage.ts:10`: *"That position is worthless as a gate (a plain folder has a hundred other write paths), but it is uniquely valuable as a sensor."* You wrote the counter-argument yourself. `vim`, Obsidian and `echo >>` route around any write gate. **The read path is the only chokepoint you actually control.** The survive judge is right; the write-path camp is wrong.

**The contradiction queue — nine panellists' flip, and it's already built and already failed.**

*zero-to-one*, *solo-founder*, *devtools-founder*, *ops-notion-person*, *hn-cynic*, *ai-researcher*, *pmf-analyst*, *oss-wiki-author* and *staff-engineer* all landed on some version of "show me the ~20 pages that contradict each other." Only *pmf-analyst* framed it as a hypothesis to test; the rest asserted the 20 pages exist.

The fairness judge ran `lib/analysis.ts findContradictions` over the real 1,526-page wiki: **9 flagged groups, 9 false positives, 0 true positives.** Different clients' deadlines, two daily reports, Upwork boosts. The panel's consensus fix ships today and scores 0/9 precision on the corpus they cited. Rebuilding it on panel enthusiasm is the sign-off mistake at higher cost.

**Keep one screen, or zero?**

- *youtube-creator*, *hn-cynic*, *design-lead*, *seed-investor*: exactly one screen — read receipts, "849 pages no agent has opened in 60 days, ~1M dead tokens, [Archive]".
- *obsidian-power-user*, *solo-founder*, *ai-researcher*: zero screens. MCP server plus an Obsidian plugin. "I don't have room for a fifth Electron window."

**Two panellists were reviewing a different product.**

- *civilian-chatgpt-user* (0/10) has no vault, no agents, no folder. "You built a very good smoke alarm. I don't own a house." Correct — and out of segment. Discard the vote; the ChatGPT-importer idea is a different company.
- *enterprise-buyer* wants signed manifests and chain-of-custody. No buyer, no SSO, no attribution model. Also out of segment.

**What the eval should measure.**

Most of the panel wants accuracy vs ripgrep. The survive judge dissents, and is right: *"'wiki_context vs ripgrep on accuracy' is a fight you can lose while still being right — ripgrep is excellent at finding text. Your claim is not 'I retrieve better,' it is 'I retrieve the current fact when the corpus holds three versions of it.'"* Measure **stale-citation rate**, not raw accuracy.

**Kill vs one wire.**

The kill judge says archive. The leverage and survive judges say the fix is one wire and six deletions. That split is resolved in the last section.

---

## The harshest things said

| Quote | Who |
|---|---|
| "You built a compliance department for a wiki no human reads. Nobody signs off because sign-off pays a machine, later, invisibly. Fire the auditors, hire a janitor." | zero-to-one |
| "Nobody reads their AI's notes — that's the entire reason they had the AI take them. You built a reading room for a library no one visits." | ai-researcher |
| "You built a Duolingo streak for reading your own notes, then acted shocked when the guy who wrote it never kept it." | hn-cynic |
| "You built a fifth Electron window to tell me what `git log -p` already told me, then billed me 1,521 items of homework for the privilege." | obsidian-power-user |
| "You built a dashboard for a corpus nobody reads. 849 orphans isn't a reporting gap — it's a landfill. Ship the compactor, not the inspection report." | devtools-founder |
| "Nobody has ever screen-recorded a ledger. You built a smoke alarm for a house no one has been asked to leave — and buried the one sensor only you own." | youtube-creator |
| "You shipped a compliance dashboard for a corpus no human will ever read, maintained by machines that don't care what color the badge is." | staff-engineer |
| "Your own vault has 849 orphans and zero sign-offs. The author doesn't use the feature the product is built around. That's not a marketing problem, that's the review." | solo-founder |
| "My AI takes notes so I don't have to read them. Your headline is the product's obituary." | ops-notion-person |
| "Every number in this app is a tally of homework I didn't do. My notes are not a compliance audit and I am not the auditor." | creative-nontech |
| "You built a very good smoke alarm. I don't own a house." | civilian-chatgpt-user |
| "You're the most motivated user this will ever have and you've never once used its main feature. That's not an activation problem, that's an autopsy." | pmf-analyst |

---

## What would flip them

**1. A number, published, reproducible. (6 panellists — the most-cited single ask)**
*ai-researcher, hn-cynic, staff-engineer, seed-investor, pmf-analyst, design-lead.* ~200 questions mined from your own gaps log, 8k budget, three arms: `wiki_context` / `ripgrep + Claude Code` / dump the hand-curated index page. Report accuracy and tokens-to-correct-answer. Staff-engineer set the bar at **+30% or no adoption**. Every one of them said the same thing: ship without this and it stays a dashboard.

**2. Make trust derived and load-bearing — never ask a human again. (7)**
*staff-engineer, oss-wiki-author, obsidian-power-user, ops-notion-person, enterprise-buyer, ai-researcher, seed-investor.* Recency, supersession, link authority, corroboration count, retrieved-then-corrected — computed continuously, fed into ranking, returned inline in `wiki_read`/`wiki_context` as a confidence line the agent must cite. Sign-off survives only as a ~10-page manual override, never a denominator.

**3. Conflict detection at retrieval time, inside the agent's turn. (9)**
Not a corpus-wide audit — compare only the 5–20 passages already selected, emit a `CONFLICT` block, make the agent reconcile before continuing. **Caveat: the existing implementation scores 0/9 on your vault. This needs precision proven before it needs a UI.**

**4. A silent janitor + evidenced deletion. (4)**
*zero-to-one, hn-cynic, youtube-creator, seed-investor.* Fix the 35 dead links and the orphans overnight, unattended, no prompt. Then one screen: "849 pages no agent opened in 60 days, ~1M dead tokens, [Archive]." Obligation becomes appetite.

**5. Read receipts — the only sensor you exclusively own. (3)**
*youtube-creator, seed-investor, hn-cynic.* "9 of your 1,526 pages get read; 849 have never been opened once." Git can't know this. Obsidian can't. Your MCP server can.

**6. Delete the app; ship a plugin or a binary. (3)**
*obsidian-power-user, solo-founder, design-lead.* `npx lore-mcp <vault>` plus an Obsidian plugin. No Electron window, no fifth app.

**7. Out of segment, listed for completeness.** ChatGPT-history importer (*civilian*), signed per-session provenance manifests (*enterprise-buyer*). Both are different products for different buyers.

---

## The ideas worth stealing

**A. Derived trust wired into `pack.ts` — the highest impact-per-hour move in the panel.**
*What:* keep `TRUST_WEIGHT` exactly as it is (`lib/pack.ts:101` — verified 1.35, aging 1.1, unverified 1.0, lapsed 0.8, multiplied into the score at `:157`). Replace only its **input**: swap `trustOf()` from the human ledger to signals you already collect — reads from `usage.jsonl`, link authority, recency vs a superseding page, MinHash near-dup from `similarity.ts`.
*Who:* staff-engineer, oss-wiki-author, obsidian-power-user, ops-notion-person, ai-researcher, leverage judge.
*Cost:* ~1 day, mostly `rm`. The mechanism is built. It is a no-op today only because its single input is a ritual nobody performs.

**B. The eval.**
*What:* three-arm retrieval benchmark on your own gaps log; publish it whether it wins or loses.
*Who:* six panellists, independently, unprompted.
*Cost:* 2 days. This is the cheapest thing in the list and it decides whether anything else is worth building.

**C. Conflict block at retrieval.**
*What:* after passage selection, cluster by overlap (`similarity.ts` exists), one local Ollama call on the 5–20 selected passages — "do any of these assert incompatible facts?" — emit `CONFLICT: A (07-20, 3 inbound) vs B (03-02, 0 inbound)` and mandate reconciliation.
*Who:* nine panellists.
*Cost:* ~1 week — **but gate it behind a precision measurement first.** Current corpus-wide version: 0 true positives in 9. Demand-scoped conflict detection is a genuinely different and much easier problem than corpus-wide NLI, which is why it might work. It still has to be measured.

**D. Read receipts + evidenced delete.**
*What:* one leaderboard from `usage.jsonl` — pages ranked by agent reads, plus "N never opened in 60 days, ~X dead tokens, [Archive]".
*Who:* youtube-creator, hn-cynic, seed-investor.
*Cost:* ~3 days; `lib/usage.ts` and `insights-view.tsx` already exist. This is the only 30-second demo in the product.

**E. Silent janitor.**
*What:* auto-repair dead wikilinks and orphan wiring with no prompt, ever.
*Who:* zero-to-one, devtools-founder.
*Cost:* ~3 days. Low ceiling — it's `find` plus heuristics — but it deletes a guilt tally from the UI, which is worth more than the feature.

**Not worth stealing:** the enterprise provenance manifest (no buyer), the ChatGPT importer (different product, 0% reuse), the weekly Monday Brief (a reader, for people whose defining trait is not reading), the write-path gate (a folder has a hundred write paths — your own `usage.ts` comment refutes it).

---

## The four judges

**KILL JUDGE — "Archive the repo."**
Strongest point: **the missing datum is fatal.** 300 agent writes a week for a year, 2.37M tokens, 849 orphans — and not one logged incident where a stale or contradicting page made an agent do something wrong. Largest sample of this failure mode in your orbit, zero observed instances of the harm. You cannot sell insurance against a fire nobody has had. Secondary: fifteen critics each proposed deleting ~90% of the app, and what they agree on is a weekend of work.

**SURVIVE JUDGE — "One MCP tool, `wiki_context`, flagging contradicted facts inside the agent's turn."**
Strongest point: **the panel is testing the wrong hypothesis.** "Beat ripgrep on accuracy" is a fight you can lose while still being right, because ripgrep is genuinely excellent at finding text. The only claim worth defending is *"I return the current fact when the corpus holds three versions of it."* Measure **stale-citation rate**. Also correctly killed the write-path gate using your own source comment.

**FAIRNESS JUDGE — "The panel is right about sign-off and wrong about its own fix."**
Strongest point, and the single most important finding in this entire report: **`~/.lore/usage.jsonl` has 4 lines.** I verified it. Three are seeded demo-vault fixtures; the fourth is a `"Test reader"` indexing 18 pages. **Lore's MCP has never once served a real retrieval on your real wiki.** Your CLAUDE.md sends agents to the folder directly. So "my agents work fine off an index page" is not evidence that Lore's retrieval loses — Lore was never in the path. The panel called 0 sign-offs the autopsy. The real autopsy is 4 retrieval events, which means the read-path product everyone is recommending is **untested, not disproven**. The fairness judge also caught staff-engineer and enterprise-buyer making factually false code claims (`pack.ts` does weight trust; `mcp/server.mjs:200-208` does emit a trust line), and correctly discarded the "weekend of code" line.

**LEVERAGE JUDGE — "One wire, not a rebuild."**
Strongest point: every ingredient the panel demanded is already on disk — `pack.ts` (trust-weighted ranking), `usage.ts` (read/miss telemetry), `similarity.ts` (MinHash dupes), `embeddings.ts` + `ollama.ts` (local semantic + local LLM), `harness.ts` (auto-installs the MCP into Claude Code/Cursor). What's missing is one wire and six deletions, not a rebuild. But it correctly refused to build it first, because without the number the wire is unfalsifiable.

---

## What I would do Monday

The kill judge is right that the **app** is dead. The fairness judge is right that the **MCP** was never tested. Both can be true, and the resolution is cheap: you can run the decisive experiment in two weeks for near-zero cost, and the cost of *not* running it is that you archive on vibes and never know.

So: **kill the app on Monday. Do not archive the repo until the number exists.** Hard deadline on the number.

**Monday morning — delete, before you build anything.** This is not optional and it is not sequenced after the experiment.

Delete: `verify.ts`, `trust-core.ts`, the review screen, the trust badges, coverage, timeline, schema checker, the graph view, the compare view, the safety view, the policy view, the duplicates view, the markdown editor, the AI rewrite tools, the 6-item nav, the Electron shell, the $12/mo pricing page for a product that does not exist, and the headline *"Your AI takes notes. This is where you read them."* Nobody reads them. That is why they hired the agent.

What survives, headless: `rank.ts`, `pack.ts`, `tokens.ts`, `similarity.ts`, `journal.ts`, `usage.ts`, `mcp/server.mjs`.

**Monday afternoon — the one-line experiment nobody in the panel checked (30 minutes).**
Change your CLAUDE.md from `read /Users/markksantos/Documents/wiki/_meta/hot.md` to `call wiki_context(task)`. Ship `npx lore-mcp <vault>`. Then use your machine normally for two weeks. `usage.jsonl` fills with real retrievals for the first time in the product's life.

This one change simultaneously: puts Lore in the actual path, produces the eval six panellists demanded, fills the read-receipts screen that already ships, and converts "849 orphans" from a guilt tally into "849 pages no agent opened in 14 days" — evidenced deletion instead of homework.

**Week 1 — the number (2 days of work, run in parallel with the two weeks of live use).**
~200 questions from your gaps log, 8k budget, three arms: `wiki_context` / `ripgrep + Claude Code` / dump `hot.md`. Report tokens-to-correct-answer, wrong-page-cited rate, and — per the survive judge — **stale-citation rate on questions where the vault holds a superseded fact.** Publish it either way.

**Week 2 — derive trust, one wire (1 day).**
Keep `TRUST_WEIGHT` in `pack.ts`. Replace `trustOf()` with reads, authority, recency-vs-superseder, near-dup. Sign-off becomes a ~10-page override you may never use. Zero items for the user, ever.

**KILL CRITERIA. Write them down now, before you have a reason to move them.**

1. If `wiki_context` does not beat the index page you already maintain by hand by **30%+** on tokens-to-correct-answer, or does not at least **halve** stale-citation rate — **archive the repo.** Publish the number. That is a genuinely valuable negative result nobody else can produce.
2. If after two weeks of live use `usage.jsonl` shows your agents hitting **fewer than ~40 distinct pages of 1,526**, you do not have a wiki. You have a cache with a 97% miss rate, and the honest product is a delete button, not a retrieval engine.

**Do not build the contradiction queue.** It exists, it measured 0 true positives out of 9 on your corpus, and nine panellists recommended it on intuition without running it. If you touch it at all, touch it only as a precision measurement on the 5–20 passages a real query already selected — never corpus-wide, never as a queue, never as a screen.

**Do not reframe a third time.** Proposal queue died. Sign-off ledger died. If the read-path version does not produce a number, that is three, and three is the answer.

**Keep, regardless of outcome:** the ~200-line script that regenerates your index page under a token budget. That is the part you actually use. It belongs in the wiki repo, not in an app.

Repo: `/Users/markksantos/Developer/Web Apps/lore` · trust weights: `/Users/markksantos/Developer/Web Apps/lore/lib/pack.ts:101` · the 4-line autopsy: `/Users/markksantos/.lore/usage.jsonl`