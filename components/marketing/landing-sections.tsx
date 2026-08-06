"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  FileCode2,
  FlaskConical,
  GitBranch,
  Minus,
  Scale,
  Terminal,
  WifiOff,
} from "lucide-react";
import { Reveal } from "@/components/marketing/motion-bits";
import { ThemedArt } from "@/components/marketing/themed-art";
import { GITHUB_URL } from "@/lib/brand";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The three sections the page was missing.
 *
 * Each answers a question a reader asks silently and leaves if nobody answers:
 * is this for someone like me, what would I actually do with it on a Tuesday,
 * and why should I believe a tool with no users yet.
 *
 * The third is the hard one. A brand-new open-source project has no social
 * proof and cannot invent any — no logos, no testimonials, no "trusted by",
 * no star count worth printing. What it has instead is verifiability, which
 * for this audience converts better than a wall of borrowed logos anyway: the
 * source is public, the benchmark harness is in the repo, the test suite is a
 * number you can reproduce, and the things it does not do are listed by name.
 */

// ------------------------------------------------------------------ for you

const FOR = [
  "Your AI tools write markdown into a folder — Claude Code, Codex, Cursor, or anything writing into an Obsidian vault.",
  "You have more notes than you can read, and no idea which of them changed this week.",
  "You keep losing things you know you worked out: in a closed session, an old thread, a window you shut.",
  "You would rather your files stayed on your disk than went to somebody's server to be indexed.",
];

const NOT_FOR = [
  "You want a note-taking app. Lore reads a folder; it is not where you would write.",
  "Nothing on your machine writes files for you. The wiki half then has nothing to describe.",
  "You need this on a phone or a Chromebook with no desktop behind it — six of the seven observers need a real computer.",
  "You want your team's notes in one shared place. There is no server, so there is nothing to share through.",
];

