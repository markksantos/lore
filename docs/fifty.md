# Fifty things that would make Lore better

Written 2026-07-31, against the real wiki: 1,526 pages, 2.37M tokens, 849 orphans
(56%), recall@1 40% vs ripgrep's 20%.

## The number that should decide the order

`~/.lore/usage.jsonl` — 197 calls over 5 days:

| caller | calls |
| --- | --- |
| You (Ask) | 193 |
| Claude Code | 3 |
| Test reader | 1 |

Lore is being used as a reader by one human. The thing it was built for — agents
pulling context out of the wiki and writing better pages back into it — has
happened three times in five days.

So the ordering below is not "what would be nice". It is: close the loop with the
agent first, because that is the loop that isn't running. Everything that only
improves what Mark looks at is downstream of that.

---

## Tier 1 — Close the loop at write time (8)

Today Lore watches agents write and reports afterwards. The agent never hears
anything back. Every item here puts a sentence in the `wiki_write` tool result,
where the author can still act on it in the same turn. This is the single
highest-leverage change in the document.

1. Write-time contradiction warning. `wiki_write` returns "this contradicts
   `pricing/rates.md:12` — 'video floor $100' vs your '$150'". The agent either
   fixes its claim or updates the old page. Contradictions stop accumulating.
2. Write-time link suggestion. Return the 3 pages this new page should link to,
   by id. 56% of the wiki is orphaned because nobody ever told the author to
   link; this tells them at the only moment it's cheap.
3. Near-duplicate interception. Above ~70% similarity, return "append to
   `clients/phil-walsh.md` instead?" with the id, rather than accepting page
   1,527.
4. Frontmatter repair on write. `lib/schema-check.ts` already knows the schema —
   run it in the write path and return the corrected frontmatter instead of
   validating after the fact.
5. Consolidation nudge. A soft per-session write budget: after N new pages,
   return "you've created 12 pages this session; 4 of them are about the same
   subject."
6. Expiry on volatile facts. `expires: 2026-09-01` on prices, versions,
   deadlines. Retrieval down-ranks expired claims and the brief surfaces them.
7. `supersedes:` links. When a page replaces another, record it, so an agent that
   retrieves the old one is told where the current version lives.
8. Session provenance. Every page records the agent, the session, and the
   conversation URL that produced it. Then "where did this claim come from" is a
   click, not an archaeology project.

## Tier 2 — Make agents actually route through Lore (6)

Tier 1 is worthless if `wiki_write` is never called. Three calls in five days is
the disease; these are the cure.

9. An install pack. One command that writes the MCP config, the skill, and the
   session hooks into Claude Code, Codex and Hermes at once. Today Connections
   shows you the JSON and wishes you luck.
10. A session-start hook that calls `wiki_brief` automatically, so every agent
    opens with what changed since it last ran.
11. A session-end hook that calls `wiki_write` with what was learned. The write
    loop should not depend on the agent remembering to be a good citizen.
12. Retrieval receipts. A panel showing which pages agents actually pulled, per
    day, per agent. The 193/3 split above should have been visible in the app
    from day one instead of requiring a shell script.
13. A "your agents have not read this wiki in 5 days" banner. Lore should be the
    first thing to notice it has stopped being used.
14. Per-agent identity and scoping — this agent reads `clients/` only, that one
    writes `stack/` only. Both a safety feature and the thing that makes receipts
    legible.

## Tier 3 — Retrieval worth trusting, and measurable (9)

recall@1 is 40%. That means the top passage is wrong more often than right.

15. Golden question set. Pin questions with known-correct pages; re-run on every
    index rebuild and fail loudly on regression. `scripts/eval-retrieval.mjs`
    exists — it belongs in the UI, not in a terminal I ran once.
16. Cross-encoder rerank of the top 20 using the local Ollama model. The cheapest
    remaining accuracy win.
17. Query rewriting before retrieval — expand acronyms, resolve "the client" and
    "that project" against the current thread.
18. Explicit negative results. "No page covers this" is a useful answer and the
    trigger for an agent to write one. Silently returning the least-bad passage
    is how wikis rot.
