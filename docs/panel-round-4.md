# Lore — Panel Round 4 (9 blind reviews)

## 1. The numbers

| Persona | Score | Would use |
|---|---|---|
| Carpathy — AI researcher, LLM-wiki originator | 7 | Yes |
| Skeptical productivity journalist | 7 | Yes |
| Hardcore PKM power user (Obsidian, 4k notes) | 7 | Yes |
| AI-tools YouTuber (800k subs) | 7 | Yes |
| Staff engineer, team of 8 on Claude Code | 6 | Yes |
| Product designer, shipped consumer apps | 6 | Yes |
| Indie founder, 6 launches / 4 kills | 6 | Yes |
| Joe, 34 — non-technical ops manager | 2.5 | No |
| Ruth, 78 — retired schoolteacher | 2.5 | No |

**Mean score: 5.67 / 10** (51 ÷ 9)
**Would use: 7 of 9** — every technical persona yes, both non-technical personas no.

---

## 2. Consensus dealbreakers

Issues raised independently by 3+ personas, ranked by breadth.

### 2.1 Watch and Insights are dead screens — 9 of 9 personas

Every single reviewer hit this. Two of nine nav items render an infinite spinner on a blank page: no skeleton, no empty state, no timeout, no error.

- **Designer:** "no skeleton, no empty state, no timeout, no error. Two of nine screens are dead weight."
- **Ruth:** "completely blank white with a spinner. Two of nine menu items showed me nothing at all."
- **PKM user:** "infinite spinners on a 1,633-page vault — never rendered. Two of nine nav items effectively broken."
- **Staff engineer:** "/api/changes takes 5.5s" — the likely cause on a large vault.
- Carpathy, Journalist, Joe, YouTuber, Founder: same finding, near-identical words.

### 2.2 Brief's flagship promise silently degrades without Ollama — 9 of 9 personas

The hero promises "one sentence each" / "the eight that matter." The default install shows each page's raw first sentence, truncated mid-word, with the real behavior gated behind installing Ollama — disclosed only in footer fine print.

- **Journalist:** "Hero promises 'one sentence each'; the Brief actually shows each page's raw first sentence, truncated mid-word, with a footnote saying install Ollama for the real thing."
- **Founder:** "the hero promise silently degrades on a default install, admitted only in footer fine print."
- **Ruth:** "stuttering fragments ('boat-rehab-tv - Chattanooga Fiberglass / Boat Rehab TV Who they are Owner/operator...'), not the promised one clear sentence each."
- **Staff engineer:** "Brief 'sentences' are just page-title + first-line fragments ... App admits it in a footer."
- **Designer:** "'sbsherman Who they are Fiverr username: sbsherman.' Unreadable."
- **Journalist**, on the ranking itself: "eight near-identical 'Who they are: Name' rows — the ranking surfaces noise, not meaning."

### 2.3 The server dies — often when you Ask — 7 of 9 personas

Six reviewers watched the process drop off :4646 during or immediately after POST /api/ask; a seventh (PKM) saw one in-flight Ask starve every other request. Three called it a dealbreaker outright.

- **Founder (dealbreaker):** "POST /api/ask returned empty twice, then the entire server died — connection refused, nothing listening on 4646. Asking your wiki a question kills the app."
- **Designer (dealbreaker):** "Server became unreachable immediately after my first POST /api/ask and never came back. The feature the whole pitch rests on cannot be trusted to not take the app down."
- **Joe (dealbreaker):** "If a question can kill it, I can't trust it."
- **Carpathy:** "Server on :4646 was dead mid-review (connection refused); I had to restart it myself to finish. A memory layer agents depend on cannot silently die."
- **YouTuber:** "On camera that's a killed take."
- **Journalist:** "dropped off port 4646 for ~40s ... then quietly recovered."
- **PKM user (related):** "One in-flight Ask starves everything: search went 65ms → 46s while the model ran."

### 2.4 A pricing page where nothing is for sale — 7 of 9 personas

$12 and $129 tiers both stamped "Not open yet." Universally read as honest, and universally read as dead weight.

- **Ruth:** "a price list where the only thing you can get is free. Why is this page here?"
- **Joe:** "Pricing shows $12 and $129 plans you literally cannot buy ('Not open yet'). Why is there a pricing page?"
- **PKM user:** "a pricing page for unbuyable tiers is dead weight."
- **YouTuber:** "a pricing page with no checkout is a weird flex."
- **Founder:** "pricing page is aspirational, zero revenue path today."
- **Staff engineer (dealbreaker for his use case):** "No multi-user story at all: no auth, no identity, one vault, one machine. Team tier is 'Not open yet.' Nothing here for 8 people."

