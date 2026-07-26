"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, FolderOpen, Plug, ShieldCheck, ChevronDown } from "lucide-react";
import { SceneryImage } from "@/components/marketing/scenery-image";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { HeroSimulator } from "@/components/marketing/hero-simulator";
import { LinkDemo, ReadDemo, ProposeDemo, HealthDemo } from "@/components/marketing/demos";
import { StackWall } from "@/components/marketing/stack-wall";
import { Reveal } from "@/components/marketing/motion-bits";
import { paletteVars } from "@/lib/palette";
import type { Scene } from "@/lib/scenery";
import { cn } from "@/lib/utils";

export function Landing({ scene, logos }: { scene: Scene; logos: string[] }) {
  return (
    <>
      <MarketingHeader />
      <Hero scene={scene} />

      {/* The product shot bridges the hero and the first content section:
          pulled up so its top overlaps the faded sky and its body extends into
          the page, like a hero shot crossing the seam. */}
      <div className="relative z-20 -mt-[28vh] px-4 md:-mt-[32vh] md:px-10 lg:px-12">
        <div className="mx-auto max-w-5xl">
          <HeroSimulator />
        </div>
      </div>

      <Problem />
      <HowItWorks />
      <Trust />
      <Stack logos={logos} />
      <Steps />
      <Faq />
      <Finale scene={scene} />
      <MarketingFooter />
    </>
  );
}

function Hero({ scene }: { scene: Scene }) {
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
                  clamp alone isn't enough to keep "for all your agents" on one
                  line at 375px, so it is allowed to wrap rather than overflow. */}
              <h1 className="t-hero text-white">
                <span className="block">Your wiki,</span>
                <span className="block md:whitespace-nowrap">for all your agents</span>
              </h1>

              <p className="mx-auto mt-5 max-w-xl text-[15px] font-semibold text-white/90 md:mt-6 md:text-[18px]">
                Point it at the markdown folder you already have.
              </p>

              <div className="mt-7 flex justify-center">
                <Link
                  href="/vault"
                  className="group inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white pl-4 pr-3 text-[14px] font-medium text-[#12356f] transition-colors hover:bg-[#eef2fb]"
                >
                  <span className="leading-none">Link your wiki</span>
                  <ArrowRight
                    size={16}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>
              </div>

              <p className="mt-4 text-[13px] text-white/70">
                Runs on your machine. Nothing uploaded, no account.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <Section
      eyebrow="The problem"
      title="You already wrote it down. Your agents still ask."
      lede="Everything an agent needs to stop guessing is sitting in a folder on your disk. It just has no way in — and no way to give anything back."
    >
      <Reveal className="mt-12 grid gap-4 sm:grid-cols-3">
        <Stat
          slot={0}
          value="150"
          unit="+ pages"
          label="where an agent stops coping"
          body="Past roughly a hundred and fifty notes, an index no longer fits in context. The agent stops finding the right page and starts writing a duplicate."
        />
        <Stat
          slot={1}
          value="1"
          unit="of 9"
          label="wiki tools that speak MCP"
          body="Almost every notes app in this space assumes a human at a keyboard. Your agents are locked outside the thing you built for them."
        />
        <Stat
          slot={2}
          value="0"
          unit="clocks"
          label="on anything going stale"
          body="Nothing tells you the pricing page you wrote in March stopped being true in May. The agent quotes it anyway, with total confidence."
        />
      </Reveal>
    </Section>
  );
}

