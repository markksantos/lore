"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Radio, Shield, ShieldAlert, Search, PenLine, Check } from "lucide-react";
import { Caret, DemoCard, WaterfallText } from "@/components/marketing/motion-bits";
import { EASE, useCountUp, useLoopSequence, useTyped } from "@/lib/anim";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * Four auto-playing demos, one per beat of the loop. Each pauses when scrolled
 * off screen and parks on a resting frame under reduced motion — the frame that
 * best explains the idea as a still, not frame zero.
 *
 * They are built from the same tokens and surfaces as the real app, fed static
 * mock data. No backend, no network.
 *
 * Sample paths and agent names are generic on purpose: this is a public page,
 * and a realistic screenshot is worth nothing if it leaks a real client.
 */

// ------------------------------------------------------- beat 1: agents write

const WRITE_STEPS = [1500, 1150, 1150, 2900] as const;

const WRITES = [
  {
    agent: "Claude Code",
    path: "stack/deploy-pipeline.md",
    kind: "rewritten",
    add: 12,
    del: 31,
    slot: 0,
  },
  { agent: "Codex", path: "clients/pricing.md", kind: "rewritten", add: 4, del: 18, slot: 2 },
  {
    agent: "Cursor",
    path: "operating/review-checklist.md",
    kind: "appended",
    add: 6,
    del: 0,
    slot: 3,
  },
  { agent: "sync script", path: "projects/atlas.md", kind: "created", add: 22, del: 0, slot: 6 },
] as const;

export function WriteFeedDemo() {
  const { ref, step, playing } = useLoopSequence(WRITE_STEPS, WRITE_STEPS.length - 1);
  const changed = useCountUp(303, playing);

  return (
    <div ref={ref} className="w-full">
      <DemoCard className="h-[15.5rem] justify-between">
        <div className="flex items-center gap-1.5">
          <Radio size={11} className="text-[var(--lore-success)]" />
          <span
            className="min-w-0 truncate text-[10.5px] text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            watching ~/Documents/wiki
          </span>
        </div>

        <div className="mt-2.5 flex-1 space-y-1">
          {WRITES.slice(0, step + 1).map((write) => (
            <motion.div
              key={write.path}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.32, ease: EASE }}
              style={paletteVars(write.slot)}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1"
            >
              <span className="pal-dot" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] text-[var(--lore-text-primary)]">
                  {write.path}
                </span>
                <span className="block truncate text-[10px] text-[var(--lore-text-tertiary)]">
                  {write.agent} · {write.kind}
                </span>
              </span>
              <span
                className="shrink-0 text-[10.5px] tabular-nums"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                <span className="text-[var(--lore-success)]">+{write.add}</span>{" "}
                <span className="text-[var(--lore-danger)]">−{write.del}</span>
              </span>
            </motion.div>
          ))}
        </div>

        <div className="mt-2 flex items-baseline gap-1.5 border-t border-[var(--lore-border)] pt-2.5">
          <span className="text-[22px] font-bold leading-none tabular-nums text-[var(--lore-text-primary)]">
            {changed}
          </span>
          <span className="text-[11px] text-[var(--lore-text-tertiary)]">
            pages changed in seven days
          </span>
        </div>
      </DemoCard>
    </div>
  );
}

// ------------------------------------------------------ beat 2: the sign-off

// 0 unverified, 1 a human signs off, 2 an agent rewrites the page, 3 it lapses.
/**
 * The four trust states as an outlined pill. Aging borrows the amber plate ink
 * rather than a one-off hex so it survives the theme flip.
 */
export function TrustPill({
  state,
}: {
  state: "verified" | "aging" | "lapsed" | "unverified";
}) {
  const tone =
    state === "verified"
      ? "text-[var(--lore-success)] border-[var(--lore-success)]/45"
      : state === "lapsed"
        ? "text-[var(--lore-danger)] border-[var(--lore-danger)]/50"
        : state === "aging"
          ? "text-[var(--pal-7-ink)] border-[var(--pal-7-ink)]/45"
          : "text-[var(--lore-text-tertiary)] border-[var(--lore-border-strong)]";

  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em]",
        tone,
      )}
    >
      {state}
    </span>
  );
}

// ------------------------------------------------------- beat 3: the questions