export function ForYou() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
      <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
        Before you download anything
      </p>
      <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">
        This is not for everyone. Here is how to tell.
      </h2>
      <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
        Two people in a blind review scored this 2.5 and left inside three screens — not
        because it was broken, but because nothing told them it was not built for them. That
        is a bad outcome for both sides, so the right-hand column is as honest as the left.
      </p>

      <div className="mt-11 grid gap-4 lg:grid-cols-2">
        <div
          style={paletteVars(3)}
          className="rounded-2xl border-2 border-[var(--plate)] bg-[var(--plate-tint)] p-6"
        >
          <p
            className="t-meta font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--plate-ink)" }}
          >
            Worth your time if
          </p>
          <ul className="mt-4 space-y-3">
            {FOR.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Check size={15} className="mt-0.5 shrink-0" style={{ color: "var(--plate-ink)" }} />
                <span className="t-body text-[var(--lore-text-primary)]">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-6">
          <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
            Skip it if
          </p>
          <ul className="mt-4 space-y-3">
            {NOT_FOR.map((line) => (
              <li key={line} className="flex gap-2.5">
                <Minus size={15} className="mt-0.5 shrink-0 text-[var(--lore-text-tertiary)]" />
                <span className="t-body text-[var(--lore-text-secondary)]">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- use cases

const DAYS: { slot: number; when: string; title: string; body: string }[] = [
  {
    slot: 0,
    when: "Monday, 9am",
    title: "You open the laptop after a weekend of agents working",
    body: "The brief is the screen that opens. Forty-one pages changed; four of them changed something you relied on, and it names which — the deploy rule, the billing date, the onboarding order. Forty seconds, and you know what is true now.",
  },
  {
    slot: 2,
    when: "Tuesday, 2pm",
    title: "Something breaks and you cannot remember what you changed",
    body: "Ask Ghost what the error twenty minutes ago was. It has a picture of the console, the file you had just edited, and the Stack Overflow page you opened three minutes later — read back to you as one sentence.",
  },
  {
    slot: 3,
    when: "Wednesday, 4pm",
    title: "A client asks what you agreed about the renewal",
    body: "Oracle answers from the email, the PDF, the message thread and the note you took on the call — and points out that the notice period was promised in writing and never delivered. One question, five sources, none of them uploaded.",
  },
  {
    slot: 6,
    when: "Friday, 5pm",
    title: "You want to know what the wiki is missing",
    body: "Because your agents read it through Lore, every search that came back empty was logged. Four asks for a reseller discount you have never written down. That is Monday's writing, chosen for you by demand rather than by guilt.",
  },
];

export function UseCases() {
  return (
    <section id="week" className="border-y border-[var(--lore-border)] bg-[var(--lore-surface)]">
      <div className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_20rem] lg:gap-14">
          <div className="min-w-0">
            <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
              A week with it
            </p>
            <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">
              What you would actually use it for.
            </h2>
            <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
              Not features — four moments. Every one of them is a thing that happens to you
              already, and a thing nothing currently on your machine handles.
            </p>
          </div>
          <ThemedArt
            src="/marketing/many-writers"
            alt=""
            width={1400}
            height={939}
            className="hidden lg:block"
          />
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {DAYS.map((day, i) => (
            <Reveal key={day.when} delay={Math.min(i, 3) * 0.05}>
              <div
                style={paletteVars(day.slot)}
                className="h-full rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-background)] p-6"
              >
                <div className="flex items-center gap-2.5">
                  <span className="pal-bar !h-5" />
                  <span
                    className="t-meta font-semibold uppercase tracking-[0.08em]"
                    style={{ color: "var(--plate-ink)" }}
                  >
                    {day.when}
                  </span>
                </div>
                <h3 className="mt-3 text-[16px] font-semibold leading-snug tracking-[-0.02em] text-[var(--lore-text-primary)]">
                  {day.title}
                </h3>
                <p className="t-body mt-2 text-[var(--lore-text-secondary)]">{day.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------- open source

const PROOF: { icon: typeof GitBranch; label: string; value: string; note: string }[] = [
  {
    icon: FileCode2,
    label: "Every line is public",
    value: "MIT",
    note: "Read it, fork it, sell it. There is no licence that turns hostile at a headcount.",
  },
  {
    icon: FlaskConical,
    label: "Tests you can run yourself",
    value: "325",
    note: "Assertions across fourteen files, including the parsers for Apple's epochs and every claim this page makes about the code.",
  },
  {
    icon: Scale,
    label: "The benchmark ships with it",
    value: "eval-retrieval",
    note: "The 80%-against-50% figure is one script in the repo. Point it at your own folder and get your own number.",
  },
  {
    icon: WifiOff,
    label: "No telemetry, no account",
    value: "0",
    note: "No sign-up, no analytics, no crash reporter. Pull the network cable and everything except Chorus still works.",
  },
];

export function OpenSource() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
      <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
        Why trust it
      </p>
      <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">
        Nobody famous uses this yet. Check it yourself instead.
      </h2>
      <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
        There are no customer logos on this page and no testimonials, because there would be
        nothing behind them. What there is instead is everything you would need to disagree
        with us.
      </p>

      <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PROOF.map((item, i) => {
          const Icon = item.icon;
          return (
            <Reveal key={item.label} delay={Math.min(i, 3) * 0.05}>
              <div
                style={paletteVars(i * 2)}
                className="h-full rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                  style={{ background: "var(--plate)" }}
                >
                  <Icon size={16} />
                </span>
                <div className="mt-4 text-[22px] font-bold leading-none tracking-[-0.03em] text-[var(--lore-text-primary)]">
                  {item.value}
                </div>
                <p className="mt-2 text-[13.5px] font-semibold text-[var(--lore-text-primary)]">
                  {item.label}
                </p>
                <p className="t-meta mt-1.5 leading-relaxed text-[var(--lore-text-tertiary)]">
                  {item.note}
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/*
        * The price, stated plainly on the page rather than behind a nav link.
        *
        * "What is the catch" is the question a free tool has to answer before
        * anybody installs it, and sending someone to /pricing to find out is
        * one click too many at exactly the wrong moment.
        */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-6 py-5">
        <p className="t-body min-w-0 flex-1 text-[var(--lore-text-secondary)]">
          <span className="font-semibold text-[var(--lore-text-primary)]">
            The download is the whole application.
          </span>{" "}
          Nothing is held back for a paid tier. Paid plans exist for syncing between machines,
          which is the one thing a program on one laptop cannot do for itself.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--lore-border)] px-4 text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            <Terminal size={14} />
            Read the source
            <ArrowUpRight size={13} />
          </a>
          <Link
            href="/pricing"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--lore-border)] px-4 text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            Pricing
          </Link>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- section nav

const ANCHORS = [
  { id: "what", label: "What you get" },
  { id: "machine", label: "This machine" },
  { id: "week", label: "A week with it" },
  { id: "trust", label: "Privacy" },
  { id: "compare", label: "Compare" },
  { id: "start", label: "Get started" },
  { id: "faq", label: "FAQ" },
];

/**
 * A jump bar that appears once the hero is gone.
 *
 * The page is nine screens long. Somebody who arrived wanting to know one
 * thing — does it read my mail, is it really free — should not have to scroll
 * past six arguments to find out, and a reader who cannot navigate a long page
 * treats its length as a reason to leave rather than as a reason to stay.
 */
export function SectionNav() {
  return (
    <nav
      aria-label="Jump to a section"
      className="sticky top-14 z-30 hidden border-b border-[var(--lore-border)] bg-[var(--lore-background)]/85 backdrop-blur-md lg:block"
    >
      <div className="lore-scrollbar mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 py-2 md:px-8">
        {ANCHORS.map((anchor) => (
          <a
            key={anchor.id}
            href={`#${anchor.id}`}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors",
              "hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
            )}
          >
            {anchor.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
