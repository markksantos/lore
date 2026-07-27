"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A copyable terminal block.
 *
 * Lines beginning with `#` render as comments and are stripped from what the
 * copy button puts on the clipboard — pasting someone's explanatory prose into
 * a shell is a small, avoidable indignity.
 */
export function CodeBlock({ label, lines }: { label: string; lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = lines.filter((line) => !line.startsWith("#")).join("\n");

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--lore-border)]">
      <div className="flex items-center justify-between border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3.5 py-1.5">
        <span className="t-meta text-[var(--lore-text-tertiary)]">{label}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className={cn(
            "inline-flex items-center gap-1.5 text-[12px] transition-colors",
            copied
              ? "text-[var(--lore-success)]"
              : "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]",
          )}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="lore-scrollbar overflow-x-auto bg-[var(--lore-background)] px-3.5 py-3 text-[12.5px] leading-[1.75] text-[var(--lore-text-primary)]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {lines.map((line) => (
          <div
            key={line}
            className={line.startsWith("#") ? "text-[var(--lore-text-tertiary)]" : undefined}
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}