// 0–1 searches land, 2 the third is typed, 3 it comes back empty and becomes
// a page to write.
const GAP_STEPS = [1400, 1250, 1700, 3100] as const;

const QUERIES = [
  { q: "rollback procedure", hits: 3 },
  { q: "postgres pooling", hits: 2 },
  { q: "reseller discount", hits: 0 },
] as const;

export function GapsDemo() {
  const { ref, step } = useLoopSequence(GAP_STEPS, GAP_STEPS.length - 1);
  const typing = step === 2;
  const typed = useTyped(QUERIES[2].q, typing);

  return (
    <div ref={ref} className="w-full">
      <DemoCard className="h-[15.5rem] justify-between">
        <div>
          <span
            className="text-[10.5px] text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            wiki_search · last three calls
          </span>

          <div className="mt-2 space-y-1.5">
            {QUERIES.slice(0, step + 1).map((query, i) => {
              const pending = i === 2 && typing;
              return (
                <motion.div
                  key={query.q}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2 py-1.5"
                >
                  <Search size={11} className="shrink-0 text-[var(--lore-text-tertiary)]" />
                  <span
                    className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--lore-text-primary)]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    {i === 2 ? typed : query.q}
                    <Caret on={pending} />
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[10.5px] tabular-nums",
                      pending
                        ? "text-[var(--lore-text-tertiary)] opacity-0"
                        : query.hits === 0
                          ? "text-[var(--lore-danger)]"
                          : "text-[var(--lore-text-tertiary)]",
                    )}
                  >
                    {query.hits} hits
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="h-[4.6rem]">
          <AnimatePresence>
            {step >= 3 ? (
              <motion.div
                key="towrite"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                style={paletteVars(6)}
                className="rounded-lg border border-[var(--lore-border)] px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="pal-dot" />
                  <span className="pal-title text-[11.5px] font-semibold">To write</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--lore-text-secondary)]">
                  <WaterfallText
                    text="Reseller discount — asked four times this month, answered nowhere in the wiki."
                    play={step >= 3}
                  />
                </p>
              </motion.div>
            ) : (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full items-center rounded-lg border border-dashed border-[var(--lore-border)] px-2.5 text-[11px] leading-relaxed text-[var(--lore-text-tertiary)]"
              >
                A search with no hits is a question the wiki could not answer.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </DemoCard>
    </div>
  );
}

// ---------------------------------------------------------- beat 4: the budget

// 0 the window on its own, 1 the wiki beside it.
const BUDGET_STEPS = [1900, 3200] as const;

/** Twelve blocks: one context window each, the first one filled. */
const BLOCKS = Array.from({ length: 12 }, (_, i) => i);

export function BudgetDemo() {
  const { ref, step, playing } = useLoopSequence(BUDGET_STEPS, 1);
  const pages = useCountUp(1424, playing ? step >= 1 : true);

  return (
    <div ref={ref} className="w-full">
      <DemoCard className="h-[15.5rem] justify-center">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
            One 200k window
          </span>
          <span className="text-[10px] text-[var(--lore-text-tertiary)]">12 needed</span>
        </div>

        <div className="mt-2.5 grid grid-cols-6 gap-1.5">
          {BLOCKS.map((block) => (
            <motion.div
              key={block}
              initial={false}
              animate={{
                opacity: block === 0 || step >= 1 ? 1 : 0.14,
                scale: block === 0 || step >= 1 ? 1 : 0.9,
              }}
              transition={{ duration: 0.3, delay: step >= 1 ? block * 0.045 : 0, ease: EASE }}
              className={cn(
                "h-7 rounded-md",
                block === 0
                  ? "bg-[var(--lore-accent)]"
                  : "border border-[var(--lore-border-strong)] bg-[var(--lore-surface-raised)]",
              )}
            />
          ))}
        </div>

        <div className="mt-5 border-t border-[var(--lore-border)] pt-3.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[26px] font-bold leading-none tabular-nums text-[var(--lore-text-primary)]">
              2.3M
            </span>
            <span className="text-[11.5px] text-[var(--lore-text-secondary)]">
              tokens across {pages.toLocaleString()} pages
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--lore-text-tertiary)]">
            The filled block is everything a model can hold at once.
          </p>
        </div>
      </DemoCard>
    </div>
  );
}
