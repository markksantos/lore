"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Download as DownloadIcon,
  EyeOff,
  Lock,
  Minus,
  Plug,
  ServerOff,
  Sparkles,
  Wallet,
} from "lucide-react";
import { SceneryImage } from "@/components/marketing/scenery-image";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { HeroSimulator } from "@/components/marketing/hero-simulator";
import { MachineSection } from "@/components/marketing/machine-section";
import {
  AskCard,
  BriefCard,
  GapsCard,
  TerminalCard,
  WatchCard,
} from "@/components/marketing/feature-cards";
import { StackWall } from "@/components/marketing/stack-wall";
import { Reveal } from "@/components/marketing/motion-bits";
import { ThemedArt } from "@/components/marketing/themed-art";
import { paletteVars } from "@/lib/palette";
import type { Scene } from "@/lib/scenery";
import { GITHUB_URL } from "@/lib/brand";
import { FAQ } from "@/lib/faq";
import { cn } from "@/lib/utils";

/**
 * The public page.
 *
 * It is selling something unusual, and the shape of the page follows from that:
 * a free, local, open-source tool has no trial to start and no seat to buy, so
 * there is nothing to persuade anyone to risk. What there is instead is a
 * question of belief — that software on your own laptop can read your screen,
 * your mail and your agents' output and be worth trusting with it.
 *
 * So every section is built to be checked rather than admired. The product shot
 * is the real interface. Each capability is shown as the slice of UI that makes
 * its claim falsifiable. Every number names where it came from and how small the
 * sample was. The privacy section makes claims about code rather than intent,
 * and the comparison table concedes the cases where the alternative is better.
 *
 * The two doors are deliberate and they never change: open your own folder in a
 * browser tab with nothing installed, or download the thing. Both appear in the
 * hero, in the middle, on the sticky bar, and at the end.
 */

export function Landing({
  scene,
  logos,
  siteMode,
}: {
  scene: Scene;
  logos: string[];
  siteMode: boolean;
}) {
  /*
   * The primary door.
   *
   * On the public site there is no app to open — every filesystem route is off,
   * and sending someone to a dead /vault would be the worst possible first
   * click. /web opens the reader's own folder in their own browser, which
   * answers "does this work on MY notes" rather than "what does it look like".
   */
  const cta = siteMode ? "/web" : "/vault";
  const ctaLabel = siteMode ? "Open your wiki — no install" : "Link your wiki";

  return (
    <>
      <MarketingHeader overHero />
      <Hero scene={scene} cta={cta} ctaLabel={ctaLabel} />

      {/* The product shot bridges the hero and the first content section:
          pulled up so its top overlaps the faded sky and its body extends into
          the page, like a hero shot crossing the seam.

          The overlap is much smaller on a phone. At 390px the headline wraps to
          two lines and the subhead to six, which pushed the trust line down far
          enough that a 26vh pull covered it — the card was sitting on top of
          "Free forever · Open source · No account". */}
      <div className="relative z-20 -mt-[8vh] px-4 sm:-mt-[18vh] md:-mt-[30vh] md:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <HeroSimulator />
          <p className="t-meta mt-3 text-center text-[var(--lore-text-tertiary)]">
            The actual interface, with invented content. Click anything — every screen in the
            sidebar is real.
          </p>
        </div>
      </div>

      <CompatBar logos={logos} />
      <WhatYouGet />
      <BeforeAfter />
      <MachineSection />
      <Measured />
      <Privacy />
      <Compare />
      <Steps siteMode={siteMode} cta={cta} ctaLabel={ctaLabel} />
      <Faq />
      <Finale scene={scene} cta={cta} ctaLabel={ctaLabel} />
      <MarketingFooter />
      <StickyCta cta={cta} ctaLabel={siteMode ? "Open your wiki" : "Link your wiki"} />
    </>
  );
}

