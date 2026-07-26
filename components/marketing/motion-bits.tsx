"use client";

import { useMemo, useRef } from "react";
import { motion, useInView as useFramerInView, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/anim";
import { cn } from "@/lib/utils";

/**
 * Reveals a string word by word in a soft cascade. Each word keeps its layout
 * space (inline-block) so nothing reflows as it appears; the whole thing
 * re-runs whenever `play` flips back to true, and clears when it goes false.
 */
export function WaterfallText({ text, play }: { text: string; play: boolean }) {
  const words = useMemo(() => text.split(" "), [text]);

  return (
    <>
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="mr-[0.28em] inline-block"
          initial={false}
          animate={
            play
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: 4, filter: "blur(3px)" }
          }
          transition={{ duration: 0.32, delay: play ? i * 0.045 : 0, ease: EASE }}
        >
          {word}
        </motion.span>
      ))}
    </>
  );
}

/**
 * Lifts a block into place the first time it scrolls into view, once only.
 * Re-animating on every pass turns a long page into a flicker reel.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useFramerInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const reduce = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={inView || reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** The shell every mini-demo floats on, matching the app's real surfaces. */
export function DemoCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4 shadow-[0_8px_24px_rgba(28,28,26,0.05)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A blinking caret for the typing demos. */
export function Caret({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <motion.span
      aria-hidden
      className="ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-[var(--lore-accent)]"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
    />
  );
}
