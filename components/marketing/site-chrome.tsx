"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { useTheme } from "@/components/lore/theme-provider";
import { GITHUB_URL, TAGLINE } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function MarketingHeader() {
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  // The header floats transparent over the sky art, then takes a surface once
  // the page scrolls past it — otherwise the nav sits on the page background
  // with no separation.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-[var(--lore-border)] bg-[var(--lore-background)]/85 backdrop-blur-md"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 md:px-8">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2 transition-colors",
            scrolled ? "text-[var(--lore-text-primary)]" : "text-white",
          )}
        >
          <BrandMark size={19} />
          <span className="text-[16px] font-semibold tracking-[-0.03em]">Lore</span>
        </Link>

        <nav className="flex items-center gap-1">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "hidden rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors sm:block",
              scrolled
                ? "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]"
                : "text-white/85 hover:text-white",
            )}
          >
            GitHub
          </a>
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              scrolled
                ? "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)]"
                : "text-white/85 hover:text-white",
            )}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <Link
            href="/vault"
            className={cn(
              "ml-1.5 inline-flex h-8 items-center rounded-lg px-3.5 text-[13.5px] font-medium transition-colors",
              scrolled
                ? "bg-[var(--lore-text-primary)] text-[var(--lore-button-primary-fg)] hover:bg-[var(--lore-button-primary-hover)]"
                : "bg-white text-[#1c3a2b] hover:bg-[#f4f6f4]",
            )}
          >
            Open Lore
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--lore-border)] bg-[var(--lore-background)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-9 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-center gap-2 text-[var(--lore-text-primary)]">
          <BrandMark size={17} />
          <span className="text-[14px] font-semibold tracking-[-0.02em]">Lore</span>
          <span className="t-meta ml-1 text-[var(--lore-text-tertiary)]">{TAGLINE}</span>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href="/vault"
            className="t-meta text-[var(--lore-text-secondary)] transition-colors hover:text-[var(--lore-text-primary)]"
          >
            Open Lore
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="t-meta text-[var(--lore-text-secondary)] transition-colors hover:text-[var(--lore-text-primary)]"
          >
            GitHub
          </a>
          <span className="t-meta text-[var(--lore-text-tertiary)]">
            Runs entirely on your machine
          </span>
        </div>
      </div>
    </footer>
  );
}
