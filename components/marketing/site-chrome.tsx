"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sun, Moon, Github, Globe } from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
import { useTheme } from "@/components/lore/theme-provider";
import { GITHUB_URL, ORG, ORG_URL, TAGLINE } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * @param overHero Only the landing page puts art behind the header. Everywhere
 * else the page starts on the ordinary background, and the transparent state —
 * which paints the nav white for legibility against a photograph — renders white
 * text on a near-white page. Defaulting to `false` means a new page has a
 * readable header without having to know this exists.
 */
export function MarketingHeader({ overHero = false }: { overHero?: boolean }) {
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(!overHero);

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overHero]);

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
          <Link
            href="/web"
            className={cn(
              "hidden rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors sm:block",
              scrolled
                ? "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]"
                : "text-white/85 hover:text-white",
            )}
          >
            Open your wiki
          </Link>
          <Link
            href="/pricing"
            className={cn(
              "hidden rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors sm:block",
              scrolled
                ? "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]"
                : "text-white/85 hover:text-white",
            )}
          >
            Pricing
          </Link>
          <Link
            href="/download"
            className={cn(
              "hidden rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors sm:block",
              scrolled
                ? "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]"
                : "text-white/85 hover:text-white",
            )}
          >
            Download
          </Link>
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
                : "bg-white text-[#12356f] hover:bg-[#eef2fb]",
            )}
          >
            Open Lore
          </Link>
        </nav>
      </div>
    </header>
  );
}

/**
 * Every column entry points at something that exists. A footer is where a
 * product quietly announces how finished it is, and four columns of links to
 * pages nobody has written is a louder admission than three honest ones.
 */
const COLUMNS: { heading: string; links: { label: string; href: string; ext?: boolean }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Download", href: "/download" },
      { label: "Pricing", href: "/pricing" },
      { label: "Open your wiki in the browser", href: "/web" },
      { label: "Try the demo", href: "/demo" },
      { label: "Open Lore", href: "/vault" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Changelog", href: "/changelog" },
      { label: "Source", href: GITHUB_URL, ext: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--lore-border)] bg-[var(--lore-background)]">
      <div className="mx-auto max-w-6xl px-5 py-14 md:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2 text-[var(--lore-text-primary)]">
              <BrandMark size={19} />
              <span className="text-[17px] font-semibold tracking-[-0.03em]">Lore</span>
            </div>
            <p className="mt-3.5 text-[14.5px] leading-relaxed text-[var(--lore-text-secondary)]">
              {TAGLINE}
            </p>

            {/* Where a hosted product puts an uptime badge. Hosted plans exist,
                but the build you run yourself is the whole application and costs
                nothing — which is the more useful thing to say here. */}
            <div className="mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--lore-surface-raised)] px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-success)]" />
              <span className="text-[13px] text-[var(--lore-text-secondary)]">
                Open source · free to self-host
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 md:gap-x-16">
            {COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--lore-text-primary)]">
                  {column.heading}
                </p>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.ext ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[14.5px] text-[var(--lore-text-secondary)] transition-colors hover:text-[var(--lore-text-primary)]"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-[14.5px] text-[var(--lore-text-secondary)] transition-colors hover:text-[var(--lore-text-primary)]"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-[var(--lore-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="t-meta text-[var(--lore-text-tertiary)]">
            © {new Date().getFullYear()} Lore · by{" "}
            <a
              href={ORG_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[var(--lore-accent)] transition-colors hover:text-[var(--lore-accent-hover)]"
            >
              {ORG}
            </a>
          </p>

          {/* Only the accounts that exist. Greyed-out icons linking nowhere are
              the same lie as an empty nav column, just smaller. */}
          <div className="flex items-center gap-1">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Lore on GitHub"
              className="rounded-md p-2 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              <Github size={16} />
            </a>
            <a
              href={ORG_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={`${ORG} — the studio behind Lore`}
              className="rounded-md p-2 text-[var(--lore-text-tertiary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              <Globe size={16} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
