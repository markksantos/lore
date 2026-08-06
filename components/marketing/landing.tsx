"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Radio,
  Plug,
  ShieldCheck,
  ChevronDown,
  Download as DownloadIcon,
} from "lucide-react";
import { SceneryImage } from "@/components/marketing/scenery-image";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { HeroSimulator } from "@/components/marketing/hero-simulator";
import { MachineSection } from "@/components/marketing/machine-section";
import {
  WriteFeedDemo,
  GapsDemo,
  BudgetDemo,
} from "@/components/marketing/demos";
import { StackWall } from "@/components/marketing/stack-wall";
import { Reveal } from "@/components/marketing/motion-bits";
import { paletteVars } from "@/lib/palette";
import type { Scene } from "@/lib/scenery";
import { cn } from "@/lib/utils";

export function Landing({
  scene,
  logos,
  siteMode,
}: {
  scene: Scene;
  logos: string[];
  siteMode: boolean;
}) {
  /* On the public site there is no app to open — every filesystem route is off.
     Sending someone to a dead /vault would be the worst possible first click. */
  /*
   * The primary door.
   *
   * On the public site this used to be the fixture demo, which answered "what
   * does it look like" and not "does it work on MY notes" — the question every
   * reviewer actually asked. /web opens the reader's own folder in their own
   * browser, so the first click now lands on their wiki rather than on twelve
   * invented pages. Running locally, the app itself is already the answer.
   */
  const cta = siteMode ? "/web" : "/vault";
  const ctaLabel = siteMode ? "Open your wiki" : "Link your wiki";
  return (
    <>
      <MarketingHeader overHero />
      <Hero scene={scene} cta={cta} ctaLabel={ctaLabel} />

      {/* The product shot bridges the hero and the first content section:
          pulled up so its top overlaps the faded sky and its body extends into
          the page, like a hero shot crossing the seam. */}
      <div className="relative z-20 -mt-[26vh] px-4 md:-mt-[30vh] md:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <HeroSimulator />
        </div>
      </div>

      <WhyNotJustAsk />
      <Measured />
      <HowItWorks />
      {/* The observers sit after "how it works" and before the compatibility
          wall. They are the larger promise, so they come once the reader has
          seen the smaller one delivered — and before the section that asks them
          to install anything. */}
      <MachineSection />
      <Stack logos={logos} />
      <Steps siteMode={siteMode} />
      <Faq />
      <Finale scene={scene} cta={cta} ctaLabel={ctaLabel} />
      <MarketingFooter />
    </>
  );
}

