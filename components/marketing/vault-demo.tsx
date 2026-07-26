"use client";

import { useState } from "react";
import { BookText, Plug, Settings, Search, Check, X } from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The product shot. A faithful, non-functional replica of the real app — same
 * rails, same type scale, same tokens, same colour assignment — showing the one
 * screen that explains the product: a folder as one document, pages as coloured
 * sections, and an agent's proposal sitting inline in the section it changes.
 *
 * A replica rather than a screenshot: it stays sharp at any width, it themes
 * with the page, and it can't go stale against the app.
 *
 * Sample content is deliberately generic. This is a public marketing page; a
 * realistic screenshot is worth nothing if it leaks a real client or a real
 * rate.
 */

const NAV = [
  { label: "Wiki", icon: BookText },
  { label: "Connections", icon: Plug },
  { label: "Settings", icon: Settings },
];

const FOLDERS = [
  { name: "stack", count: 3, slot: 0 },
  { name: "operating", count: 2, slot: 1 },
  { name: "projects", count: 3, slot: 2 },
  { name: "clients", count: 6, slot: 3 },
];

const SECTIONS = [
  {
    title: "Deploy pipeline",
    path: "stack/deploy-pipeline.md",
    slot: 0,
    body: ["Push to main deploys to production. There is no staging step.", "A red build blocks the deploy — never override it."],
  },
  {
    title: "Postgres notes",
    path: "stack/postgres-notes.md",
    slot: 5,
    body: ["Running Postgres 16. Connection pooling handled at the edge."],
    proposal: {
      agent: "Claude Code",
      risk: "medium",
      kind: "append",
      reason: "The deploy log shows Postgres 17 in production, but this page still says 16.",
      keep: "  Running Postgres 16. Connection pooling…",
      add: "+ Upgraded to Postgres 17 on 2026-07-20.",
    },
  },
  {
    title: "Auth decisions",
    path: "stack/auth-decisions.md",
    slot: 2,
    body: ["Session cookies over JWTs. Revocation was the deciding factor."],
  },
];

export function VaultDemo() {
  const [folder, setFolder] = useState("stack");

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] shadow-[0_40px_90px_-45px_rgba(15,23,42,0.5)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="ml-3 text-[11.5px] text-[var(--lore-text-tertiary)]">
          localhost:4646 — ~/Documents/wiki
        </span>
      </div>

      <div className="flex h-[27rem] md:h-[31rem]">
        <div className="hidden w-[13.5rem] shrink-0 flex-col border-r border-[var(--lore-border)] sm:flex">
          <div className="flex items-center gap-2 px-3.5 pb-3 pt-3.5 text-[var(--lore-text-primary)]">
            <BrandMark size={16} />
            <span className="text-[13px] font-semibold tracking-[-0.02em]">wiki</span>
          </div>

          <div className="space-y-0.5 px-2.5">
            {NAV.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]",
                    i === 0
                      ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-secondary)]",
                  )}
                >
                  <Icon size={13} className="opacity-80" />
                  {item.label}
                </div>
              );
            })}
          </div>

          <div className="px-2.5 pb-2 pt-3.5">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5">
              <Search size={12} className="text-[var(--lore-text-tertiary)]" />
              <span className="text-[12px] text-[var(--lore-text-tertiary)]">Search</span>
              <kbd className="ml-auto rounded border border-[var(--lore-border)] px-1 text-[9px] text-[var(--lore-text-tertiary)]">
                ⌘K
              </kbd>
            </div>
          </div>

          <p className="px-4 pb-1 pt-1 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
            Folders
          </p>
          <div className="px-2.5">
            {FOLDERS.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => setFolder(f.name)}
                style={paletteVars(f.slot)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors",
                  folder === f.name
                    ? "bg-[var(--lore-surface-selected)] font-medium text-[var(--lore-text-primary)]"
                    : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                )}
              >
                <span className="pal-dot" />
                <span className="truncate">{f.name}</span>
                <span className="ml-auto text-[10.5px] text-[var(--lore-text-tertiary)]">
                  {f.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-hidden px-5 py-5 md:px-8 md:py-6">
          <h3 className="text-[19px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)] md:text-[22px]">
            stack
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--lore-text-tertiary)]">3 pages</p>

          <div className="mt-3.5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--lore-border)] py-1.5 pl-3.5 pr-1.5">
            <span
              className="text-[12px] font-semibold tabular-nums text-[var(--lore-success)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              +1
            </span>
            <span
              className="text-[12px] font-semibold tabular-nums text-[var(--lore-danger)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              −0
            </span>
            <span className="text-[11.5px] text-[var(--lore-text-secondary)]">1 proposal</span>
            <span className="flex-1" />
            <span className="px-2 py-1 text-[11.5px] font-medium text-[var(--lore-text-secondary)]">
              Reject all
            </span>
            <span className="rounded-lg bg-[var(--lore-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white">
              Accept all
            </span>
          </div>

          {SECTIONS.map((section) => (
            <div
              key={section.title}
              style={paletteVars(section.slot)}
              className="pal-rule mt-5 first:mt-5"
            >
              <div className="flex items-center gap-2">
                <h4 className="pal-title text-[14.5px] font-semibold tracking-[-0.02em]">
                  {section.title}
                </h4>
                {section.proposal ? (
                  <span className="pal-chip rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold">
                    1 proposal
                  </span>
                ) : null}
              </div>
              <p
                className="mt-0.5 text-[10.5px] text-[var(--lore-text-tertiary)]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {section.path}
              </p>
              <ul className="mt-1.5 space-y-1">
                {section.body.map((line) => (
                  <li
                    key={line}
                    className="text-[12.5px] leading-relaxed text-[var(--lore-text-secondary)]"
                  >
                    {line}
                  </li>
                ))}
              </ul>

              {section.proposal ? (
                <div className="mt-2.5 overflow-hidden rounded-lg border border-[var(--lore-border)]">
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-2.5 py-1.5">
                    <span className="text-[11.5px] font-semibold text-[var(--lore-text-primary)]">
                      {section.proposal.agent}
                    </span>
                    <span className="rounded-full border border-[#b45309]/40 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.05em] text-[#b45309] dark:border-[#fbbf24]/35 dark:text-[#fbbf24]">
                      {section.proposal.risk}
                    </span>
                    <span className="text-[10.5px] text-[var(--lore-text-tertiary)]">
                      {section.proposal.kind}
                    </span>
                    <span className="flex-1" />
                    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--lore-text-secondary)]">
                      <X size={10} />
                      Reject
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--lore-accent)] px-2 py-0.5 text-[11px] font-medium text-white">
                      <Check size={10} />
                      Accept
                    </span>
                  </div>
                  <p className="px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[var(--lore-text-secondary)]">
                    {section.proposal.reason}
                  </p>
                  <div
                    className="border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5 text-[11px] leading-[1.7]"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    <div className="text-[var(--lore-text-tertiary)]">
                      {section.proposal.keep}
                    </div>
                    <div className="rounded bg-[var(--lore-success)]/12 px-1 text-[var(--lore-success)]">
                      {section.proposal.add}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
