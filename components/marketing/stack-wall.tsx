"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The compatibility wall.
 *
 * A static grid rather than a scrolling marquee. The list is short enough to
 * read at a glance, and a marquee makes a fixed set of fourteen names feel like
 * an endless one — which is a claim the product cannot back. Standing still, it
 * also lets someone scan for the one client they actually use instead of
 * waiting for it to come round.
 *
 * `logos` is the set of slugs with an SVG on disk, resolved on the server (see
 * lib/agents.ts). A tool without one renders its tinted monogram instead of a
 * hand-drawn near-miss of someone's brand mark, which reads as broken rather
 * than as shorthand. Today all fourteen have one.
 */

/**
 * Header tints. Each brand's own hue, kept pale enough that the row of cards
 * reads as one object rather than fourteen competing swatches.
 */
const TINTS = {
  neutral: "bg-[#F3F4F6] dark:bg-[#1f1f1d]",
  amber: "bg-[#FFF1E7] dark:bg-[#3a1f12]/55",
  blue: "bg-[#EFF6FF] dark:bg-[#102341]/60",
  violet: "bg-[#F5F3FF] dark:bg-[#2a1f47]/60",
  slate: "bg-[#F3F4F6] dark:bg-[#252932]/70",
  red: "bg-[#FEF2F2] dark:bg-[#3F1212]/50",
} as const;

const LABELS = {
  neutral: "text-[#1F1F1A] dark:text-[#e7e7e2]",
  amber: "text-[#C2410C] dark:text-[#FB923C]",
  blue: "text-[#1D4ED8] dark:text-[#60A5FA]",
  violet: "text-[#6D28D9] dark:text-[#A78BFA]",
  slate: "text-[#4B5563] dark:text-[#D1D5DB]",
  red: "text-[#DC2626] dark:text-[#F87171]",
} as const;

type Tool = {
  name: string;
  slug: string;
  tint: keyof typeof TINTS;
  /**
   * True for marks that are near-black by design. `brightness-0 invert` forces
   * them to flat white on dark; a plain `invert(1)` would push curl's navy to
   * peach and Continue's charcoal to cream, inventing colours the brand doesn't
   * have.
   */
  mono?: boolean;
  /** Optical sizing. Marks are drawn to different margins inside the same box. */
  scale?: string;
};

/**
 * Fourteen, in two rows of seven.
 *
 * Ordered so the coloured marks are spread rather than clustered — a run of
 * black glyphs in adjacent cells makes the whole grid read as monochrome even
 * when it is not.
 */
const TOOLS: Tool[] = [
  { name: "Claude Code", slug: "claude-code", tint: "amber", scale: "scale-[0.92]" },
  { name: "ChatGPT", slug: "chatgpt", tint: "neutral", mono: true, scale: "scale-[0.9]" },
  { name: "Codex", slug: "codex", tint: "blue", scale: "scale-[0.92]" },
  { name: "Cursor", slug: "cursor", tint: "neutral", mono: true, scale: "scale-[0.88]" },
  { name: "Claude Desktop", slug: "claude", tint: "amber", scale: "scale-[0.92]" },
  { name: "Grok", slug: "grok", tint: "neutral", mono: true, scale: "scale-[0.84]" },
  { name: "Gemini CLI", slug: "gemini", tint: "violet", scale: "scale-[0.9]" },

  { name: "OpenClaw", slug: "openclaw", tint: "red", scale: "scale-[1.02]" },
  // Zed's blue is dark enough to sit at roughly 2:1 against the dark card, which
  // reads as muddy rather than as a logo. Zed itself shows the mark white on
  // dark, so treat it as mono and keep the blue for light mode only.
  { name: "Zed", slug: "zed", tint: "blue", mono: true, scale: "scale-[0.9]" },
  { name: "Hermes", slug: "hermes", tint: "amber", scale: "scale-[1.02]" },
  { name: "Copilot", slug: "copilot", tint: "neutral", mono: true, scale: "scale-[0.88]" },
  { name: "Obsidian", slug: "obsidian", tint: "violet", scale: "scale-[0.92]" },
  { name: "OpenCode", slug: "opencode", tint: "neutral", mono: true, scale: "scale-[0.9]" },
  { name: "Any MCP client", slug: "mcp", tint: "slate", mono: true, scale: "scale-[0.86]" },
];

function ToolCard({ tool, hasLogo }: { tool: Tool; hasLogo: boolean }) {
  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
      {/* Fixed rather than min-height: at three columns "Claude Desktop" and
          "Any MCP client" wrap to two lines, and a taller header on one card
          drops that card's logo below its neighbours' for the whole row. 50px
          is exactly two 12px lines at leading-tight plus the padding. */}
      <div className={cn("flex h-[50px] items-center justify-center px-2", TINTS[tool.tint])}>
        <div
          className={cn(
            "text-center text-[12px] font-medium leading-tight tracking-[-0.01em]",
            LABELS[tool.tint],
          )}
        >
          {tool.name}
        </div>
      </div>

      <div className="flex min-h-16 items-center justify-center px-2 py-4">
        {hasLogo ? (
          <img
            src={`/assets/agents/${tool.slug}.svg`}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cn(
              "pointer-events-none h-10 w-10 select-none object-contain",
              tool.mono && "dark:brightness-0 dark:invert",
              tool.scale,
            )}
          />
        ) : (
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg text-[15px] font-bold",
              TINTS[tool.tint],
              LABELS[tool.tint],
            )}
            aria-hidden
          >
            {tool.name[0]}
          </span>
        )}
      </div>
    </div>
  );
}

export function StackWall({ logos = [], className }: { logos?: string[]; className?: string }) {
  const reduce = useReducedMotion();
  const have = new Set(logos);

  return (
    <div
      className={cn("mx-auto grid max-w-[46rem] grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-7", className)}
    >
      {TOOLS.map((tool, i) => (
        <motion.div
          key={tool.slug}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          // Staggered by position so the grid assembles left to right rather
          // than appearing all at once. Capped so the last card is not still
          // waiting after the eye has already moved on.
          transition={{ duration: 0.32, delay: Math.min(i * 0.028, 0.4), ease: [0.22, 1, 0.36, 1] }}
        >
          <ToolCard tool={tool} hasLogo={have.has(tool.slug)} />
        </motion.div>
      ))}
    </div>
  );
}
