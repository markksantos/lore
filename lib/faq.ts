/**
 * The FAQ, in a plain module.
 *
 * It is rendered twice: as the accordion on the landing page, and as
 * schema.org FAQPage JSON-LD in the document head. The second one is what an
 * AI search engine reads when somebody asks it what Lore is, which makes these
 * twelve answers the version of this page most likely to be quoted back.
 * A client component cannot be the source for the server-rendered script tag,
 * so the data lives here and both sides import it.
 */

export const FAQ: { q: string; a: string }[] = [
  {
    /*
     * First, because it is the question that decides whether the rest matters.
     *
     * Both non-technical reviewers in a blind panel scored this product 2.5 and
     * left inside three screens — not because it is bad, but because nothing
     * told them it was not for them. Saying so plainly costs one entry and
     * saves everyone the wrong download.
     */
    q: "Do I need AI agents for this to be useful?",
    a: "Mostly yes. The wiki half — the brief, the watcher, the gap log — describes what your agents wrote, and with nothing writing files for you it has nothing to describe. The machine half is different: Ghost, Oracle and Ledger index your screen, your disk and your past AI chats whether or not anything writes markdown. But Lore is not a note-taking app, and if that is what you are looking for it will disappoint you.",
  },
  {
    q: "Will Lore change or delete anything in my wiki?",
    a: "Not unless you switch off the lock, and it is on when you install it. Read-only mode refuses every route that could write to a page, at the boundary, before the code runs — it is not a setting Lore promises to honour. Turn it off and Lore can edit, but even then it only writes when you do something: save a page, create one, capture a link. One feature does act on a timer — Twin, which files things for you — and it is off until you switch it on, starts in a mode where it moves nothing and only reports, undoes everything it did with one button, and will not touch a file inside your wiki at all while the lock is on.",
  },
  {
    q: "Is anything uploaded?",
    a: "Your wiki, no. There is no account, no server behind the free build, and nothing that reads your folder ever sends it anywhere. One feature is a deliberate exception and says so on its own screen: Chorus sends the question you type to the model providers you have given keys for, because the whole point of it is asking models built by different companies. Everything else — the brief, Ask, Ghost, Ledger, Oracle, Understudy, Twin — runs against a model on your own machine.",
  },
  {
    q: "Why not just use git and a folder?",
    a: "You should use git — Lore is not a replacement and reads a repo happily. But git only records what someone remembered to commit, and most agent writes happen between commits: one measured vault had 303 changed pages in a week and two commits. More to the point, `git log` gives you diffs, and a diff is not meaning — it can tell you a file lost twelve lines, not that a client moved their deadline. Lore reads the change and says what is true now. And because your agents read through Lore, it sees every search that came back empty, which is a to-write list git cannot produce.",
  },
  {
    q: "My agent already edits my wiki and I approve its changes. Why would I want another app for that?",
    a: "You wouldn't, and this isn't one. Lore has no approval queue and cannot gate your agent — it tried, and that was removed, because an agent with filesystem access simply writes and nothing you install can stop it. Your workflow does not change at all. Lore sits beside it and answers the question your current setup does not: across everything your agents have written, which pages have a human actually read, and what changed while you were not watching.",
  },
  {
    q: "Can't my AI already do all of this?",
    a: "Your AI can read your wiki. You cannot — not 1,400 files in a folder. It also has no memory of what it changed last week, no way to show you which pages nothing links to, and no reason to distinguish a page you confirmed from one it guessed at. And it certainly cannot tell you what was on your screen at two o'clock, or find the session you had in a different tool three weeks ago. Lore is the reader for a machine that only had writers.",
  },
  {
    q: "What does Lore give my agents over MCP?",
    a: "Nine tools for the wiki: wiki_index (the map of every page), wiki_search, wiki_read, wiki_context (the best passages on a subject, assembled to a token budget, each citing its page), wiki_brief (what the wiki learned recently, one sentence per page, so a new session can catch up without re-reading), wiki_changes (what moved since a timestamp), wiki_recall (what the wiki said on a past day), wiki_health (dead links, orphans, stale pages) and wiki_write. Eight read, one writes, and the write tool is blocked entirely by read-only mode. Three more reach past the wiki into what Lore observed on this machine — machine_recall for what was on screen, machine_conversations for past AI sessions, machine_find for your files and mail — and those are behind a second switch that is off by default, because handing your mail to an agent is a bigger decision than letting a local model look at your screen.",
  },
  {
    q: "How much disk and battery does watching cost?",
    a: "Ghost is the expensive one: at a frame every fifteen seconds it settles around two gigabytes a week, and it deletes anything older than the retention you set — seven days by default. Frames that are visually identical to the last one are not stored twice and not described again, which is most of them if you leave a window open. Oracle's index of a large disk lands in the low hundreds of megabytes. Everything is in ~/.lore, and every observer has a button that deletes its own data on the spot.",
  },
  {
    q: "Does Lore move or reformat my files?",
    a: "No. It reads the markdown where it sits — your headings, your frontmatter, your [[wikilinks]], your folder names. Its own state lives in ~/.lore, outside the vault, so it never turns up in a git diff of your notes. No page is reformatted on the way through.",
  },
  {
    q: "Does it work with my Obsidian vault?",
    a: "Yes — that is the intended case, and here is exactly what is supported. [[Wikilinks]] resolve by full path, by basename and by frontmatter aliases, and [[page|display text]] shows your label. ![[image.png]] embeds render as images; ![[note]] embeds render as a link to that note rather than inlining it. Inline #tags, YAML frontmatter and block ids (^abc123) are all handled, and .obsidian and .trash are skipped. A [[page#heading]] link opens the page — it does not scroll to the heading. Dataview inline fields are left exactly as written; if you want your sign-offs queryable in Dataview, Settings can stamp lore_verified into the frontmatter, off by default.",
  },
  {
    q: "Can I try it without installing anything?",
    a: "Yes, on your own notes rather than a sample. Open /web in Chrome, Edge, Arc or Brave and pick your markdown folder: the page reads it off your disk, nothing is uploaded, and the folder is opened read-only so the browser itself refuses a write. What the download adds is the part a web page cannot do — the seven observers, a watcher that sees what your agents changed, page history and diffs, the MCP server your agents connect to, local AI, and reading your wiki from your phone.",
  },
  {
    q: "What does it cost, and what is the catch?",
    a: "Nothing, and there isn't one in the usual sense. It is open source and runs entirely on your machine, so there is no per-seat cost to us and no usage to meter. The real cost is yours: the local model wants a machine with enough memory to run it, and Ghost wants a couple of gigabytes of disk a week. If you use Chorus you pay your own model providers directly — Lore never sits in the middle of that.",
  },
];