### 2.5 The landing page is a beautiful essay nobody will finish — 7 of 9 personas

- **Founder:** "~10 screens of dense literary prose. The hook is great; the essays after it bury the CTA."
- **Designer:** "~2x too long ... Repeating 'it won't touch your files' six times reads as protesting too much."
- **Journalist:** "'That is a poor place to stand if you want to block a write' is a nice line the third time; there are thirty of them and a 14-question FAQ."
- **YouTuber:** "Viewers won't read it; needs a demo GIF up top."
- **Ruth:** "a teacher would hand this essay back for trimming."
- **Joe (jargon variant):** "Jargon wall: MCP, AGENTS.md, frontmatter, loopback, proxy.ts — on the marketing pages, not just settings."

### 2.6 Ask/search latency is unusable — 3 of 9 personas (but the harshest words in the round)

- **Staff engineer (dealbreaker):** "/api/ask took 119s for one question on a 1,633-page vault. Nobody on my team asks a second question after that."
- **PKM user:** "Ask takes 77-82s per question ... my ripgrep answers in 50ms. Retrieval quality is real but the latency kills the habit."
- **Carpathy:** "/api/search took 30.1s, /api/health 10s ... Agent clients will time out and retry."

### 2.7 "90% recall@5, up from 0%" is stat inflation — 3 of 9 personas

- **PKM user:** "up from zero of what? Meaningless baseline; reads as stat inflation on an otherwise honest page."
- **Staff engineer:** "The harness's own comments call an 'up from 0%' framing meaningless; n=30 synthetic Qs, one vault."
- **Journalist:** "A baseline that flattering is a baseline that means nothing."

### 2.8 Audience gate: assumes an agent-written vault exists — 3 of 9 personas

- **Joe (dealbreaker):** "I don't [have agents], and nothing tells a normal person this is coder-only before they've read three screens."
- **Ruth:** "'Claude Code, Cursor or Obsidian' and 'markdown folder' lost me by sentence two."
- **YouTuber:** "Most viewers don't [have a vault] — no sample vault to try the wow moment instantly."

---

## 3. Splits — genuine disagreement

**Who this is for.** The panel split cleanly by audience, not opinion. All seven technical personas would use it (6–7 scores); both non-technical personas scored 2.5 and out. This isn't a quality split — Joe and Ruth both *praised* the honesty and the UI — it's a market-boundary split. Joe: "Polished and weirdly honest, but it's built for people whose AI writes files all day." The disagreement is whether that's a flaw or a focus: Joe counts it as a dealbreaker; the founder counts the same wedge as the whole point ("Real wedge — the Brief plus being the MCP sensor").

**The copy: elite or exhausting — sometimes both from the same mouth.** Designer: "the best-written dev-tool landing page I've seen" and also "~2x too long." Founder: "best copy I've seen this year" and "the essays after it bury the CTA." The panel agrees the hero line is elite ("states the entire product in ten words") and agrees the page after it is too long; where they disagree is whether the length is charm (Carpathy quotes it approvingly) or "protesting too much" (Designer).

**The pricing page: honesty vs. dead weight.** Nobody was fooled and nobody was charged, so the journalist and founder read "Not open yet" as credibility. Ruth, Joe, and the PKM user read the same page as pointless. Fairly stated: the honesty is real *and* the page currently does no work.

**Latency: fatal or unencountered.** The staff engineer and PKM user hit 77–119s Ask times and called them habit-killing to dealbreaking. Personas who evaluated Ask by its output (journalist, Ruth, YouTuber) called it the best feature in the product. Both are right: the answers are good and nobody will wait for them.

**Ask trustworthiness.** PKM user verified Ask "honestly refuses out-of-corpus questions with a LOW CONFIDENCE verdict instead of hallucinating." Staff engineer found the opposite edge: "answer correctly said 'not mentioned', verdict said 'The wiki covers this' at conf 0.70" — the verdict layer can contradict its own answer. Not a contradiction between reviewers; a contradiction inside the product.

---

## 4. What survived contact

Praise given independently by 2+ personas.