19. Confidence on `wiki_context`. Return a score with the pack so the agent knows
    whether to trust it or go read the source.
20. Recency-aware scoring. "What's my current rate" should not be able to return
    a page from March when July's exists.
21. Scoped retrieval — `scope: "clients/"` as an MCP argument.
22. Section anchors in results, so agents cite `page.md#rates` rather than a
    1,200-token page.
23. Warm embeddings by default, incrementally maintained. Semantic search that
    requires a manual build is semantic search nobody uses.

## Tier 4 — Supervision that earns its screen (8)

24. Rebuild the contradiction detector around extracted claims
    (subject / predicate / value), not text overlap. It currently scores 0/9 on
    the real wiki; one group keyed on the pronoun "those".
25. Canon. A short list of facts Mark asserts by hand. Anything contradicting
    canon is flagged loudly, everywhere, forever.
26. Undo an agent. Revert every write from one agent or one session in a click.
27. Quarantine. A folder agents can write to that does not enter retrieval until
    promoted — the promotion model, applied to writes rather than sign-offs.
28. Fact-level page history. "This page's rate changed three times" beats a line
    diff.
29. Archive suggestions driven by usage: never retrieved in 90 days, never linked,
    never edited. Currently there is no principled way to shrink the wiki.
30. Coverage gaps that name the gap: "40 pages on clients, zero on the pricing
    decisions behind them."
31. Protected paths with alerts — a write to `raw/finance/` should be an event,
    not a line in a journal.

## Tier 5 — Ask as a real tool (7)

32. Streaming tokens. 6.5 seconds of nothing reads as broken; 6.5 seconds of
    text reads as thinking.
33. Multi-turn context. Follow-ups currently start cold.
34. Save an answer back into the wiki as a page, with its citations intact. The
    synthesis is usually the most valuable artifact in the session and it
    currently evaporates.
35. Surface disagreement instead of averaging it: "two pages disagree — here is
    each, with dates."
36. Ask across time. "What did I believe about this in May?"
37. Export a thread as markdown.
38. ⌘K palette — jump to page, ask, switch vault, from anywhere.

## Tier 6 — Brief depth (5)

39. Group by thread rather than a flat reverse-chronological list. The threads are
    already computed and used only as a footnote.
40. Impact links — for each item, the pages it affects or contradicts.
41. Mute a page or a folder. Some directories are noise forever.
42. A local daily digest notification, so the brief reaches you without opening
    the app.
43. Diff-on-hover for each brief row, so "rewritten" can be checked without a
    page load.

## Tier 7 — Beyond one machine (7)

44. Git-native mode. Every agent write is a commit authored by the agent. History,
    blame, revert, and sync — for free, with no new storage format.
45. Sync across machines via a git remote. Honest, private, and already how
    developers move text around.
46. Multi-vault with cross-vault search — the personal wiki and a client wiki are
    not the same corpus but the questions cross them.
47. Team mode: shared wiki, per-person seen state, per-person brief.
48. An Obsidian plugin, so Lore is a layer over the vault someone already has
    rather than an app they must switch to.
49. Domain starter kits — a client wiki, a codebase wiki, a research wiki, each
    with its schema and its agent instructions.
50. Publish a read-only subset. The wiki is the best artifact most people never
    show anyone.

---

## Not on the list — known broken, so not "additions"

- Brief fallback lines render raw markdown (`[jmcartan](jmcartan/profile.md) -
  **Jared…**`). Needs `renderAnswer`-style treatment.
- The `synthesised` flag is wrong when only some lines come back from the model,
  so the "install Ollama" banner shows on briefs that were model-written.
- Ask starter questions all read "What do I know about Mark Studios…" — the
  one-per-folder rule doesn't handle near-identical titles across folders.
- The attribution hook is not installed, so the authorship term in
  `scoreForBrief` is inert.

## Honest note on the tail

Tiers 1 and 2 are the product. Tier 3 is the quality of the product. Tiers 4–7
are real, but several of them (37, 41, 43) are the kind of item you add because
the number is fifty. If only five ship, ship 1, 2, 9, 12 and 15.
