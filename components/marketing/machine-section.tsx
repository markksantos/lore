"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  History,
  Minus,
  PenLine,
  Scale,
  Search,
  Telescope,
  Wand2,
} from "lucide-react";
import {
  ChorusCard,
  GhostCard,
  LedgerCard,
  OracleCard,
  ProphetCard,
  TwinCard,
  UnderstudyCard,
} from "@/components/marketing/feature-cards";
import { Reveal } from "@/components/marketing/motion-bits";
import { ThemedArt } from "@/components/marketing/themed-art";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The seven things that only work because they are local.
 *
 * This was a wall of seven text cards — 1,100 words of prose in a grid, with a
 * single demo attached to the first one. Everything a reader needed in order to
 * believe any of it was in the sentence "a picture of your screen every few
 * seconds, read by a vision model", and a sentence is not evidence.
 *
 * So: one at a time, each with the slice of interface that makes its claim
 * checkable, and a strip that lets someone skip to the one they came for. The
 * body copy is the same argument at half the length, because a paragraph beside
 * a picture does not have to describe the picture.
 */

type Feature = {
  id: string;
  slot: number;
  icon: typeof Telescope;
  name: string;
  line: string;
  body: string;
  reads: string;
  card: () => React.ReactElement;
};

const FEATURES: Feature[] = [
  {
    id: "ghost",
    slot: 1,
    icon: Telescope,
    name: "Ghost",
    line: "It was watching, so you do not have to remember.",
    body: "A picture of your screen every few seconds, read by a vision model on your own machine. Then: what was that error twenty minutes ago. What did the client say before I closed that window. What did I actually do today. Name the apps it must never photograph and it does not take the picture at all.",
    reads: "Your screen",
    card: GhostCard,
  },
  {
    id: "ledger",
    slot: 2,
    icon: History,
    name: "Ledger",
    line: "Every AI conversation you have ever had, in one search box.",
    body: "Claude Code, Codex and Cursor already write their transcripts to your disk, and exports from Claude.ai and ChatGPT drop straight in. The regex you worked out three weeks ago is not gone — it was unfindable across five tools that do not talk to each other.",
    reads: "Logs your AI tools already keep",
    card: LedgerCard,
  },
  {
    id: "oracle",
    slot: 3,
    icon: Search,
    name: "Oracle",
    line: "Ask your entire digital life.",
    body: "Files, mail, calendar, iMessage, notes, browser history, photos — one index, one question. When did I first talk to them about this. What did she say she wanted to try. Every source is a separate switch and nothing is ticked to begin with.",
    reads: "The sources you tick",
    card: OracleCard,
  },
  {
    id: "understudy",
    slot: 4,
    icon: PenLine,
    name: "Understudy",
    line: "It learns your voice by measuring it, not describing it.",
    body: "Your median sentence is fourteen words. You use a contraction thirty-one per cent of the times you could. You have never used a semicolon. Numbers, taken from your own writing — and every draft is scored back against them, so “sounds like me” becomes something you can check.",
    reads: "Writing you already did",
    card: UnderstudyCard,
  },
  {
    id: "twin",
    slot: 5,
    icon: Wand2,
    name: "Twin",
    line: "An agent that finds its own jobs.",
    body: "You have moved forty-seven files out of Downloads this month. Want it to do that? Say yes and it writes a rule you can read, runs it against real files without touching them, and only starts moving anything once you say so. One button undoes everything it ever did.",
    reads: "Folders you nominate",
    card: TwinCard,
  },
  {
    id: "chorus",
    slot: 6,
    icon: Scale,
    name: "Chorus",
    line: "Several models argue, then answer.",
    body: "Each answers alone. Each reads the others and says where they are wrong. One writes the verdict — and names what the panel could not agree on, because on a hard question the disagreement is worth more than any single confident paragraph.",
    reads: "Only the question you type",
    card: ChorusCard,
  },
  {
    id: "prophet",
    slot: 7,
    icon: Bell,
    name: "Prophet",
    line: "It speaks first, and only when it has something.",
    body: "Your call is in twenty minutes; here is what you discussed last time and the three things left open. This person answers within a day and has not for nine. Wave a card away twice and that kind stops appearing.",
    reads: "What the others already found",
    card: ProphetCard,
  },
];