- **Read-only enforced at one boundary, and verifiably so** — 6 personas. Staff engineer verified it hostilely: "POST /api/page returned a clean 403", "Binds 127.0.0.1 only (verified via lsof) ... path traversal blocked." Carpathy: "Read-only is enforced at one choke point (proxy.ts, fails closed) and ... the copy matches the source, which almost never happens." PKM: "First tool to pass my checklist."
- **Radical honesty as a product trait** — 7 personas, including both detractors. Ruth: "The safety promises are in genuinely plain English ... I believed them." Joe: "I believed it." Journalist: "Rare honesty: unsigned-binary explainer, 'Not open yet' pricing." Founder: "'not open yet' instead of fake checkout."
- **Ask's substance: citations + confidence + local model** — 4 personas. Journalist: "it got the $100 edit floor right from the user's own pages." Ruth: "showed exactly which pages it read — that is honest homework." YouTuber: "that's the thumbnail moment."
- **The hero line** — 3 personas quoted it back verbatim as elite. Designer: "states the entire product in ten words."
- **Connections screen** — 3 personas. Designer: "best-in-class trust design: exact config paths, exact edits, backup behavior, and idempotency all spelled out before you click." Founder: "best-in-class onboarding."
- **Gap logging (searches that returned nothing → to-write list)** — 2 personas. PKM: "a genuinely new idea no PKM tool has." Carpathy agrees — while warning the broken MCP search is currently polluting that very signal.
- **Positioning is a real gap** — 2 personas. Journalist: "a gap none of the hundred dead second-brain apps ever addressed."

---

## 5. Five most actionable fixes (severity × breadth)

1. **Make /api/ask unable to kill the process.** 7/9 hit a crash or full starvation; 3 dealbreakers. Move model inference out of the request path — spawn it as a child process or worker with a hard timeout (e.g. 60s), catch every rejection, and return a 503 with a readable error instead of dying. Add a supervisor (or simply `pm2`/launchd keep-alive) so :4646 restarts if it does die. Acceptance test: POST /api/ask 10 times in a row, including malformed bodies, and `curl /api/health` must answer <1s throughout.

2. **Fix or ship empty states for Watch and Insights.** 9/9 hit the infinite spinner. Root cause is load time on large vaults (/api/changes at 5.5s per the staff engineer): paginate the changes feed, cap the initial query, and render incrementally. Independently of the data fix, every screen gets a 10s timeout that flips the spinner to an error card with a retry button, and a real empty state when there's no data. No screen in the app may spin forever.

3. **Fix the default-install Brief.** 9/9 flagged it. Three concrete changes: (a) replace the raw-first-sentence fallback with a real extractive summary — first sentence of the first content section after frontmatter, cut at a sentence boundary, never mid-word; (b) when Ollama is absent, show a dismissible banner at the *top* of Brief — "Summaries are extracts. Install Ollama for one-line summaries → [command]" — not a footnote; (c) soften the hero or make the default match it. The hero currently promises something the default install does not do, and every reviewer noticed.

4. **Kill the latency cliff.** Queue Ask requests and keep search/health on a separate execution path so one inference can't take search from 65ms to 46s (PKM). Cache the index across requests so /api/search cold-start drops from 30.1s (Carpathy) to sub-second. Stream Ask tokens to the UI so 80s of wall time feels like progress instead of a hang. Also fix the verdict/answer contradiction the staff engineer caught: if the answer text says "not mentioned," the verdict must not say "The wiki covers this."

5. **Fix HTTP MCP wiki_search and stop polluting the gap log.** One reviewer, but he's the persona the product is named for, and it corrupts the product's flagship signal: exact-substring matching on the whole lowercased query (app/api/mcp/route.ts:130) false-negatives every multi-word query, then logs it as a "gap." Tokenize the query, require all terms (or rank by term hits), and return snippets so the HTTP surface matches the stdio server and /api/search. While in there: validate the Host header (staff engineer: `Host: evil.example → 200` on a localhost server that invites unlocking writes — classic DNS-rebinding surface).

Honorable mention, near-free: delete "Up from 0%" from the landing page (3 personas called it stat inflation on an otherwise honest page — the eval harness's own comments agree), and cut the landing page roughly in half with a demo GIF above the fold.

---

## 6. Is it ready, and for whom

Lore is a well-aimed product wrapped around a v0.1 runtime, and the panel's numbers say exactly that: seven technical reviewers would use it despite everything, and both civilians bounced off in under three screens. The philosophy is validated — read-only at one enforced boundary, gap logging, budgeted context packs, and a level of copy honesty that multiple hostile reviewers called the rarest thing about it. But it is not ready to ship beyond early adopters, for one blunt reason repeated in three separate dealbreakers: asking your wiki a question can kill the app, and when it doesn't, it takes two minutes to answer, while two of nine screens never load at all. The audience is precisely the person the founder persona described — someone with a large agent-written vault who wants the Brief and the MCP sensor — and for that person it's worth running today with a process supervisor attached. For everyone else, and for any claim of being a "memory layer agents depend on," it fails its own standard until the crash, the spinners, and the Ollama-shaped hole in the flagship feature are gone. Ship the one feature, cut the museum.