function HowItWorks() {
  const items = [
    {
      icon: FolderOpen,
      slot: 3,
      demo: <LinkDemo />,
      title: "Point it at the folder you already have",
      body: "No import, no migration, no new format. Lore reads the markdown where it sits — your headings, your frontmatter, your [[wikilinks]], your folder names. It infers the structure you already chose instead of imposing one. Delete Lore tomorrow and the wiki is byte-for-byte what it was.",
    },
    {
      icon: Plug,
      slot: 0,
      demo: <ReadDemo />,
      title: "Every agent gets a map of the whole wiki",
      body: "Lore writes one AGENTS.md at your vault root — every page, folder, tag, and a one-line summary — and serves the same map over MCP with search and read. An agent skims the map, opens the two pages that matter, and answers. It never has to read your whole wiki or grep blind.",
    },
    {
      icon: ShieldCheck,
      slot: 6,
      demo: <ProposeDemo />,
      title: "Agents propose. You accept.",
      body: "There is no write tool. When an agent learns something durable it files a proposal, and the diff appears inside the page it would change, with a reason and a risk tier, right where you are already reading. The wiki changes when you say so — because the edit that hurts is never the obviously wrong one, it's the plausible one you'd have missed.",
    },
  ];

  return (
    <Section
      eyebrow="How it works"
      title="Three moving parts."
      lede="Link a folder, hand your agents the map, keep the pen."
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

function Trust() {
  return (
    <Section
      eyebrow="Health"
      title="It tells you where the wiki has rotted."
      lede="Orphaned pages, links pointing at notes you never wrote, and anything past its review window — scored, so you can watch the number move."
    >
      <div className="mt-11 grid min-w-0 gap-8 lg:grid-cols-[22rem_1fr] lg:items-center">
        <Reveal><HealthDemo /></Reveal>
        <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            slot: 0,
            head: "Orphans",
            body: "Pages nothing links to and that link nowhere. An agent walking your links will never reach them.",
          },
          {
            slot: 2,
            head: "Dead links",
            body: "Every [[link]] pointing at a page that doesn't exist yet. Each one is a page you meant to write.",
          },
          {
            slot: 6,
            head: "Staleness clocks",
            body: "Pricing gets 30 days, tooling 90, clients 60, everything else 180. One global threshold catches nothing.",
          },
          {
            slot: 3,
            head: "Untagged",
            body: "Tags are the cheapest way to make a page findable by an agent that doesn't know its title.",
          },
        ].map((card) => (
          <div key={card.head} style={paletteVars(card.slot)} className="frame">
            <div className="h-full px-5 py-5">
              <h3 className="pal-title text-[14.5px] font-semibold">{card.head}</h3>
              <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">{card.body}</p>
            </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/** The compatibility wall — its own section, between health and the steps. */
function Stack({ logos }: { logos: string[] }) {
  return (
    <section className="border-y border-[var(--lore-border)] bg-[var(--lore-background)] py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        <Reveal>
          <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
            Works with
          </p>
          <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">
            Anything that speaks MCP.
          </h2>
          <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
            Five tools over MCP, or a plain <code>AGENTS.md</code> for agents that only read
            files. Both point at the same folder.
          </p>
        </Reveal>
      </div>
      <div className="mt-10">
        <StackWall logos={logos} />
      </div>
    </section>
  );
}

function Steps() {
  const steps = [
    {
      n: "1",
      title: "Link your folder",
      body: "Paste a path, or pick one Lore already found on your Mac. It scans in under a second.",
    },
    {
      n: "2",
      title: "Write the index",
      body: "One click drops AGENTS.md into your vault. Every file-reading agent finds it without being told.",
    },
    {
      n: "3",
      title: "Connect over MCP",
      body: "Copy the config — the path is already filled in — restart your client, and the tools are live.",
    },
  ];

  return (
    <Section
      eyebrow="Get started"
      title="Under two minutes."
      lede="There is no account to create, because there is no server to create it on."
    >
      <div className="mt-11 grid gap-6 sm:grid-cols-3">
        {steps.map((step, i) => (
          <div key={step.n} style={paletteVars(i === 0 ? 0 : i === 1 ? 3 : 2)}>
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
    q: "Does Lore move or reformat my files?",
    a: "No. It reads the folder in place and writes only when you save a page or accept a proposal. The single file it ever adds is AGENTS.md at the vault root, and only when you press the button. Uninstall it and your wiki is untouched.",
  },
  {
    q: "Does it work with my Obsidian vault?",
    a: "Yes — that's the intended case. Lore reads [[wikilinks]], inline #tags, and YAML frontmatter, and skips .obsidian and .trash. Keep using Obsidian for writing; Lore is the layer that makes the same folder legible to your agents.",
  },
  {
    q: "What can an agent actually do?",
    a: "Five tools: read the index, search, read a page, report health, and propose an edit. That's it. There is no write tool, no delete tool, and no shell.",
  },
  {
    q: "Is anything uploaded?",
    a: "Nothing. Lore is a local Next.js app talking to your own filesystem. The only state it keeps outside your wiki is ~/.lore/config.json, which holds the folder path, and the pending proposal queue.",
  },
  {
    q: "Why can't agents just write directly?",
    a: "Because the edit that costs you isn't the obviously wrong one you'd catch — it's the confident, plausible one you'd never look at twice. A diff and a reason takes five seconds to read and is the only thing standing between a useful wiki and a subtly false one.",
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

function Finale({ scene }: { scene: Scene }) {
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

        {/* Centre wash. The art is now a saturated sky rather than the muted
            plate this band used to carry, so the closing type is white over a
            darkening middle — the same treatment as the hero. Sits above the
            fade so the band still melts into the page at both edges. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/4 h-1/2 bg-[radial-gradient(ellipse_at_center,rgba(10,26,52,0.42)_0%,rgba(10,26,52,0.22)_45%,rgba(10,26,52,0)_75%)]" />

        <div className="relative flex min-h-[62svh] flex-col items-center justify-center px-6 text-center">
          <h2 className="t-section max-w-2xl text-white [text-shadow:0_1px_18px_rgba(10,26,52,0.35)]">
            Everything you know,
            <br />
            already in context.
          </h2>
          <p className="t-lede mt-4 max-w-md font-medium text-white/90">
            Stop re-explaining what you already wrote down.
          </p>
          <Link
            href="/vault"
            className="group mt-7 inline-flex h-10 items-center gap-2 rounded-lg bg-white pl-4 pr-3 text-[14px] font-medium text-[#12356f] transition-colors hover:bg-[#eef2fb]"
          >
            Link your wiki
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