function Hero({ scene, cta, ctaLabel }: { scene: Scene; cta: string; ctaLabel: string }) {
  return (
    <section className="relative bg-[var(--lore-background)]">
      <div className="relative flex min-h-[94svh] flex-col overflow-hidden">
        <SceneryImage
          src={scene.light}
          fileName={`hero-${scene.id}.png`}
          label={scene.label}
          priority
          className="dark:hidden"
        />
        <SceneryImage
          src={scene.dark}
          fileName={`hero-${scene.id}-dark.png`}
          label={`${scene.label} (dark)`}
          className="hidden dark:block"
        />

        {/* Top wash keeps the header and headline legible over the sky. */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,30,22,0.24)_0%,rgba(12,30,22,0.1)_30%,rgba(12,30,22,0)_60%)] dark:bg-[linear-gradient(180deg,rgba(0,0,0,0.4)_0%,rgba(0,0,0,0.18)_30%,rgba(0,0,0,0)_60%)]" />

        {/* Bottom fade melts the art into the page background. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
          style={{ backgroundImage: "var(--scenery-fade-down)" }}
        />

        <div className="relative z-10 flex flex-1 flex-col px-6 py-5 md:px-10 md:py-7">
          <div className="flex flex-1 items-start justify-center pt-[14vh] text-center md:pt-[13vh]">
            <div className="w-full max-w-4xl">
              {/*
                * One line, one sentence, one button row.
                *
                * This carried a three-line headline, a four-line bold
                * paragraph, a two-line caveat and a trust line — five blocks
                * before the fold. A hero has one job: say what this is and
                * offer the next step. Everything cut from here still exists
                * further down the page, where a reader who wants it will look.
                */}
              <h1 className="t-hero text-balance text-white">Know what your agents wrote.</h1>

              <p className="mx-auto mt-5 max-w-xl text-[16px] font-medium text-white/90 md:mt-6 md:text-[19px]">
                Lore reads the markdown folder your AI already writes to, and tells you what
                changed.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={cta}
                  className="group inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white pl-5 pr-4 text-[15px] font-semibold text-[#12356f] transition-colors hover:bg-[#eef2fb]"
                >
                  <span className="leading-none">{ctaLabel}</span>
                  <ArrowRight
                    size={16}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>

                <Link
                  href="/download"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/35 px-4 text-[15px] font-medium text-white backdrop-blur-[2px] transition-colors hover:border-white/60 hover:bg-white/10"
                >
                  <DownloadIcon size={15} />
                  <span className="leading-none">Download</span>
                </Link>
              </div>

              {/* Four claims, four words each. The fit caveat that used to sit
                  above the buttons now opens the section directly below, where
                  it qualifies rather than deflects. */}
              <p className="mt-5 text-[13px] text-white/65">
                Read-only · Free · Open source · Runs on your machine
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Numbers from the vault this was built against, not from a pitch deck.
 *
 * The previous version of this section listed how much had changed unreviewed,
 * which framed the corpus as a liability and the reader as delinquent. These
 * are the same measurements pointed at the thing the product actually does.
 */
function Measured() {
  return (
    <Section
      eyebrow="Measured, not claimed"
      title="Your wiki keeps growing. Your reading doesn't."
      lede="Measured on one real agent-written vault. Yours is a different size — the ratio is what carries over, and the harness ships in the repo so you can check it."
    >
      <Reveal className="mt-12 grid gap-4 sm:grid-cols-3">
        <Stat
          slot={0}
          value="1"
          unit="screen"
          label="however much changed"
          body="The brief reads everything your agents touched since you last looked and says what is true now — one line per change, whether that is three pages this week or three hundred."
        />
        {/*
          * The repo's own number, not a better-sounding one.
          *
          * This read 90% against a 65% baseline. scripts/eval-retrieval.mjs
          * and the table in README.md both say 80% against 50%, and a review
          * panel had already flagged the 90% as stat inflation. A benchmark
          * that disagrees with the benchmark it cites is worse than no
          * benchmark. "recall@5" also went — it is real notation, and it is
          * still jargon on a page two reviewers already bounced off.
          */}
        <Stat
          slot={1}
          value="80%"
          unit="in the top 5"
          label="vs 50% for ripgrep"
          body="Take a question generated from a real page and check whether that page comes back in the top five results. Ripgrep, on the same folder and the same questions, got 50%. Twenty questions on one vault — small, and the harness is in the repo so you can run it on yours."
        />
        <Stat
          slot={2}
          value="0"
          unit="files"
          label="Lore writes to your wiki"
          body="Read-only by default, and the browser version is opened read-only by the browser itself, so a write is refused below our code."
        />
      </Reveal>
    </Section>
  );
}

/**
 * The two objections, answered before anything else.
 *
 * Shown the previous version of this page, two readers in a row asked the same
 * pair of questions: what is this for that my AI cannot already do, and will it
 * mess with my notes? Neither was answered anywhere on the page, and the section
 * that used to sit here was about an approval queue that had been removed —
 * which read, to someone new, as "this is an app for approving wiki edits". That
 * is the opposite of what it is.
 */
