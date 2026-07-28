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
  Apple,
  Monitor,
  Terminal,
  Smartphone,
} from "lucide-react";
import { SceneryImage } from "@/components/marketing/scenery-image";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { HeroSimulator } from "@/components/marketing/hero-simulator";
import {
  WriteFeedDemo,
  SignOffDemo,
  GapsDemo,
  BudgetDemo,
  TrustPill,
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
  const cta = siteMode ? "/install" : "/vault";
  const ctaLabel = siteMode ? "Get Lore" : "Link your wiki";
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

      <Measured />
      <Gate />
      <HowItWorks />
      <States />
      <Budget />
      <Stack logos={logos} />
      <Platforms />
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
            <div className="w-full max-w-3xl">
              {/* The two-line lockup is held on tablet and up; below that the
                  clamp alone isn't enough to keep the second line intact at
                  375px, so it is allowed to wrap rather than overflow. */}
              <h1 className="t-hero text-white">
                <span className="block">Your agents are already</span>
                <span className="block md:whitespace-nowrap">writing to your wiki</span>
              </h1>

              <p className="mx-auto mt-5 max-w-xl text-[15px] font-semibold text-white/90 md:mt-6 md:text-[18px]">
                Lore keeps the record of which of it a human has actually checked.
              </p>

              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={cta}
                  className="group inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white pl-4 pr-3 text-[14px] font-medium text-[#12356f] transition-colors hover:bg-[#eef2fb]"
                >
                  <span className="leading-none">{ctaLabel}</span>
                  <ArrowRight
                    size={16}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>

                {/* Second door. Plenty of people will not try a local app in a
                    browser tab but will install one, and the desktop build was
                    reachable from nowhere on this page. */}
                <Link
                  href="/download"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/35 px-4 text-[14px] font-medium text-white backdrop-blur-[2px] transition-colors hover:border-white/60 hover:bg-white/10"
                >
                  <DownloadIcon size={15} />
                  <span className="leading-none">Download</span>
                </Link>
              </div>

              <p className="mt-4 text-[13px] text-white/70">
                Free and open source. macOS, Windows, Linux — runs on your machine, uploads nothing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Measured() {
  return (
    <Section
      eyebrow="Measured"
      title="303 pages changed in a week."
      lede="That is one vault, seven days, one person's agents doing ordinary work. Not one of those diffs was read by a human, and the wiki has no idea which of them to trust."
    >
      <Reveal className="mt-12 grid gap-4 sm:grid-cols-3">
        <Stat
          slot={0}
          value="303"
          unit="pages"
          label="changed in seven days"
          body="Written by agents, across four folders, while the person who owns the wiki was working on something else."
        />
        <Stat
          slot={1}
          value="60"
          unit="of 75"
          label="modified files rewritten in place"
          body="Rewritten rather than appended to, so the previous wording is gone unless git happened to catch it."
        />
        <Stat
          slot={2}
          value="1,450"
          unit="lines"
          label="of prose deleted unreviewed"
          body="Removed in the same week, without anyone reading what was removed or why it went."
        />
      </Reveal>
    </Section>
  );
}

function Gate() {
  return (
    <Section
      eyebrow="The gate we removed"
      title="A queue of 300 resolves to Accept All."
      lede="Lore shipped with a propose_edit tool that parked agent changes for approval. It is gone. Agents write through their own file tools, so the gate only ever caught the one harness that agreed to ask — and at three hundred changes a week, an approval queue is a Friday afternoon of clicking."
    >
      <Reveal>
        <p className="t-body mt-8 max-w-2xl text-[var(--lore-text-secondary)]">
          There is a second problem underneath the first. Ask a page how reliable it is and
          the agent that wrote it will happily answer, in the page itself.
        </p>
      </Reveal>

      <Reveal className="mt-8 grid gap-4 sm:grid-cols-2">
        <Stat
          slot={6}
          value="1,156"
          unit="pages"
          label="carry an agent-written confidence: field"
          body="959 of them say high. Two say low. It is self-assessment, and self-assessment passes."
        />
        {/* Deliberately not the green plate: zero human sign-offs is the bad
            number in this pair, and a green panel would read as reassurance. */}
        <Stat
          slot={2}
          value="0"
          unit="pages"
          label="carry a human sign-off"
          body="The vault records every machine write and has never once recorded a person confirming one. Every page looks equally true."
        />
      </Reveal>
    </Section>
  );
}

function HowItWorks() {
  const items = [
    {
      icon: Radio,
      slot: 3,
      demo: <WriteFeedDemo />,
      title: "Lore watches the folder, not the agent",
      body: "Every write lands in a journal — Claude Code, Codex, Cursor, a sync script, you in your editor at midnight. Reading the filesystem instead of intercepting a tool call is what makes that possible: no harness has to opt in, so none of them can quietly opt out. What comes back is a ranked list of what changed, how much prose it deleted, and how many pages link to the thing it touched.",
    },
    {
      icon: ShieldCheck,
      slot: 0,
      demo: <SignOffDemo />,
      title: "Sign off on the page you actually read",
      body: "A sign-off is pinned to the content hash of the page as you saw it. Rewrite that page and the hash stops matching, the sign-off lapses on its own, and the page comes back to the top of Review wearing the label that says why. Trust that can never lapse is a sticker, not a signal — and it is the reason the ledger sits outside your vault, where an agent cannot edit its own grade.",
    },
    {
      icon: Plug,
      slot: 6,
      demo: <GapsDemo />,
      title: "Being the MCP server makes Lore a sensor",
      body: "Your agents read the wiki through Lore. That is a poor place to stand if you want to block a write, and an excellent one if you want to hear the questions. Lore logs which pages actually get opened and every search that came back with nothing. The empty ones are a to-write list assembled out of real demand instead of a planning session.",
    },
  ];

  return (
    <Section
      eyebrow="How it works"
      title="Promotion, not permission."
      lede="Nothing is blocked, because nothing local can block it. Everything lands unverified and you promote what you have read."
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

const STATES = [
  {
    slot: 3,
    state: "verified" as const,
    body: "A person confirmed this page against the world, and nothing has touched it since.",
  },
  {
    slot: 6,
    state: "aging" as const,
    body: "Signed off long enough ago that it has earned a second look. Pricing rots faster than tooling does.",
  },
  {
    slot: 2,
    state: "lapsed" as const,
    body: "It was verified, then an agent rewrote it. The hash moved, so the sign-off came off with it.",
  },
  {
    slot: 4,
    state: "unverified" as const,
    body: "Where every page starts, including the ones that read as authoritative because they are well written.",
  },
];

function States() {
  return (
    <Section
      eyebrow="Trust states"
      title="Only one of the four is yours to set."
      lede="You mark a page verified. Everything else follows from the clock and from what your agents do next."
    >
      <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATES.map((card, i) => (
          <Reveal key={card.state} delay={i * 0.05} className="h-full">
            <div style={paletteVars(card.slot)} className="frame h-full">
              <div className="h-full px-5 py-5">
                <TrustPill state={card.state} />
                <p className="t-body mt-3 text-[var(--lore-text-secondary)]">{card.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function Budget() {
  return (
    <Section
      eyebrow="Context"
      title="2.3 million tokens."
      lede="That is the reference vault: 1,424 pages, counted with a real BPE tokenizer rather than characters divided by four. A 200k context window holds about a twelfth of it."
    >
      <div className="mt-11 grid min-w-0 gap-8 lg:grid-cols-[22rem_1fr] lg:items-center">
        <Reveal>
          <BudgetDemo />
        </Reveal>
        <Reveal delay={0.06}>
          <p className="t-body max-w-xl text-[var(--lore-text-secondary)]">
            Nothing will ever read your wiki whole. Every answer an agent gives you is
            assembled out of the handful of pages a search happened to surface, which is
            precisely why it matters whether those pages are still true.
          </p>
          <p className="t-body mt-4 max-w-xl text-[var(--lore-text-secondary)]">
            Lore measures the same budget folder by folder and page by page, so the corner
            of the vault that is too heavy to hand to anything is a number you can look at
            rather than a surprise you hit mid-task.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}

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
            Seven tools over MCP, or a plain <code>AGENTS.md</code> for agents that only
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
function Platforms() {
  const platforms = [
    {
      slot: 0,
      icon: Apple,
      title: "macOS",
      body: "Apple silicon and Intel. The only platform where the folder picker also works straight from a browser tab.",
    },
    {
      slot: 2,
      icon: Monitor,
      title: "Windows",
      body: "The desktop build is how you get a native folder picker here — a browser cannot open one.",
    },
    {
      slot: 4,
      icon: Terminal,
      title: "Linux",
      body: "AppImage or .deb, x64 and arm64. Or skip packaging entirely and run it from source.",
    },
    {
      slot: 6,
      icon: Smartphone,
      title: "Your phone",
      body: "Installable as a PWA and pairable with the machine your wiki is on, over your own network.",
    },
  ];

  return (
    <Section
      eyebrow="Everywhere"
      title="One app, four places."
      lede="The same local server behind all of them. The desktop build is a window onto 127.0.0.1, not a different product with a different backend."
    >
      <Reveal className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {platforms.map((platform) => {
          const Icon = platform.icon;
          return (
            <div
              key={platform.title}
              style={paletteVars(platform.slot)}
              className="rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                style={{ background: "var(--plate)" }}
              >
                <Icon size={17} />
              </span>
              <h3 className="pal-title mt-4 text-[16px] font-semibold tracking-[-0.02em]">
                {platform.title}
              </h3>
              <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">{platform.body}</p>
            </div>
          );
        })}
      </Reveal>

      <Reveal className="mt-8">
        <Link
          href="/download"
          className="group inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--lore-accent)] pl-4 pr-3.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
        >
          Get Lore for your machine
          <ArrowRight
            size={15}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      </Reveal>
    </Section>
  );
}

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
      body: "Copy the config — the path is already filled in — restart your client, and all seven tools are live.",
    },
    {
      n: "4",
      slot: 6,
      title: "Sign off on something",
      body: "Open Review, read the page at the top, press the button. That is the first human mark your wiki has ever carried.",
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

const FAQ = [
  {
    q: "Does Lore stop an agent from writing?",
    a: "No, and it could not. Agents write with their own file tools, and a folder on your disk has a dozen other write paths besides. Lore watches the folder instead: every write is journaled and left exactly where it landed. What it gates is not the edit — it is the claim that a human has checked it.",
  },
  {
    q: "What happens when an agent rewrites a page I signed off on?",
    a: "The sign-off lapses. It was pinned to the content hash of the page as you read it, so a rewrite breaks the match, the page drops to Lapsed, and it comes back to the top of Review with that label on it. Nothing is silently inherited by the new text.",
  },
  {
    q: "Does Lore move or reformat my files?",
    a: "No. It reads the markdown where it sits — your headings, your frontmatter, your [[wikilinks]], your folder names. The verification ledger and the usage log live in ~/.lore, outside the vault, so they never turn up in a git diff of your notes. Lore only writes to the vault when you press something: the AGENTS.md index, a page you create in the sidebar, or an edit you save in Lore's own editor. Nothing is written on its own, and no page is reformatted on the way through.",
  },
  {
    q: "Does it work with my Obsidian vault?",
    a: "Yes — that's the intended case. Lore reads [[wikilinks]], inline #tags and YAML frontmatter, and skips .obsidian and .trash. Keep writing in Obsidian; Lore is the layer that makes the same folder legible to your agents and keeps score of what you have confirmed.",
  },
  {
    q: "What can an agent do through Lore?",
    a: "Four tools: read the index, search, read a page, report health. All four are reads. There is no write tool, not as a safety measure but because withholding one would achieve nothing — the agent already has a filesystem.",
  },
  {
    q: "Is anything uploaded?",
    a: "Nothing. Lore is a local Next.js app talking to your own filesystem. Outside your vault it keeps three things in ~/.lore: the folder path, the ledger of what you have signed off, and an append-only log of what your agents read and searched for.",
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