// --------------------------------------------------------------------- hero

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
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,30,22,0.3)_0%,rgba(12,30,22,0.12)_30%,rgba(12,30,22,0)_60%)] dark:bg-[linear-gradient(180deg,rgba(0,0,0,0.44)_0%,rgba(0,0,0,0.2)_30%,rgba(0,0,0,0)_60%)]" />

        {/* Bottom fade melts the art into the page background. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
          style={{ backgroundImage: "var(--scenery-fade-down)" }}
        />

        <div className="relative z-10 flex flex-1 flex-col px-6 py-5 md:px-10 md:py-7">
          <div className="flex flex-1 items-start justify-center pt-[13vh] text-center md:pt-[12vh]">
            <div className="w-full max-w-4xl">
              {/*
                * The badge is the only thing above the headline.
                *
                * It is doing one job: telling somebody who saw this page six
                * months ago that it is now a different product. Seven local
                * observers is the news, and it is not visible in a headline
                * that has to stay one line long.
                */}
              <Link
                href="#machine"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 py-1 pl-1 pr-3 text-[13px] font-medium text-white backdrop-blur-[2px] transition-colors hover:border-white/45 hover:bg-white/15"
              >
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em] text-[#12356f]">
                  New
                </span>
                Seven observers that read this machine
                <ArrowRight size={13} />
              </Link>

              {/*
                * One line, one sentence, one button row.
                *
                * The old headline — "know what your agents wrote" — described
                * one screen out of seventeen, and described it abstractly. This
                * one names the thing you do with it.
                */}
              <h1 className="t-hero mt-5 text-balance text-white">Ask your own machine anything.</h1>

              {/* Shorter on a phone. The full sentence names three corpora and
                  two guarantees, which is six lines at 390px — long enough that
                  the buttons fall below the fold on the screen size where the
                  fold matters most. */}
              <p className="mx-auto mt-5 max-w-2xl text-[16px] font-medium leading-relaxed text-white/90 md:mt-6 md:text-[19px]">
                <span className="sm:hidden">
                  What your agents wrote, what was on your screen, every AI session you have had —
                  one search box, on your laptop.
                </span>
                <span className="hidden sm:inline">
                  Lore indexes the markdown your agents write, the files and mail on your disk, and
                  every AI session you have ever had — then answers from all of it. On your laptop.
                  Nothing is uploaded.
                </span>
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={cta}
                  className="group inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white pl-5 pr-4 text-[15.5px] font-semibold text-[#12356f] shadow-[0_10px_30px_-12px_rgba(10,26,52,0.6)] transition-colors hover:bg-[#eef2fb]"
                >
                  <span className="leading-none">{ctaLabel}</span>
                  <ArrowRight
                    size={16}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>

                <DownloadButton />
              </div>

              {/* The four claims that remove the reasons not to click. Each one
                  is checkable, which is why they are worth the line. */}
              <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-white/75">
                {["Free forever", "Open source", "No account", "Read-only by default"].map(
                  (claim) => (
                    <li key={claim} className="flex items-center gap-1.5">
                      <Check size={13} className="text-white/60" />
                      {claim}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Names the reader's own operating system on the button.
 *
 * "Download" is a decision; "Download for macOS" is a click. Rendered neutral
 * on the server and specialised after mount, so the markup never disagrees with
 * itself and a reader with JavaScript off still gets a working link.
 */
function DownloadButton() {
  const [os, setOs] = useState<string | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) setOs("macOS");
    else if (/Win/i.test(ua)) setOs("Windows");
    else if (/Linux|X11/i.test(ua)) setOs("Linux");
  }, []);

  return (
    <Link
      href="/download"
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/35 px-4 text-[15px] font-medium text-white backdrop-blur-[2px] transition-colors hover:border-white/60 hover:bg-white/10"
    >
      <DownloadIcon size={15} />
      <span className="leading-none">{os ? `Download for ${os}` : "Download the app"}</span>
    </Link>
  );
}

/**
 * A bar that follows the reader once the hero's buttons are gone.
 *
 * Nine screens of page separate the hero from the closing call to action, and
 * the decision to try something free is usually made in the middle of the
 * argument rather than at the end of it.
 */
function StickyCta({ cta, ctaLabel }: { cta: string; ctaLabel: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const past = window.scrollY > window.innerHeight * 1.6;
      /* Hidden again over the closing panel, which has the same two buttons
         forty pixels away — two identical calls to action on one screen reads
         as desperation. */
      const nearFoot =
        window.scrollY + window.innerHeight > document.documentElement.scrollHeight - 1100;
      setShow(past && !nearFoot);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!show}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 transition-transform duration-300",
        show ? "translate-y-0" : "translate-y-full",
      )}
    >
      <div className="mx-auto max-w-6xl px-4 pb-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]/95 px-4 py-3 shadow-[0_16px_44px_-20px_rgba(15,23,42,0.5)] backdrop-blur">
          <p className="min-w-0 flex-1 text-[13.5px] text-[var(--lore-text-secondary)]">
            <span className="font-semibold text-[var(--lore-text-primary)]">
              Point it at a folder.
            </span>{" "}
            <span className="hidden sm:inline">
              No account, no upload, nothing to uninstall but a folder in your home directory.
            </span>
          </p>
          <Link
            href="/download"
            tabIndex={show ? 0 : -1}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            <DownloadIcon size={14} />
            Download
          </Link>
          <Link
            href={cta}
            tabIndex={show ? 0 : -1}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
          >
            {ctaLabel}
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- compat bar