function WhyNotJustAsk() {
  return (
    <Section
      eyebrow="The obvious question"
      title="Can't my AI just do this?"
      lede="It already does the writing. Lore is the half that reads it back."
    >
      {/*
        * Three cards, not six, and roughly thirty words each.
        *
        * This was a 3x2 wall of dense paragraphs whose second row answered a
        * different question entirely ("why not git?"). Objections belong in the
        * FAQ, where a reader who has one goes looking; a card grid is for the
        * three things everyone needs, said briefly enough to actually be read.
        */}
      <Reveal className="mt-11 grid gap-4 sm:grid-cols-3">
        <Plain
          slot={0}
          title="It can read the folder. You can't."
          body="Fourteen hundred markdown files are legible to a machine and opaque to a person. Lore is the side of that folder built for you."
        />
        <Plain
          slot={3}
          title="Nothing tells you what changed."
          body="Agents rewrite pages between conversations and announce none of it. Lore watches the folder and says what moved this week, and which agent moved it."
        />
        <Plain
          slot={6}
          title="Every page looks equally true."
          body="A guess from April and a fact you confirmed yesterday sit in the same folder looking identical. Lore keeps the record of which is which."
        />
      </Reveal>
    </Section>
  );
}

/**
 * The fear, addressed in the strongest terms the product can honestly support.
 *
 * "It only writes when you click something" is a promise made of words. The
 * read-only lock is the same promise made of code, so this section can say
 * something checkable instead of something reassuring.
 */
/** A plain titled paragraph — no number, no demo, no chrome. */
function Plain({ slot, title, body }: { slot: number; title: string; body: string }) {
  return (
    <div
      style={paletteVars(slot)}
      className="rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-6"
    >
      <div className="flex items-center gap-2.5">
        <span className="pal-bar !h-5" />
        <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          {title}
        </h3>
      </div>
      <p className="t-body mt-2.5 text-[var(--lore-text-secondary)]">{body}</p>
    </div>
  );
}

