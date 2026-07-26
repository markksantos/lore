"use client";

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Lock,
  PanelLeft,
  Plus,
  RotateCw,
  Shield,
  Share,
} from "lucide-react";

/**
 * macOS browser chrome for the product shot.
 *
 * A window frame is the cheapest possible tell: three flat grey circles read as
 * a placeholder, while real traffic lights, navigation affordances and a centred
 * URL pill make the screenshot read as an actual application. It costs nothing
 * and it is the first thing anyone looks at.
 *
 * Everything here is decorative — `aria-hidden`, no focusable controls — so a
 * screen reader is never offered a browser toolbar that does nothing.
 */
export function BrowserChrome({ url }: { url: string }) {
  return (
    <div
      aria-hidden
      className="flex h-11 items-center gap-3 border-b border-[var(--lore-border)] bg-[var(--lore-chrome)] px-4"
    >
      {/* Traffic lights. Real colours, not grey — the single biggest cue. */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
      </div>

      <div className="ml-1 hidden shrink-0 items-center gap-3 text-[var(--lore-text-tertiary)] sm:flex">
        <PanelLeft size={15} />
        <ChevronLeft size={15} />
        <ChevronRight size={15} className="opacity-40" />
        <Shield size={15} />
      </div>

      {/* Centred address pill. Absolutely sized so it stays centred in the
          window rather than drifting with the icon groups either side. */}
      <div className="flex min-w-0 flex-1 justify-center">
        <div className="flex h-7 w-full max-w-[22rem] items-center gap-2 rounded-lg bg-[var(--lore-chrome-field)] px-3">
          <Lock size={11} className="shrink-0 text-[var(--lore-text-tertiary)]" />
          <span className="flex-1 truncate text-center text-[12.5px] text-[var(--lore-text-secondary)]">
            {url}
          </span>
          <RotateCw size={11} className="shrink-0 text-[var(--lore-text-tertiary)]" />
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-3.5 text-[var(--lore-text-tertiary)] sm:flex">
        <Download size={15} />
        <Share size={15} />
        <Plus size={15} />
        <Copy size={15} />
      </div>
    </div>
  );
}
