"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
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
import { Caret, DemoCard, Reveal } from "@/components/marketing/motion-bits";
import { EASE, useLoopSequence, useTyped } from "@/lib/anim";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The seven things Lore does with the machine it runs on.
 *
 * A distinct section from "how it works", because it is a distinct promise. The
 * wiki half of Lore reads a folder you already have. This half watches the
 * computer — the screen, the mail, the filing, the conversations — and that is
 * a much larger thing to ask of somebody. So the section leads with the ask
 * rather than burying it: the eyebrow says "this machine", every card names
 * what it reads, and the matrix at the bottom says plainly which of them a
 * browser tab cannot do and why that is the browser working correctly.
 *
 * No claim here is ahead of the code. Twin says "the filing you repeat" rather
 * than "learns everything you do", because keyboard and mouse capture is not
 * built and will not be. Ghost says "a model on your machine" because there is
 * no network call in that path. A landing page that oversells an observer is
 * how a privacy product becomes a scandal.
 */

type Feature = {
  id: string;
  slot: number;
  icon: typeof Telescope;
  name: string;
  line: string;
  body: string;
  reads: string;
  where: "app" | "app-and-browser";
};

const FEATURES: Feature[] = [
  {
    id: "ghost",
    slot: 1,
    icon: Telescope,
    name: "Ghost",
    line: "It was watching, so you do not have to remember.",
    body: "A picture of your screen every few seconds, read by a vision model on your own machine. Then: what was that error twenty minutes ago. What did the client say before I closed that window. What did I actually do today.",
    reads: "Your screen",
    where: "app",
  },
  {
    id: "ledger",
    slot: 2,
    icon: History,
    name: "Ledger",
    line: "Every AI conversation you have ever had, in one search box.",
    body: "Claude Code, Codex, Cursor, and exports from Claude.ai and ChatGPT — indexed on this machine. The regex you worked out three weeks ago is not gone, it was just unfindable across five tools.",
    reads: "Logs your AI tools already keep",
    where: "app",
  },
  {
    id: "oracle",
    slot: 3,
    icon: Search,
    name: "Oracle",
    line: "Ask your entire digital life.",
    body: "Files, mail, calendar, iMessage, notes, browser history, photos — one index, one question. When did I first talk to them about this. What did she say she wanted to try. Every source is a separate decision and nothing is ticked to begin with.",
    reads: "The sources you tick",
    where: "app",
  },
  {
    id: "understudy",
    slot: 4,
    icon: PenLine,
    name: "Understudy",
    line: "It learns your voice by measuring it, not describing it.",
    body: "Your median sentence is fourteen words. You use a contraction seventy-one per cent of the times you could. You never use a semicolon. Numbers, taken from your own writing, and the draft is scored against them afterwards so “sounds like me” becomes something you can check.",
    reads: "Writing you already did",
    where: "app-and-browser",
  },
  {
    id: "twin",
    slot: 5,
    icon: Wand2,
    name: "Twin",
    line: "An agent that finds its own jobs.",
    body: "You have moved forty-seven files from Downloads into project folders this month. Want it to do that? Say yes and it writes a rule you can read, runs it against real files without touching them, and only starts moving anything when you say so.",
    reads: "Folders you nominate",
    where: "app",
  },
  {
    id: "chorus",
    slot: 6,
    icon: Scale,
    name: "Chorus",
    line: "Several models argue, then answer.",
    body: "Each answers alone. Each reads the others and says where they are wrong. One writes the verdict — and names what the panel could not agree on, because on a hard question the disagreement is worth more than any single confident paragraph.",
    reads: "Only the question you type",
    where: "app",
  },
  {
    id: "prophet",
    slot: 7,
    icon: Bell,
    name: "Prophet",
    line: "It speaks first, and only when it has something.",
    body: "Your call is in twenty minutes; here is what you discussed last time and the three things left open. This person answers within a day and has not for nine. Wave a card away twice and that kind stops appearing.",
    reads: "What the others already found",
    where: "app",
  },
];