/**
 * The compatibility wall, moved directly under the product shot.
 *
 * It used to sit two thirds of the way down, which is after the point where
 * somebody decides whether this is for them. "Does it work with the tool I
 * already use" is a qualifying question, and a qualifying question belongs
 * before the argument rather than after it.
 */
function CompatBar({ logos }: { logos: string[] }) {
  return (
    <section className="border-b border-[var(--lore-border)] bg-[var(--lore-background)] pb-14 pt-16 md:pb-16 md:pt-20">
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        <p className="text-center text-[14px] text-[var(--lore-text-secondary)]">
          Nothing to install in your agent. Lore reads the folder the tools you already run are
          writing to.
        </p>
        <StackWall logos={logos} className="mt-8" />
        <p className="t-meta mt-6 text-center text-[var(--lore-text-tertiary)]">
          Twelve tools over MCP for the clients that speak it, a plain{" "}
          <code>AGENTS.md</code> for the ones that only open files, and a watcher that covers
          whatever else you run.
        </p>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- what you get

const GETS = [
  {
    slot: 0,
    question: "What did my agents change while I was not looking?",
    answer:
      "One screen, however much moved. The brief reads everything your agents touched since you last looked and says what is true now — one line per page, whether that is three this week or three hundred.",
    card: <BriefCard />,
  },
  {
    slot: 3,
    question: "What did we actually decide about this?",
    answer:
      "Ask in plain language and get an answer built from your own pages, every source named. When your wiki does not know, it says so instead of inventing something — which is the entire reason to trust the times it does answer.",
    card: <AskCard />,
  },
  {
    slot: 6,
    question: "What should I write next?",
    answer:
      "Your agents read the wiki through Lore, so every search that came back empty is logged. That list is a to-write queue assembled from real demand rather than from a feeling that the notes are untidy.",
    card: <GapsCard />,
  },
  {
    slot: 1,
    question: "Who wrote that, and when?",
    answer:
      "Every write lands in a journal — Claude Code, Cursor, Codex, a sync script, you at midnight. Nothing has to opt in, so nothing can quietly opt out, and no agent has to be configured to be seen.",
    card: <WatchCard />,
  },
];

function WhatYouGet() {
  return (
    <Section
      eyebrow="What you get"
      title="Four questions your setup cannot answer today."
      lede="Your AI can already read your folder. You cannot — not fourteen hundred files of it. These are the four things that fall out of building the reading half."
    >
      <div className="mt-12 space-y-4">
        {GETS.map((item, i) => (
          <Reveal key={item.question} delay={Math.min(i, 3) * 0.05}>
            <div style={paletteVars(item.slot)} className="frame">
              <div
                className={cn(
                  "grid min-w-0 items-center gap-8 px-6 py-8 sm:px-8 lg:gap-12",
                  i % 2 === 0
                    ? "lg:grid-cols-[1fr_24rem]"
                    : "lg:grid-cols-[24rem_1fr]",
                )}
              >
                <div className={cn("min-w-0", i % 2 === 1 && "lg:order-2")}>
                  <span
                    className="t-meta font-semibold uppercase tracking-[0.08em]"
                    style={{ color: "var(--plate-ink)" }}
                  >
                    0{i + 1}
                  </span>
                  <h3 className="t-step mt-2 text-[var(--lore-text-primary)]">{item.question}</h3>
                  <p className="t-body mt-3 max-w-xl text-[var(--lore-text-secondary)]">
                    {item.answer}
                  </p>
                </div>
                <div className={cn("min-w-0", i % 2 === 1 ? "lg:order-1" : "lg:justify-self-end")}>
                  {item.card}
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------- before/after

const TODAY = [
  "Your agents rewrote nine pages last week and told you about none of them.",
  "The answer you need is in a Claude Code session you closed on Tuesday.",
  "Four searches asked your wiki for the same missing page. Nobody counted.",
  "You know you read the renewal terms. You do not know where.",
  "“What was that error” means scrolling back through a terminal that has since been cleared.",
  "Every page in the folder looks equally true, whether it was confirmed or guessed.",
];

const WITH = [
  "One screen says what moved, who moved it and what it removed.",
  "Every session from every tool, in one search box, on your disk.",
  "The empty searches are a ranked list of what to write next.",
  "Mail, files, messages and browsing, indexed together and answered together.",
  "A picture of your screen every few seconds, read back to you in a sentence.",
  "The record of what a human actually checked, kept beside the pages.",
];

function BeforeAfter() {
  return (
    <Section
      eyebrow="The gap"
      title="Your tools write all day. Nothing reads it back."
      lede="Not a workflow problem. There is simply no software on your machine whose job is to be the reader — so the writing accumulates and the knowing does not."
    >
      <div className="mt-11 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-6">
          <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
            Today
          </p>
          <ul className="mt-4 space-y-3">
            {TODAY.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Minus size={14} className="mt-1 shrink-0 text-[var(--lore-text-tertiary)]" />
                <span className="t-body text-[var(--lore-text-secondary)]">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div
          style={paletteVars(0)}
          className="rounded-2xl border-2 border-[var(--plate)] bg-[var(--plate-tint)] p-6"
        >
          <p
            className="t-meta font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--plate-ink)" }}
          >
            With Lore
          </p>
          <ul className="mt-4 space-y-3">
            {WITH.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Check size={14} className="mt-1 shrink-0" style={{ color: "var(--plate-ink)" }} />
                <span className="t-body text-[var(--lore-text-primary)]">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------- measured

/**
 * Numbers from the vault this was built against, not from a pitch deck.
 *
 * Every one of them names its sample size, and the retrieval figure is the
 * repo's own — a landing page that quotes a better number than the benchmark
 * in its README is worse than one with no benchmark at all.
 */
function Measured() {
  return (
    <Section
      eyebrow="Measured, not claimed"
      title="Four numbers, and where each one came from."
      lede="Measured on one real agent-written vault. Yours is a different size — the ratio is what carries over, and the harness ships in the repo so you can run it on your own folder."
    >
      <Reveal className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          slot={0}
          value="303"
          unit="pages"
          label="changed in one week"
          body="Against two git commits in the same week. Most of what your agents write happens between commits, which is precisely where git cannot see it."
        />
        <Stat
          slot={1}
          value="80%"
          unit="in the top 5"
          label="vs 50% for ripgrep"
          body="Take a question generated from a real page and check whether that page comes back in the top five. Twenty questions, one vault — small, and scripts/eval-retrieval.mjs is in the repo."
        />
        {/*
          * The README's number, not a rounder one.
          *
          * This slot briefly read "0.8s to scan 1,412 markdown files", which was
          * invented — 1,412 is the page count in the product shot's fixture data,
          * and nobody ever timed a cold scan. The figure below is in README.md
          * beside the machine it was measured on, which means somebody can go and
          * disagree with it.
          */}
        <Stat
          slot={2}
          value="2,090"
          unit="sessions"
          label="indexed in about a minute"
          body="Every Claude Code, Codex and Cursor conversation on the machine this was built on — 55,000 messages — read off disk and made searchable, locally, on first run."
        />
        <Stat
          slot={6}
          value="0"
          unit="files"
          label="Lore writes to your wiki"
          body="Read-only by default, refused at the route boundary. In the browser the folder is opened read-only by the browser itself, so a write fails below our code."
        />
      </Reveal>
    </Section>
  );
}

// ------------------------------------------------------------------ privacy

const GUARANTEES = [
  {
    icon: ServerOff,
    slot: 2,
    title: "There is no server to send anything to",
    body: "The free build has no backend. Not one you are trusted not to abuse — one that does not exist. Pull the plug on your network and everything except Chorus still works.",
  },
  {
    icon: Lock,
    slot: 0,
    title: "Read-only is enforced, not promised",
    body: "The lock refuses every write route at the boundary before our code runs. In the browser the folder handle is opened read-only, so the refusal happens in the browser rather than in Lore.",
  },
  {
    icon: EyeOff,
    slot: 3,
    title: "Every observer is off until you switch it on",
    body: "Seven separate decisions, each with its own switch, its own list of what it reads, and its own delete button. Pausing survives a restart. One master switch stops all seven.",
  },
  {
    icon: Wallet,
    slot: 6,
    title: "One feature leaves the machine, and it says so",
    body: "Chorus posts your question to the providers you gave keys to, because asking several companies' models is the whole point of it. It is the only one, and it carries the warning on its own screen.",
  },
];

function Privacy() {
  return (
    <section className="border-y border-[var(--lore-border)] bg-[var(--lore-surface)]">
      <div className="mx-auto max-w-5xl px-6 py-20 md:px-8 md:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_20rem] lg:gap-14">
          <div className="min-w-0">
            <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
              The obvious worry
            </p>
            <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">
              You are about to let software read your screen.
            </h2>
            <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
              That should worry you. Here is what makes it a different proposition from the cloud
              version of the same idea — four things about the code rather than four things about
              our intentions.
            </p>
          </div>
          <ThemedArt
            src="/marketing/stays-local"
            alt=""
            width={1400}
            height={1045}
            className="hidden lg:block"
          />
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {GUARANTEES.map((item, i) => {
            const Icon = item.icon;
            return (
              <Reveal key={item.title} delay={Math.min(i, 3) * 0.05}>
                <div
                  style={paletteVars(item.slot)}
                  className="h-full rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-background)] p-6"
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                    style={{ background: "var(--plate)" }}
                  >
                    <Icon size={17} />
                  </span>
                  <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
                    {item.title}
                  </h3>
                  <p className="t-body mt-2 text-[var(--lore-text-secondary)]">{item.body}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <p className="t-body mt-8 max-w-2xl text-[var(--lore-text-secondary)]">
          All of it is checkable — the source is public, and the four claims above are four files
          you can read before you trust any of them.{" "}
          <Link
            href="/privacy"
            className="inline-flex items-center gap-1 font-medium text-[var(--lore-accent)] hover:text-[var(--lore-accent-hover)]"
          >
            What Lore stores, in detail
            <ArrowUpRight size={13} />
          </Link>
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ compare

const COMPARE: { row: string; git: string; search: string; ai: string; lore: string }[] = [
  {
    row: "Sees what your agent changed between commits",
    git: "no",
    search: "no",
    ai: "no",
    lore: "yes",
  },
  {
    row: "Tells you what a change means, not which lines moved",
    git: "no",
    search: "no",
    ai: "part",
    lore: "yes",
  },
  {
    row: "Knows which searches came back empty",
    git: "no",
    search: "no",
    ai: "no",
    lore: "yes",
  },
  {
    row: "Reads mail, messages and your screen too",
    git: "no",
    search: "no",
    ai: "no",
    lore: "yes",
  },
  {
    row: "Finds a session you had three weeks ago in another tool",
    git: "no",
    search: "no",
    ai: "part",
    lore: "yes",
  },
  { row: "Runs with no network at all", git: "yes", search: "yes", ai: "no", lore: "yes" },
  { row: "Restores a file you deleted by mistake", git: "yes", search: "no", ai: "no", lore: "no" },
  { row: "Costs nothing", git: "yes", search: "part", ai: "part", lore: "yes" },
];

function Compare() {
  return (
    <Section
      eyebrow="Honestly"
      title="Where this beats what you have, and where it does not."
      lede="Keep using git. Keep using your editor's search. Lore is not a replacement for either — it is the thing neither of them was built to be."
    >
      <div className="mt-11 overflow-hidden rounded-xl border border-[var(--lore-border)]">
        <div className="lore-scrollbar overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">
              What Lore does compared with git, editor search and asking your AI directly
            </caption>
            <thead>
              <tr className="bg-[var(--lore-surface)]">
                <th scope="col" className="px-4 py-3 text-[12.5px] font-semibold text-[var(--lore-text-primary)]">
                  &nbsp;
                </th>
                {[
                  ["git log", "git"],
                  ["Editor search", "search"],
                  ["Asking your AI", "ai"],
                  ["Lore", "lore"],
                ].map(([label, key]) => (
                  <th
                    key={key}
                    scope="col"
                    className={cn(
                      "px-3 py-3 text-center text-[12.5px] font-semibold",
                      key === "lore"
                        ? "bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
                        : "text-[var(--lore-text-secondary)]",
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.row} className="border-t border-[var(--lore-border)]">
                  <th
                    scope="row"
                    className="px-4 py-2.5 text-[13px] font-normal text-[var(--lore-text-primary)]"
                  >
                    {row.row}
                  </th>
                  {(["git", "search", "ai", "lore"] as const).map((key) => (
                    <td
                      key={key}
                      className={cn(
                        "px-3 py-2.5 text-center",
                        key === "lore" && "bg-[var(--lore-accent-tint)]/40",
                      )}
                    >
                      <Verdict value={row[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
        The last two rows are the ones worth reading. Lore has no version history of its own and
        cannot get a deleted file back — that is what git is for, and Lore reads a repo happily.
      </p>
    </Section>
  );
}

function Verdict({ value }: { value: string }) {
  const label = value === "yes" ? "yes" : value === "part" ? "partly" : "no";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full",
        value === "yes" && "bg-[var(--lore-success)]/15 text-[var(--lore-success)]",
        value === "part" && "bg-[var(--pal-7-tint)] text-[var(--pal-7-ink)]",
        value === "no" && "bg-[var(--lore-surface-raised)] text-[var(--lore-text-tertiary)]",
      )}
    >
      {value === "yes" ? <Check size={12} /> : value === "part" ? <Sparkles size={11} /> : <Minus size={12} />}
    </span>
  );
}

// -------------------------------------------------------------------- steps

function Steps({
  siteMode,
  cta,
  ctaLabel,
}: {
  siteMode: boolean;
  cta: string;
  ctaLabel: string;
}) {
  const steps = [
    siteMode
      ? {
          n: "1",
          slot: 0,
          title: "Get it onto your machine",
          body: "One command, or download the desktop build. Node 20 and nothing else — no account, no database, no key.",
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
      body: "It is the screen that opens. Eight sentences on what your agents wrote, or `lore brief` in the terminal you are already in.",
    },
  ];

  return (
    <Section
      eyebrow="Get started"
      title="Under two minutes, and there is nothing to sign up for."
      lede="The free build has no account step because it has no server behind it. You point it at a folder and it starts reading."
    >
      <div className="mt-11 grid gap-10 lg:grid-cols-[1fr_26rem] lg:items-start lg:gap-14">
        <div className="grid gap-6 sm:grid-cols-2">
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

        <div className="min-w-0">
          <TerminalCard />
          <InstallLine />
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={cta}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--lore-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
            >
              {ctaLabel}
              <ArrowRight size={15} />
            </Link>
            <Link
              href="/download"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--lore-border)] px-4 text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              <DownloadIcon size={14} />
              Download
            </Link>
          </div>
        </div>
      </div>
    </Section>
  );
}

/**
 * The one command, with a button so nobody has to select it by hand.
 *
 * It has to be a command that works. This said `npx lore link ~/Documents/wiki`
 * — a verb the CLI does not have, on a package name that belongs to someone
 * else — which would have sent every developer who trusted the copy button
 * straight into an error.
 */
function InstallLine() {
  const [copied, setCopied] = useState(false);
  const command = `git clone ${GITHUB_URL} && cd lore && npm i && npm run dev`;

  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3 py-2.5">
      <code
        className="min-w-0 flex-1 truncate text-[13px] text-[var(--lore-text-primary)]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {command}
      </code>
      <button
        type="button"
        aria-label="Copy the install command"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => {},
          );
        }}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--lore-border)] px-2 text-[12px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------- faq

/*
 * Ordered by what people actually ask when they first see this, which is not
 * the order the product finds interesting. The first four are the objections
 * two readers raised unprompted; the rest are the mechanics.
 */
// (moved to lib/faq.ts so the server can render it as JSON-LD too)

function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section eyebrow="Questions" title="Straight answers, including the unflattering ones.">
      <div className="mt-10 divide-y divide-[var(--lore-border)] border-y border-[var(--lore-border)]">
        {FAQ.map((item, i) => (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
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

      <p className="t-body mt-8 text-[var(--lore-text-secondary)]">
        Still deciding?{" "}
        <Link
          href="/web"
          className="inline-flex items-center gap-1 font-medium text-[var(--lore-accent)] hover:text-[var(--lore-accent-hover)]"
        >
          Open your own folder in a browser tab
          <ArrowUpRight size={13} />
        </Link>{" "}
        — nothing installed, nothing uploaded, and you will know inside a minute whether the
        reading half is worth having.
      </p>
    </Section>
  );
}

// ------------------------------------------------------------------- finale

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

        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "var(--scenery-fade-band)" }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-1/4 h-1/2 bg-[radial-gradient(ellipse_at_center,rgba(10,26,52,0.45)_0%,rgba(10,26,52,0.24)_45%,rgba(10,26,52,0)_75%)]" />

        <div className="relative flex min-h-[62svh] flex-col items-center justify-center px-6 text-center">
          <h2 className="t-section max-w-2xl text-white [text-shadow:0_1px_18px_rgba(10,26,52,0.35)]">
            Everything you know,
            <br />
            and which of it you checked.
          </h2>
          <p className="t-lede mt-4 max-w-lg font-medium text-white/90">
            Your agents will keep writing and your machine will keep seeing. Nobody was recording
            this part.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={cta}
              className="group inline-flex h-11 items-center gap-2 rounded-lg bg-white pl-5 pr-4 text-[15px] font-semibold text-[#12356f] transition-colors hover:bg-[#eef2fb]"
            >
              {ctaLabel}
              <ArrowRight
                size={16}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/download"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/35 px-4 text-[15px] font-medium text-white backdrop-blur-[2px] transition-colors hover:border-white/60 hover:bg-white/10"
            >
              <DownloadIcon size={15} />
              Download the app
            </Link>
          </div>
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <Check size={13} /> Free forever
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={13} /> No account
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Plug size={13} /> Works with what you already run
            </span>
          </p>
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
    <section className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
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
