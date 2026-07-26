"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/** One easing curve for the whole site, so nothing moves in a different accent. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Optimistic in-view tracker.
 *
 * Reports `true` immediately and lets an IntersectionObserver pause the loop
 * only once the element has actually scrolled away. Defaulting to visible
 * means a demo still plays where IO callbacks are delayed or unavailable,
 * rather than freezing on frame zero — a stuck demo reads as a broken page.
 */
export function useInView<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  return inView;
}

/**
 * A looping step machine that runs only while its element is on screen.
 *
 * `durations[i]` is how long step `i` is held before advancing; the sequence
 * wraps. Off-screen it rewinds to 0 so it replays on scroll-in. Under reduced
 * motion it parks on `restStep` — the frame that best explains the idea as a
 * still — and never advances.
 *
 * Pass a module-stable `durations` array; a fresh array each render restarts
 * the timer forever.
 */
export function useLoopSequence(durations: readonly number[], restStep: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref);
  const reduce = useReducedMotion();
  const playing = inView && !reduce;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!playing) {
      setStep(reduce ? restStep : 0);
      return;
    }
    const timer = window.setTimeout(
      () => setStep((s) => (s + 1) % durations.length),
      durations[step],
    );
    return () => window.clearTimeout(timer);
  }, [playing, step, reduce, restStep, durations]);

  return { ref, step, playing };
}

/**
 * Types `text` out one character at a time while `active`, clearing when it
 * goes false so the next loop starts from empty.
 */
export function useTyped(text: string, active: boolean, speedMs = 34) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!active) {
      setTyped("");
      return;
    }
    if (typed.length >= text.length) return;
    const timer = window.setTimeout(
      () => setTyped(text.slice(0, typed.length + 1)),
      speedMs,
    );
    return () => window.clearTimeout(timer);
  }, [active, typed, text, speedMs]);

  return active ? typed : text;
}

/** Counts from 0 to `target` while `run`, easing out so it settles rather than stops. */
export function useCountUp(target: number, run: boolean, durationMs = 1100) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (reduce) {
      setValue(target);
      return;
    }
    if (!run) {
      setValue(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run, durationMs, reduce]);

  return value;
}