export function MachineSection() {
  return (
    <section className="border-t border-[var(--lore-border)] bg-[var(--lore-background)]">
      <div className="mx-auto max-w-5xl px-6 py-20 md:px-8 md:py-28">
        <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
          This machine
        </p>
        <h2 className="t-section mt-3 max-w-3xl text-[var(--lore-text-primary)]">
          Seven things that only work because they are local.
        </h2>
        <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
          Every one of these is off until you switch it on, each is its own decision, and one
          switch stops all of them at once.
        </p>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            /* The first card spans both columns and carries the demo. Ghost is
               the hardest of the seven to believe and the easiest to show. */
            const wide = i === 0;
            return (
              <Reveal key={feature.id} delay={Math.min(i, 4) * 0.05} className={wide ? "md:col-span-2" : ""}>
                <div style={paletteVars(feature.slot)} className="frame h-full">
                  <div
                    className={cn(
                      "grid min-w-0 gap-6 px-6 py-7 sm:px-7",
                      wide && "lg:grid-cols-[1fr_20rem] lg:items-center lg:gap-10",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                          style={{ background: "var(--plate)" }}
                        >
                          <Icon size={17} />
                        </span>
                        <span className="pal-title text-[15px] font-semibold tracking-[-0.02em]">
                          {feature.name}
                        </span>
                        <span className="ml-auto shrink-0 rounded-full border border-[var(--lore-border)] px-2 py-0.5 text-[10.5px] text-[var(--lore-text-tertiary)]">
                          reads {feature.reads.toLowerCase()}
                        </span>
                      </div>
                      <h3 className="t-step mt-4 text-[var(--lore-text-primary)]">{feature.line}</h3>
                      <p className="t-body mt-2.5 max-w-xl text-[var(--lore-text-secondary)]">
                        {feature.body}
                      </p>
                    </div>
                    {wide ? (
                      <div className="min-w-0 lg:justify-self-end">
                        <RecallDemo />
                      </div>
                    ) : null}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.05}>
          <Matrix />
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ demo --- */

const RECALL_STEPS = [900, 1500, 900, 1400, 2600] as const;

const FRAMES = [
  { at: "14:31", app: "Terminal", note: "npm run build — TypeError in lib/pack.ts" },
  { at: "14:33", app: "Cursor", note: "Editing lib/pack.ts, clampBudget" },
  { at: "14:38", app: "Slack", note: "#client-acme — “can we ship Thursday?”" },
];

/**
 * Ghost answering a question about twenty minutes ago.
 *
 * Deliberately shows the frames as well as the answer, because that is what the
 * real screen does: an answer from a recorder you cannot check is the version
 * of this feature nobody should trust. The resting frame — what somebody with
 * reduced motion sees — is the last step, with the answer already visible.
 */
function RecallDemo() {
  const { ref, step } = useLoopSequence(RECALL_STEPS, RECALL_STEPS.length - 1);
  const typing = step === 0;
  const typed = useTyped("what was that error 20 minutes ago?", typing, 26);

  return (
    <div ref={ref} className="w-full">
      <DemoCard className="h-[15.5rem] justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 py-1.5">
            <Search size={11} className="shrink-0 text-[var(--lore-text-tertiary)]" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--lore-text-primary)]">
              {typing ? typed : "what was that error 20 minutes ago?"}
              <Caret on={typing} />
            </span>
          </div>

          <div className="mt-2 flex gap-1.5">
            {FRAMES.map((frame, i) => (
              <motion.div
                key={frame.at}
                initial={{ opacity: 0, y: 6 }}
                animate={step >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                transition={{ duration: 0.3, delay: i * 0.08, ease: EASE }}
                className={cn(
                  "min-w-0 flex-1 rounded-md border px-1.5 py-1",
                  step >= 3 && i === 0
                    ? "border-[var(--lore-accent)] bg-[var(--lore-accent-tint)]"
                    : "border-[var(--lore-border)] bg-[var(--lore-background)]",
                )}
              >
                <span className="block truncate text-[9.5px] font-medium text-[var(--lore-text-primary)]">
                  {frame.at}
                </span>
                <span className="block truncate text-[9px] text-[var(--lore-text-tertiary)]">
                  {frame.app}
                </span>
              </motion.div>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={step >= 2 ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="mt-2 text-[10.5px] leading-snug text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {FRAMES[0].note}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={step >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-2.5 py-2"
        >
          <p className="text-[11.5px] leading-relaxed text-[var(--lore-text-primary)]">
            At 14:31 a build failed in{" "}
            <span style={{ fontFamily: "var(--font-mono), monospace" }}>lib/pack.ts</span> with a
            TypeError. <span className="text-[var(--lore-text-tertiary)]">[1]</span>
          </p>
        </motion.div>
      </DemoCard>
    </div>
  );
}

/* ---------------------------------------------------------------- matrix --- */

/**
 * Where each of these actually runs.
 *
 * Published rather than discovered. Somebody who reads about Ghost, opens the
 * web app and finds nothing has been misled by omission — so the limitation is
 * stated here, next to the reason, which is that a web page is not allowed to
 * do these things and that is the point.
 */
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
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} className="mt-10 overflow-hidden rounded-xl border border-[var(--lore-border)]">
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
