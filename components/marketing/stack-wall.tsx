"use client";

import { motion, useReducedMotion } from "framer-motion";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The compatibility wall.
 *
 * `logos` is the set of slugs that actually have an SVG on disk, resolved on
 * the server (see lib/agents.ts). Anything without one renders a palette-tinted
 * monogram, so the wall looks deliberate today with no assets at all and lights
 * up with real brand marks the moment any are added — no code change.
 *
 * The fallback is a monogram rather than an approximated logo on purpose: a
 * hand-drawn near-miss of someone's brand mark reads as broken, not as
 * shorthand.
 */

type Tool = { name: string; slug: string; slot: number };

const TOOLS: Tool[] = [
  { name: "Claude Code", slug: "claude-code", slot: 0 },
  { name: "Claude Desktop", slug: "claude", slot: 5 },
  { name: "Cursor", slug: "cursor", slot: 1 },
  { name: "Codex", slug: "codex", slot: 2 },
  { name: "ChatGPT", slug: "chatgpt", slot: 3 },
  { name: "Zed", slug: "zed", slot: 6 },
  { name: "Windsurf", slug: "windsurf", slot: 7 },
  { name: "Cline", slug: "cline", slot: 4 },
  { name: "Continue", slug: "continue", slot: 0 },
  { name: "Gemini CLI", slug: "gemini", slot: 5 },
  { name: "Copilot", slug: "copilot", slot: 1 },
  { name: "Obsidian", slug: "obsidian", slot: 2 },
  { name: "Any MCP client", slug: "mcp", slot: 3 },
  { name: "curl", slug: "curl", slot: 6 },
];

function ToolChip({ tool, hasLogo }: { tool: Tool; hasLogo: boolean }) {
  return (
    <div
      style={paletteVars(tool.slot)}
      className="flex shrink-0 items-center gap-2.5 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3.5 py-2.5"
    >
      {hasLogo ? (
        <img
          src={`/assets/agents/${tool.slug}.svg`}
          alt=""
          width={18}
          height={18}
          className="lore-invert-on-dark h-[18px] w-[18px] shrink-0"
        />
      ) : (
        <span
          className="pal-chip flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
          aria-hidden
        >
          {tool.name[0]}
        </span>
      )}
      <span className="whitespace-nowrap text-[13px] font-medium text-[var(--lore-text-primary)]">
        {tool.name}
      </span>
    </div>
  );
}

/** One marquee row. `reverse` sends it the other way so the two rows differ. */
function Row({ tools, reverse, logos }: { tools: Tool[]; reverse?: boolean; logos: Set<string> }) {
  const reduce = useReducedMotion();
  // The list is rendered twice back to back; translating by exactly -50% lands
  // the copy on the original, so the loop has no seam.
  const doubled = [...tools, ...tools];

  return (
    <div className="group relative overflow-hidden">
      <motion.div
        className="flex w-max gap-3"
        animate={reduce ? undefined : { x: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
        transition={{ duration: 34, ease: "linear", repeat: Infinity }}
        style={{ animationPlayState: "running" }}
      >
        {doubled.map((tool, i) => (
          <ToolChip key={`${tool.slug}-${i}`} tool={tool} hasLogo={logos.has(tool.slug)} />
        ))}
      </motion.div>

      {/* Fade the ends into the page so chips enter and leave rather than
          being sliced off at a hard edge. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[var(--lore-background)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[var(--lore-background)] to-transparent" />
    </div>
  );
}

export function StackWall({
  logos = [],
  className,
}: {
  logos?: string[];
  className?: string;
}) {
  const half = Math.ceil(TOOLS.length / 2);
  const have = new Set(logos);

  return (
    <div className={cn("space-y-3", className)}>
      <Row tools={TOOLS.slice(0, half)} logos={have} />
      <Row tools={TOOLS.slice(half)} reverse logos={have} />
    </div>
  );
}
