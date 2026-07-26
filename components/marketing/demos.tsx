"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, X, FolderOpen, FileText, Loader2, Activity } from "lucide-react";
import { DemoCard, WaterfallText, Caret } from "@/components/marketing/motion-bits";
import { EASE, useCountUp, useLoopSequence, useTyped } from "@/lib/anim";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * Four auto-playing demos, one per beat of the product loop. Each pauses when
 * scrolled off screen and parks on a resting frame under reduced motion — the
 * frame that best explains the idea as a still, not frame zero.
 *
 * They are built from the same tokens and surfaces as the real app, fed static
 * mock data. No backend, no network.
 */

// ---------------------------------------------------------------- beat 1: link

const LINK_PATH = "~/Documents/wiki";
// 0 typing the path, 1 scanning, 2 pages land, 3 hold on the result.
const LINK_STEPS = [1900, 1100, 1400, 2600] as const;

const FOUND = [
  { name: "stack", count: 3, slot: 0 },
  { name: "operating", count: 2, slot: 1 },
  { name: "projects", count: 3, slot: 2 },
  { name: "clients", count: 6, slot: 3 },
];

export function LinkDemo() {
  const { ref, step } = useLoopSequence(LINK_STEPS, LINK_STEPS.length - 1);
  const typed = useTyped(LINK_PATH, step === 0);

  return (
    <div ref={ref} className="w-full">
      <DemoCard>
        <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
          Folder path
        </span>
        <div
          className="mt-1.5 flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-2 text-[12.5px] text-[var(--lore-text-primary)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <FolderOpen size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
          <span className="truncate">{typed}</span>
          <Caret on={step === 0} />
        </div>

        <div className="mt-3 h-[7.5rem]">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="scan"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full flex-col items-center justify-center gap-2.5"
              >
                <Loader2 size={16} className="animate-spin text-[var(--lore-accent)]" />
                <span className="text-[11.5px] text-[var(--lore-text-tertiary)]">
                  Reading markdown…
                </span>
                <div className="h-1 w-32 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
                  <motion.div
                    className="h-full rounded-full bg-[var(--lore-accent)]"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1, ease: "linear" }}
                  />
                </div>
              </motion.div>
            ) : step >= 2 ? (
              <motion.div key="found" className="space-y-1">
                {FOUND.map((f, i) => (
                  <motion.div
                    key={f.name}
                    style={paletteVars(f.slot)}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.09, ease: EASE }}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] text-[var(--lore-text-secondary)]"
                  >
                    <span className="pal-dot" />
                    <span>{f.name}</span>
                    <span className="ml-auto text-[10.5px] text-[var(--lore-text-tertiary)]">
                      {f.count}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full items-center justify-center text-[11.5px] text-[var(--lore-text-tertiary)]"
              >
                Nothing moves. Nothing is uploaded.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DemoCard>
    </div>
  );
}

// ----------------------------------------------------------------- beat 2: read

const READ_PROMPT = "How do we roll back a bad deploy?";
const READ_ANSWER =
  "A revert commit, never the dashboard button — and a red build blocks the deploy in the first place.";
// 0 typing, 1 sent, 2 tool call, 3 answer, 4 hold.
const READ_STEPS = [1900, 550, 1300, 2400, 1600] as const;

export function ReadDemo() {
  const { ref, step } = useLoopSequence(READ_STEPS, 3);
  const typed = useTyped(READ_PROMPT, step === 0);

  return (
    <div ref={ref} className="w-full">
      <DemoCard className="h-[15.5rem] justify-between">
        <div className="space-y-2.5 overflow-hidden">
          <AnimatePresence>
            {step >= 1 ? (
              <motion.div
                key="bubble"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex justify-end"
              >
                <span className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--lore-surface-raised)] px-3 py-1.5 text-[12px] text-[var(--lore-text-primary)]">
                  {READ_PROMPT}
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {step >= 2 ? (
              <motion.div
                key="tool"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex items-center gap-1.5"
              >
                <span
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 py-1 text-[10.5px] text-[var(--lore-text-secondary)]"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <FileText size={10} className="text-[var(--lore-accent)]" />
                  wiki_index
                  {step === 2 ? (
                    <Loader2 size={9} className="animate-spin" />
                  ) : (
                    <Check size={9} className="text-[var(--lore-success)]" />
                  )}
                </span>
                {step > 2 ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 py-1 text-[10.5px] text-[var(--lore-text-secondary)]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    wiki_read
                    <Check size={9} className="text-[var(--lore-success)]" />
                  </span>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="text-[12.5px] leading-relaxed text-[var(--lore-text-primary)]">
            <WaterfallText text={READ_ANSWER} play={step >= 3} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--lore-text-secondary)]">
            {step === 0 ? typed : ""}
            {step === 0 ? <Caret on /> : <span className="text-[var(--lore-text-tertiary)]">Ask anything…</span>}
          </span>
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
              step === 0
                ? "bg-[var(--lore-accent)] text-white"
                : "bg-[var(--lore-surface-raised)] text-[var(--lore-text-tertiary)]",
            )}
          >
            <ArrowUp size={12} />
          </span>
        </div>
      </DemoCard>
    </div>
  );
}

// -------------------------------------------------------------- beat 3: propose

