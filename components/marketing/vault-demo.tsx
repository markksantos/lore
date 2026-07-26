"use client";

import { useState } from "react";
import { BookText, Inbox, Activity, Plug, Search, FileText, ChevronRight, Check, X } from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { cn } from "@/lib/utils";

/**
 * The product shot. A faithful, non-functional replica of the real vault UI —
 * same rails, same type scale, same tokens — showing the one screen that
 * explains the product: an agent's proposed edit sitting in a diff, waiting.
 *
 * It is deliberately a replica rather than a screenshot: it stays sharp at any
 * width, it themes with the page, and it can never go stale against the app.
 */

// Deliberately generic sample content. This is a public marketing page; a
// realistic-looking screenshot is worth nothing if it leaks a real client name
// or a real pricing rule.
const FOLDERS = [
  {
    name: "stack",
    pages: ["Deploy pipeline", "Postgres notes", "Auth decisions"],
  },
  {
    name: "projects",
    pages: ["Atlas", "Beacon", "Relay"],
  },
  {
    name: "operating",
    pages: ["Weekly rhythm", "Review checklist"],
  },
];

const NAV = [
  { label: "Pages", icon: BookText },
  { label: "Review", icon: Inbox, badge: 2 },
  { label: "Health", icon: Activity },
  { label: "Agents", icon: Plug },
];

export function VaultDemo() {
  const [active, setActive] = useState("Deploy pipeline");

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] shadow-[0_40px_90px_-45px_rgba(15,23,42,0.5)]">
      {/* Window chrome. Three dots and nothing else — a fake URL bar or a fake
          traffic-light close button invites a click that can't do anything. */}
      <div className="flex items-center gap-1.5 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="ml-3 text-[11.5px] text-[var(--lore-text-tertiary)]">
          localhost:4646 — ~/Documents/wiki
        </span>
      </div>

      <div className="flex h-[26rem] md:h-[30rem]">
        {/* Sidebar */}
        <div className="hidden w-[14.5rem] shrink-0 flex-col border-r border-[var(--lore-border)] sm:flex">
          <div className="flex items-center gap-2 px-3.5 pb-3 pt-3.5 text-[var(--lore-text-primary)]">
            <BrandMark size={16} />
            <span className="text-[13px] font-semibold tracking-[-0.02em]">wiki</span>
          </div>

          <div className="flex gap-0.5 px-2.5 pb-2.5">
            {NAV.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={cn(
                    "relative flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-medium",
                    i === 0
                      ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
                      : "text-[var(--lore-text-tertiary)]",
                  )}
                >
                  <Icon size={13} />
                  {item.label}
                  {item.badge ? (
                    <span className="absolute right-1.5 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--lore-accent)] px-1 text-[9px] font-semibold text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="px-2.5 pb-2">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1.5">
              <Search size={12} className="text-[var(--lore-text-tertiary)]" />
              <span className="text-[12px] text-[var(--lore-text-tertiary)]">Search</span>
              <kbd className="ml-auto rounded border border-[var(--lore-border)] px-1 text-[9px] text-[var(--lore-text-tertiary)]">
                ⌘K
              </kbd>
            </div>
          </div>

          <div className="flex-1 overflow-hidden px-2.5">
            {FOLDERS.map((folder) => (
              <div key={folder.name} className="mb-1">
                <div className="flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--lore-text-tertiary)]">
                  <ChevronRight size={11} className="rotate-90" />
                  {folder.name}
                  <span className="ml-auto font-normal normal-case">{folder.pages.length}</span>
                </div>
                {folder.pages.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setActive(page)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition-colors",
                      active === page
                        ? "bg-[var(--lore-surface-selected)] text-[var(--lore-text-primary)]"
                        : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]",
                    )}
                  >
                    <FileText size={11} className="shrink-0 opacity-55" />
                    <span className="truncate">{page}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Reader with a pending proposal */}
        <div className="flex-1 overflow-hidden px-5 py-5 md:px-8 md:py-7">
          <h3 className="text-[20px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)] md:text-[24px]">
            {active}
          </h3>
          <p
            className="mt-1 text-[11px] text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            stack/deploy-pipeline.md
          </p>

          <div className="lore-prose mt-4 text-[13.5px] md:text-[14px]">
            <ul>
              <li>Push to main deploys to production. There is no staging step.</li>
              <li>A red build blocks the deploy — never override it.</li>
            </ul>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-[var(--lore-border)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3.5 py-2.5">
              <span className="text-[12.5px] font-medium text-[var(--lore-text-primary)]">
                Claude Code
              </span>
              <span className="rounded-full border border-[#b45309]/35 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide text-[#b45309] dark:border-[#fbbf24]/30 dark:text-[#fbbf24]">
                medium
              </span>
              <span className="text-[11.5px] text-[var(--lore-text-tertiary)]">
                append · 2m ago
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-[11.5px] tabular-nums">
                  <span className="text-[var(--lore-success)]">+1</span>{" "}
                  <span className="text-[var(--lore-danger)]">−0</span>
                </span>
                <span className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--lore-border)] px-2 text-[11.5px] text-[var(--lore-text-secondary)]">
                  <X size={11} />
                  Reject
                </span>
                <span className="inline-flex h-6 items-center gap-1 rounded-md bg-[var(--lore-accent)] px-2 text-[11.5px] font-medium text-white">
                  <Check size={11} />
                  Accept
                </span>
              </span>
            </div>
            <p className="px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--lore-text-secondary)]">
              Rollbacks came up twice this week and the answer isn&apos;t written down anywhere.
            </p>
            <div
              className="border-t border-[var(--lore-border)] bg-[var(--lore-background)] px-3.5 py-2 text-[11.5px] leading-[1.7]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <div className="text-[var(--lore-text-tertiary)]">
                {"  "}- A red build blocks the deploy…
              </div>
              <div className="bg-[var(--lore-success)]/12 px-1 text-[var(--lore-success)]">
                + - Rollback is a revert commit, not a dashboard button.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
