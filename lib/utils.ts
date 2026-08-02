import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "3 minutes ago" / "yesterday" — short enough to sit inside a list row. */
export function relativeTime(epochMs: number): string {
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * A count with its noun, agreeing in number.
 *
 * Every "N pages" in the app was written assuming N > 1, and every one of them
 * is reachable at 1 — a folder with one page, one page needing review, a wiki
 * with one page in it. "1 pages" is small, but it is the kind of small that
 * makes software feel like nobody used it.
 *
 * `plural` for anything that is not a bare +s.
 */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}


/**
 * Jaccard similarity over two token sets.
 *
 * Extracted because lib/gaps.ts and lib/write-feedback.ts each carried a
 * byte-identical private copy — two implementations of one measure is a pair
 * that drifts, and a similarity threshold that means different things in two
 * places is a bug nobody can see. Deliberately NOT applied to canon.ts's
 * `overlap`, which is the overlap COEFFICIENT (divides by the smaller set) and
 * is a different measure chosen on purpose.
 */
export function jaccardOf(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}
