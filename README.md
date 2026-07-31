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