// 0 collapsed, 1 diff expands, 2 accepted, 3 merged into the page.
const PROPOSE_STEPS = [1500, 2400, 900, 2200] as const;

export function ProposeDemo() {
  const { ref, step } = useLoopSequence(PROPOSE_STEPS, 1);
  const accepted = step >= 2;

  return (
    <div ref={ref} className="w-full">
      <DemoCard className="h-[15.5rem]">
        <div style={paletteVars(0)} className="pal-rule">
          <h4 className="pal-title text-[13.5px] font-semibold">Deploy pipeline</h4>
          <ul className="mt-1.5 space-y-1">
            <li className="text-[12px] leading-relaxed text-[var(--lore-text-secondary)]">
              A red build blocks the deploy — never override it.
            </li>
            <AnimatePresence>
              {step >= 3 ? (
                <motion.li
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="rounded bg-[var(--lore-success)]/14 px-1 text-[12px] leading-relaxed text-[var(--lore-text-primary)]"
                >
                  Rollback is a revert commit, not a dashboard button.
                </motion.li>
              ) : null}
            </AnimatePresence>
          </ul>
        </div>

        <AnimatePresence>
          {step < 3 ? (
            <motion.div
              key="proposal"
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="mt-3 overflow-hidden rounded-lg border border-[var(--lore-border)]"
            >
              <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-2.5 py-1.5">
                <span className="text-[11.5px] font-semibold text-[var(--lore-text-primary)]">
                  Claude Code
                </span>
                <span className="rounded-full border border-[#b45309]/40 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#b45309] dark:border-[#fbbf24]/35 dark:text-[#fbbf24]">
                  medium
                </span>
                <span className="flex-1" />
                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--lore-text-secondary)]">
                  <X size={10} />
                  Reject
                </span>
                <motion.span
                  animate={
                    accepted
                      ? { scale: [1, 0.92, 1], backgroundColor: "#16a34a" }
                      : { scale: 1 }
                  }
                  transition={{ duration: 0.35, ease: EASE }}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--lore-accent)] px-2 py-0.5 text-[11px] font-medium text-white"
                >
                  <Check size={10} />
                  {accepted ? "Accepted" : "Accept"}
                </motion.span>
              </div>

              <AnimatePresence initial={false}>
                {step >= 1 ? (
                  <motion.div
                    key="diff"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <p className="px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[var(--lore-text-secondary)]">
                      Rollbacks came up twice this week and the answer isn&apos;t written down.
                    </p>
                    <div
                      className="border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5 text-[11px] leading-[1.7]"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      <div className="text-[var(--lore-text-tertiary)]">
                        {"  "}A red build blocks the deploy…
                      </div>
                      <div className="rounded bg-[var(--lore-success)]/12 px-1 text-[var(--lore-success)]">
                        + Rollback is a revert commit, not a dashboard button.
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.p
              key="done"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-auto pt-3 text-[11.5px] text-[var(--lore-text-tertiary)]"
            >
              Written to <span style={{ fontFamily: "var(--font-mono), monospace" }}>stack/deploy-pipeline.md</span>
            </motion.p>
          )}
        </AnimatePresence>
      </DemoCard>
    </div>
  );
}

// -------------------------------------------------------------- beat 4: health

const HEALTH_STEPS = [2600, 2600] as const;

const ISSUES = [
  { label: "Orphans", value: 6, slot: 0 },
  { label: "Dead links", value: 3, slot: 2 },
  { label: "Stale", value: 11, slot: 6 },
];

export function HealthDemo() {
  const { ref, step, playing } = useLoopSequence(HEALTH_STEPS, 1);
  const score = useCountUp(88, playing ? step >= 0 : true);
  const dash = useMemo(() => 2 * Math.PI * 34, []);

  return (
    <div ref={ref} className="w-full">
      <DemoCard className="h-[15.5rem] items-center justify-center">
        <div className="relative h-[92px] w-[92px]">
          <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              strokeWidth="7"
              className="stroke-[var(--lore-surface-raised)]"
            />
            <motion.circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              className="stroke-[var(--lore-success)]"
              style={{ strokeDasharray: dash }}
              animate={{ strokeDashoffset: dash - (dash * score) / 100 }}
              transition={{ duration: 0.2, ease: "linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[26px] font-bold leading-none tabular-nums text-[var(--lore-text-primary)]">
              {score}
            </span>
            <span className="text-[9.5px] text-[var(--lore-text-tertiary)]">of 100</span>
          </div>
        </div>

        <div className="mt-4 grid w-full grid-cols-3 gap-2">
          {ISSUES.map((issue, i) => (
            <motion.div
              key={issue.label}
              style={paletteVars(issue.slot)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.5 + i * 0.1, ease: EASE }}
              className="rounded-lg px-2 py-1.5 text-center"
            >
              <div className="pal-title text-[15px] font-bold tabular-nums">{issue.value}</div>
              <div className="text-[9.5px] text-[var(--lore-text-tertiary)]">{issue.label}</div>
            </motion.div>
          ))}
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--lore-text-tertiary)]">
          <Activity size={11} />
          Pricing pages get 30 days. Tooling gets 90.
        </p>
      </DemoCard>
    </div>
  );
}