function HowItWorks() {
  const items = [
    {
      icon: Radio,
      slot: 3,
      demo: <WriteFeedDemo />,
      title: "It watches the folder, not the agent",
      body: "Every write lands in a journal — Claude Code, Cursor, a sync script, you at midnight. Nothing has to opt in, so nothing can quietly opt out.",
    },
    {
      icon: ShieldCheck,
      slot: 0,
      demo: <BudgetDemo />,
      title: "Ask it instead of reading it",
      body: "Answers come from your own pages, with every source shown — and it says so when your wiki does not have the answer instead of inventing one. All of it on your machine.",
    },
    {
      icon: Plug,
      slot: 6,
      demo: <GapsDemo />,
      title: "It hears what your agents could not find",
      body: "Because they read the wiki through Lore, every search that came back empty is logged. That list is what to write next, assembled from real demand.",
    },
  ];

  return (
    <Section
      eyebrow="How it works"
      title="It reads it so you do not have to."
      lede="Nothing is blocked and nothing is queued."
    >
      {/* Each module sits in a thick colour frame — the pattern that carries
          most of the page's colour. */}
      <div className="mt-12 space-y-4">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <Reveal key={item.title} delay={i * 0.06}>
              <div style={paletteVars(item.slot)} className="frame">
                <div className="grid min-w-0 gap-6 px-6 py-7 sm:px-8 sm:py-8 lg:grid-cols-[1fr_22rem] lg:items-center lg:gap-10">
                  <div>
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                        style={{ background: "var(--plate)" }}
                      >
                        <Icon size={17} />
                      </span>
                      <span
                        className="t-meta text-[var(--lore-text-tertiary)]"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        0{i + 1}
                      </span>
                    </div>
                    <h3 className="t-step pal-title mt-4">{item.title}</h3>
                    <p className="t-body mt-2.5 max-w-xl text-[var(--lore-text-secondary)]">
                      {item.body}
                    </p>
                  </div>
                  <div className="min-w-0 lg:justify-self-end lg:pl-2">{item.demo}</div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * Ask replaced the trust-states section.
 *
 * That section explained a four-state ledger — verified, aging, lapsed,
 * unverified — which asked the reader to learn a vocabulary before they had
 * been given anything. Sign-off still exists and is still optional; it is no
 * longer worth a section of the landing page. This is.
 */
/** The compatibility wall — its own section, between the argument and the steps. */
function Stack({ logos }: { logos: string[] }) {
  return (
    <section className="border-y border-[var(--lore-border)] bg-[var(--lore-background)] py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        {/* Centred, unlike the argument sections either side of it. Those are
            read left to right as prose; this is a wall of marks scanned for the
            one you recognise, and centring lets the eye start in the middle
            rather than tracking from an edge. */}
        <Reveal className="text-center">
          <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
            Works with
          </p>
          <h2 className="t-section mt-3 text-[var(--lore-text-primary)]">
            Anything that speaks MCP.
          </h2>
          <p className="t-lede mx-auto mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
            Twelve tools over MCP, or a plain <code>AGENTS.md</code> for agents that only
            open files. Both point at the same folder, and the watcher covers whatever else
            you run.
          </p>
        </Reveal>

        <StackWall logos={logos} className="mt-12" />
      </div>
    </section>
  );
}

/**
 * Where it runs.
 *
 * Sits after the compatibility grid because that section answers "will it work
 * with my agent" and this one answers "will it work on my machine" — the two
 * questions someone asks in that order before they will click anything.
 */
function Steps({ siteMode }: { siteMode: boolean }) {
  const steps = [
    // Step one differs by context: from the public site the first real action is
    // getting the thing onto your machine, and pretending otherwise would send
    // someone looking for a Browse button that is not there.
    siteMode
      ? {
          n: "1",
          slot: 0,
          title: "Get it onto your machine",
          body: "Clone and run it, or build the desktop app. Node 20 and nothing else — no account, no database, no key.",
        }
      : {
          n: "1",
          slot: 0,
          title: "Link your folder",
          body: "Browse to the folder your markdown lives in. It scans in under a second and starts watching.",
        },
    {
      n: "2",
      slot: 3,
      title: "Write the index",
      body: "One click drops AGENTS.md into your vault. Every file-reading agent finds it without being told.",
    },
    {
      n: "3",
      slot: 2,
      title: "Connect over MCP",
      body: "Copy the config — the path is already filled in — restart your client, and the wiki tools are live. The three that read this machine stay off until you say otherwise.",
    },
    {
      n: "4",
      slot: 6,
      title: "Read your first brief",
      body: "It is the screen that opens. Eight sentences on what your agents wrote, or `lore brief` in the terminal you are already in. Nothing to clear, nothing to approve.",
    },
  ];

  return (
    <Section
      eyebrow="Get started"
      title="Under two minutes."
      lede="Nothing to sign up for. The free build has no account step because it has no server behind it — you point it at a folder and it starts reading."
    >
      <div className="mt-11 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <div key={step.n} style={paletteVars(step.slot)}>
            <span
              className="flex h-8 w-8 items-center justify-center rounded-xl text-[13px] font-bold text-white"
              style={{ background: "var(--plate)" }}
            >
              {step.n}
            </span>
            <h3 className="pal-title mt-3.5 text-[15px] font-semibold">{step.title}</h3>
            <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">{step.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/*
 * Ordered by what people actually ask when they first see this, which is not
 * the order the product finds interesting. The first four are the objections
 * two readers raised unprompted; the rest are the mechanics.
 */
const FAQ = [
  {
    /* Moved out of the card grid. Three cards arguing with git, above the fold
       of the section that answers "what is this", read as defensiveness — and
       an objection nobody has yet is an objection you just planted. Here it is
       one entry, opened only by the reader who came with the question. */
    q: "Why not just use git?",
    a: "Use git — Lore is not a replacement for it. But most of what your agents write never reaches a commit; it happens between them. On the vault this was built against that was 303 changed pages in a week against two commits. And a diff tells you a file changed by twelve lines, not that a client moved their deadline.",
  },
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
    a: "Yes, effectively. Lore is built for people whose AI tools already write markdown files on their machine — Claude Code, Codex, Cursor, or anything writing into an Obsidian vault. The brief, the watcher and the gap log all describe what your agents wrote; with nothing writing files for you they have nothing to describe. Lore is not a note-taking app, and if you are looking for one it will disappoint you.",
  },
{
    q: "Will Lore change or delete anything in my wiki?",
    /*
     * This used to end with an absolute: no background job, no cleanup pass,
     * nothing running unobserved. True when written, false the moment Twin
     * shipped — it runs on a two-minute timer and moves files. Twin now refuses
     * to touch anything inside the vault while the lock is on, so the claim and
     * the code were corrected together, which is the only honest way to resolve
     * one of these. (The old wording is quoted nowhere on purpose: a test
     * greps this file for it.)
     */
    a: "Not unless you switch off the lock, and it is on when you install it. Read-only mode refuses every route that could write to a page, at the boundary, before the code runs — it is not a setting Lore promises to honour. Turn it off and Lore can edit, but even then it only writes when you do something: save a page, create one, capture a link. One feature does act on a timer — Twin, which files things for you — and it is off until you switch it on, starts in a mode where it moves nothing and only reports, undoes everything it did with one button, and will not touch a file inside your wiki at all while the lock is on.",
  },
{
    q: "My agent already edits my wiki and I approve its changes. Why would I want another app for that?",
    a: "You wouldn't, and this isn't one. Lore has no approval queue and cannot gate your agent — it tried, and that was removed, because an agent with filesystem access simply writes and nothing you install can stop it. Your workflow does not change at all. Lore sits beside it and answers the question your current setup does not: across everything your agents have written, which pages have a human actually read, and what changed while you were not watching.",
  },
{
    q: "Why not just use git and a folder?",
    a: "You should use git — Lore is not a replacement and reads a repo happily. But git only records what someone remembered to commit, and most agent writes happen between commits: one measured vault had 303 changed pages in a week and two commits. More to the point, `git log` gives you diffs, and a diff is not meaning — it can tell you a file lost twelve lines, not that a client moved their deadline. Lore reads the change and says what is true now. And because your agents read through Lore, it sees every search that came back empty, which is a to-write list git cannot produce.",
  },
{
    q: "Can't my AI already do all of this?",
    a: "Your AI can read your wiki. You cannot — not 1,400 files in a folder. It also has no memory of what it changed last week, no way to show you which pages nothing links to, and no reason to distinguish a page you confirmed from one it guessed at. Lore is the reader for a folder that only had writers.",
  },
{
    q: "What does Lore give my agents over MCP?",
    a: "Nine tools for the wiki: wiki_index (the map of every page), wiki_search, wiki_read, wiki_context (the best passages on a subject, assembled to a token budget, each citing its page), wiki_brief (what the wiki learned recently, one sentence per page, so a new session can catch up without re-reading), wiki_changes (what moved since a timestamp), wiki_recall (what the wiki said on a past day), wiki_health (dead links, orphans, stale pages) and wiki_write. Eight read, one writes, and the write tool is blocked entirely by read-only mode. Three more reach past the wiki into what Lore observed on this machine — machine_recall for what was on screen, machine_conversations for past AI sessions, machine_find for your files and mail — and those are behind a second switch that is off by default, because handing your mail to an agent is a bigger decision than letting a local model look at your screen.",
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
    a: "Yes, on your own notes rather than a sample. Open /web in Chrome, Edge, Arc or Brave and pick your markdown folder: the page reads it off your disk, nothing is uploaded, and the folder is opened read-only so the browser itself refuses a write. What the download adds is the part a web page cannot do — a watcher that sees what your agents changed and by how much, page history and diffs, the MCP server your agents connect to, local AI, and reading your wiki from your phone.",
  },
{
    q: "Is anything uploaded?",
    /*
     * This used to end with an absolute denial of any uploading code in the
     * downloaded build. That stopped being true the moment Chorus shipped: it
     * POSTs your question to Anthropic, OpenAI or Google when you convene a
     * panel. The sentence predates the feature and nobody went back to it,
     * which is how a privacy claim becomes a false one without anybody lying.
     * A reviewer caught it here, which is the worst place to be wrong about it.
     */
    a: "Your wiki, no. There is no account, no server behind the free build, and nothing that reads your folder ever sends it anywhere. One feature is a deliberate exception and says so on its own screen: Chorus sends the question you type to the model providers you have given keys for, because the whole point of it is asking models built by different companies. Everything else — the brief, Ask, Ghost, Ledger, Oracle, Understudy, Twin — runs against a model on your own machine.",
  },
];


function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section eyebrow="Questions" title="Straight answers.">
      <div className="mt-10 divide-y divide-[var(--lore-border)] border-y border-[var(--lore-border)]">
        {FAQ.map((item, i) => (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-4 py-5 text-left"
            >
              <span className="text-[15.5px] font-medium text-[var(--lore-text-primary)]">
                {item.q}
              </span>
              <ChevronDown
                size={17}
                className={cn(
                  "shrink-0 text-[var(--lore-text-tertiary)] transition-transform duration-200",
                  open === i && "rotate-180",
                )}
              />
            </button>
            {open === i ? (
              <p className="t-body max-w-2xl pb-5 text-[var(--lore-text-secondary)]">{item.a}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Finale({ scene, cta, ctaLabel }: { scene: Scene; cta: string; ctaLabel: string }) {
  return (
    <section className="relative overflow-hidden">
      <div className="relative min-h-[62svh]">
        {/* The same scene the hero drew, anchored to its foot so the page
            closes on the foliage it opened with. */}
        <SceneryImage
          src={scene.light}
          fileName={`hero-${scene.id}.png`}
          label={scene.label}
          position="bottom"
          className="dark:hidden"
        />
        <SceneryImage
          src={scene.dark}
          fileName={`hero-${scene.id}-dark.png`}
          label={`${scene.label} (dark)`}
          position="bottom"
          className="hidden dark:block"
        />

        {/* Matched pair of fades framing a clear centre, so the band joins the
            section above and the footer below without a visible seam. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "var(--scenery-fade-band)" }}
        />

        {/* Centre wash. The art is a saturated sky rather than a muted plate, so
            the closing type is white over a darkening middle — the same
            treatment as the hero. Sits above the fade so the band still melts
            into the page at both edges. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/4 h-1/2 bg-[radial-gradient(ellipse_at_center,rgba(10,26,52,0.42)_0%,rgba(10,26,52,0.22)_45%,rgba(10,26,52,0)_75%)]" />

        <div className="relative flex min-h-[62svh] flex-col items-center justify-center px-6 text-center">
          <h2 className="t-section max-w-2xl text-white [text-shadow:0_1px_18px_rgba(10,26,52,0.35)]">
            Everything you know,
            <br />
            and which of it you checked.
          </h2>
          <p className="t-lede mt-4 max-w-md font-medium text-white/90">
            Your agents will keep writing. Nobody was recording this part.
          </p>
          <Link
            href={cta}
            className="group mt-7 inline-flex h-10 items-center gap-2 rounded-lg bg-white pl-4 pr-3 text-[14px] font-medium text-[#12356f] transition-colors hover:bg-[#eef2fb]"
          >
            {ctaLabel}
            <ArrowRight
              size={16}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ primitives

function Section({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20 md:px-8 md:py-28">
      <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
        {eyebrow}
      </p>
      <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">{title}</h2>
      {lede ? (
        <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">{lede}</p>
      ) : null}
      {children}
    </section>
  );
}

/** A solid colour panel with white type — the loudest thing on the page. */
function Stat({
  slot,
  value,
  unit,
  label,
  body,
}: {
  slot: number;
  value: string;
  unit: string;
  label: string;
  body: string;
}) {
  return (
    <div style={paletteVars(slot)} className="plate px-6 py-6">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[42px] font-bold leading-none tracking-[-0.045em]">{value}</span>
        <span className="plate-muted text-[15px] font-semibold">{unit}</span>
      </div>
      <p className="mt-4 text-[14px] font-semibold leading-snug">{label}</p>
      <p className="plate-muted mt-2 text-[13px] leading-relaxed">{body}</p>
    </div>
  );
}
