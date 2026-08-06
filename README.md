<div align="center">

# Lore

**Your agents wrote 300 pages this week. Here are the eight that matter.**

Point Lore at the markdown folder your agents already write to. It reads what
changed and tells you what is now true — one sentence each — and answers
questions from your own pages. Nothing to review, nothing to approve, no file
touched.

</div>

---

## Thirty seconds

```bash
npx lore-wiki brief                 # what your agents wrote today
npx lore-wiki ask "what do I charge Phil Walsh?"
```

```
What your agents wrote today

  • Maja requested a long-form wedding editor role for $500, significantly below
    the calculated project rate
    maja - Sonia / Fiverr Pro Talent Sourcing

  • Carlos from Orobi Cybersecurity drafted a $100 order-5 offer including
    specific footage and address masking
    carcerv - Carlos (Flipper Zero TikTok)
```

That is the product. Everything below is detail.

## Why

A wiki your agents write to grows faster than you can read it. One measured
vault: **1,546 pages, 2.3M tokens, ~300 writes a week, 56% of it linked from
nowhere.** Nobody reads that, which is the entire reason the agent was told to
write it down.

So Lore assumes you will never read your wiki, and works anyway.

**The brief** reads what changed — the actual diff, not the top of the page —
and says what is true now, in a sentence. A local model writes the lines; the
wiki never leaves your machine. Pages you have already been shown, or already
opened, fade out, so tomorrow's brief is not today's.

**Ask** retrieves from your own pages, answers only from those passages, cites
every one, and says so plainly when your wiki does not contain the answer
instead of inventing something that sounds right.

## Does the retrieval actually work

A synthetic-QA harness ships in the repo: it generates a question from a real
page, then checks whether that page comes back. Run it on your own vault.

```bash
node scripts/eval-retrieval.mjs --n 20
```

On the 1,546-page vault above, against `ripgrep` on the same folder and the
same questions:

|                | Lore | ripgrep |
| -------------- | ---- | ------- |
| recall@1       | 40%  | 20%     |
| recall@5       | 80%  | 50%     |
| median rank    | 2    | 5       |

Small sample, and questions are model-generated per run, so treat recall@5 and
the median as the signal rather than any single figure. The harness is in the
repo so you can disagree with it.

## And the machine it runs on

The wiki is half of Lore. The other half reads the computer — and every one of
these is **off until you switch it on**, individually, with one switch that
pauses all of them at once.

| | |
| --- | --- |
| **Ghost** | Photographs your screen every few seconds and describes it with a model on your machine. Then: *what was that error twenty minutes ago?* |
| **Ledger** | Every Claude Code session, Codex run and Cursor chat on this Mac, in one search box. 2,090 conversations and 55,000 messages indexed in a minute on the machine this was built on. |
| **Oracle** | Files, mail, calendar, iMessage, Notes, browser history, photos — one index, one question. Each source is a separate decision. |
| **Understudy** | Measures how you actually write — median sentence length, contraction rate, the words you reach for — and drafts in that. Scores the draft against you afterwards. Never leaves the machine. |
| **Twin** | Notices the filing you repeat and offers to take it over, as a rule you read before it runs, dry-run first, undoable after. |
| **Chorus** | Several models answer, critique each other blind, then one writes the verdict — and names what the panel could not agree on. |
| **Prophet** | Speaks first, and only when it has something. Your call is in twenty minutes; here is what was left open last time. Waving a card away halves how loudly that kind can speak; do it a few times and it stops appearing. |

**The promises, in code rather than in words.** Consent is one file
(`lib/observers.ts`) that every observer asks before doing anything, checked per
tick so pausing takes effect immediately. Password managers are skipped *before*
the screenshot is taken, not filtered after. Extracted text runs through the
same secret scrubber the rest of Lore uses. Every index is a file you can
delete, and the delete button removes the write-ahead log too. Chorus is the only
part of Lore that sends anything you wrote to a company that is not you — and it
sends the question you typed, to providers whose keys you supplied. (Two other
places reach the network at all, both on your explicit instruction: enriching a
link you pasted fetches that link, and an outgoing webhook posts where you told
it to.)

Ghost, Ledger, Oracle, Twin and Prophet need the app — a web page cannot
photograph your screen or read your mail, which is the browser working
correctly. Understudy's measurements run in a browser tab for real; drafting
needs a local model. See [DOCUMENTATION.md](DOCUMENTATION.md#17-the-observers--lore-and-the-machine-it-runs-on)
for how each one works and what is deliberately not built.

## For your agents

The brief is not only for you. The reader who most needs "what did the other
agents learn since I last ran" is the next agent.

```
wiki_brief     what the wiki learned recently, one sentence per page
wiki_context   the best passages on a subject, to a token budget, each cited
wiki_index     the map of every page
wiki_search    keyword search
wiki_read      a page
wiki_changes   what moved since a timestamp
wiki_health    dead links, orphans, stale pages
wiki_write     the one that writes — blocked entirely by read-only mode
```

Connect it in Settings, or point your MCP config at `mcp/server.mjs`.

## Your files

Lore never moves, renames or reformats anything. It is **read-only by default**,
and the browser build is opened read-only by the browser itself, so a write is
refused below our code. Its own state lives in `~/.lore`, outside your vault, so
`git diff` of your notes stays clean.

## Install

```bash
git clone https://github.com/markksantos/lore.git
cd lore && npm install && npm run dev     # http://127.0.0.1:4646
```

Needs Node 20.9+. A local model via [Ollama](https://ollama.com) is optional —
without one the brief falls back to plainer extraction and Ask returns the
passages without writing them up.

## CLI

```bash
lore brief [--days N] [--write [file]] [--peek]
lore ask "<question>"
lore health [--json] [--max-dead N] [--min-score N]   # exits non-zero: gates CI
lore changes [--since ISO|ms]
lore gaps
```

## Licence

MIT. Design system adapted from [Creed](https://github.com/connorhpbrn/creed).