export function MachineSection() {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);

  /* Advances on its own until somebody picks one, then stops for good. Seven
     features behind six unlabelled tabs is a section most people scroll past
     having seen exactly one of them. */
  const pick = useCallback((i: number) => {
    setHeld(true);
    setActive(i);
  }, []);

  useEffect(() => {
    if (held) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setTimeout(() => setActive((i) => (i + 1) % FEATURES.length), 6_000);
    return () => window.clearTimeout(timer);
  }, [active, held]);

  const feature = FEATURES[active];
  const Card = feature.card;
  const Icon = feature.icon;

  return (
    <section id="machine" className="border-t border-[var(--lore-border)] bg-[var(--lore-background)]">
      <div className="mx-auto max-w-6xl px-6 py-20 md:px-8 md:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
          <div className="min-w-0">
            <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
              This machine
            </p>
            <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">
              Seven things that only work because they are local.
            </h2>
            <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
              A cloud tool cannot photograph your screen, read your Messages database or watch you
              file invoices. These can — which is exactly why every one of them is off until you
              switch it on, and why one switch stops all seven at once.
            </p>
          </div>
          <ThemedArt
            src="/marketing/machine-layers"
            alt=""
            width={1400}
            height={782}
            className="hidden lg:block"
          />
        </div>

        {/* The strip. Names, not icons — an icon rail asks a first-time reader
            to guess which pictogram means "reads your mail". */}
        <div
          role="tablist"
          aria-label="What Lore observes on this machine"
          className="lore-scrollbar mt-9 flex gap-2 overflow-x-auto pb-1"
        >
          {FEATURES.map((item, i) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`machine-tab-${item.id}`}
                aria-selected={i === active}
                aria-controls={`machine-panel-${item.id}`}
                onClick={() => pick(i)}
                style={paletteVars(item.slot)}
                /*
                 * The selected tab is neutral, not the feature's own colour.
                 *
                 * Filling it with `--plate` looked right for five of the seven
                 * and unreadable for the other two: white type on the amber and
                 * the mint sits near 1.8:1. The palette still identifies the
                 * feature — it is the dot, and it is the frame around the panel
                 * below — while the selected state itself uses the one pair of
                 * colours guaranteed to contrast in both themes.
                 */
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition-colors",
                  i === active
                    ? "border-transparent bg-[var(--lore-text-primary)] text-[var(--lore-background)]"
                    : "border-[var(--lore-border)] text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
                )}
              >
                <ItemIcon size={14} className={i === active ? undefined : "opacity-70"} />
                {item.name}
                <span
                  aria-hidden
                  className={cn("pal-dot", i === active ? "opacity-100" : "opacity-0")}
                />
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`machine-panel-${feature.id}`}
          aria-labelledby={`machine-tab-${feature.id}`}
          style={paletteVars(feature.slot)}
          className="frame mt-4"
        >
          <div className="grid min-w-0 gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[1fr_26rem] lg:items-center lg:gap-12">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: "var(--plate)" }}
                >
                  <Icon size={18} />
                </span>
                <span className="pal-title text-[16px] font-semibold tracking-[-0.02em]">
                  {feature.name}
                </span>
                <span className="ml-auto shrink-0 rounded-full border border-[var(--lore-border)] px-2.5 py-1 text-[11px] text-[var(--lore-text-tertiary)]">
                  reads {feature.reads.toLowerCase()}
                </span>
              </div>
              <h3 className="t-step mt-5 text-[var(--lore-text-primary)]">{feature.line}</h3>
              <p className="t-body mt-3 max-w-xl text-[var(--lore-text-secondary)]">{feature.body}</p>
              <p className="t-meta mt-5 flex items-center gap-2 text-[var(--lore-text-tertiary)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-success)]" />
                Off by default · runs on your machine · one button deletes everything it collected
              </p>
            </div>

            <div className="min-w-0 lg:justify-self-end">
              <Card />
            </div>
          </div>
        </div>

        <Reveal delay={0.05}>
          <Matrix />
        </Reveal>
      </div>
    </section>
  );
}

const ROWS: { name: string; app: boolean; web: boolean; note: string }[] = [
  { name: "Ghost", app: true, web: false, note: "A web page cannot photograph your screen." },
  { name: "Ledger", app: true, web: false, note: "Transcripts live outside the one folder a tab is given." },
  { name: "Oracle", app: true, web: false, note: "Mail and Messages sit behind Full Disk Access." },
  {
    name: "Understudy",
    app: true,
    web: true,
    note: "Measured in the browser; drafting needs a local model.",
  },
  { name: "Twin", app: true, web: false, note: "A tab has read-only access and can move nothing." },
  { name: "Chorus", app: true, web: false, note: "Keeps your API keys off the page." },
  { name: "Prophet", app: true, web: false, note: "Reads the others, which cannot run in a tab." },
];

function Matrix() {
  return (
    <div className="mt-10 overflow-hidden rounded-xl border border-[var(--lore-border)]">
      <div className="border-b border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3">
        <p className="text-[13.5px] font-semibold text-[var(--lore-text-primary)]">
          Six of the seven need the download. Here is exactly why.
        </p>
        <p className="t-meta mt-0.5 text-[var(--lore-text-tertiary)]">
          The browser version is not a crippled trial — it is a browser, and these are the things a
          tab is not allowed to do.
        </p>
      </div>
      <div className="lore-scrollbar overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">
            Which features run in the desktop app and which run in a browser tab
          </caption>
          <thead>
            <tr className="bg-[var(--lore-surface)]">
              <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold text-[var(--lore-text-primary)]">
                Feature
              </th>
              <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[var(--lore-text-primary)]">
                App
              </th>
              <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-[var(--lore-text-primary)]">
                Browser
              </th>
              <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold text-[var(--lore-text-primary)]">
                Why
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.name} className="border-t border-[var(--lore-border)]">
                <th
                  scope="row"
                  className="px-4 py-2.5 text-[13px] font-medium text-[var(--lore-text-primary)]"
                >
                  {row.name}
                </th>
                <td className="px-3 py-2.5">
                  <Mark on={row.app} />
                </td>
                <td className="px-3 py-2.5">
                  <Mark on={row.web} />
                </td>
                <td className="px-4 py-2.5 text-[12.5px] text-[var(--lore-text-secondary)]">
                  {row.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Mark({ on }: { on: boolean }) {
  return (
    <span
      role="img"
      aria-label={on ? "yes" : "no"}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full",
        on
          ? "bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
          : "bg-[var(--lore-surface-raised)] text-[var(--lore-text-tertiary)]",
      )}
    >
      {on ? <Check size={12} /> : <Minus size={12} />}
    </span>
  );
}
