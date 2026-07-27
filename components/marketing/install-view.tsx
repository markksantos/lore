"use client";

import Link from "next/link";
import { Terminal, Apple, MonitorDown, ShieldCheck } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { PwaInstall } from "@/components/marketing/pwa-install";
import { CodeBlock } from "@/components/marketing/code-block";
import { paletteVars } from "@/lib/palette";
import { GITHUB_URL } from "@/lib/brand";

/**
 * The install page — where the public site sends anyone who clicks into the app.
 *
 * Lore cannot be used from a hosted page, and this explains why rather than
 * treating it as a limitation to apologise for: the product reads the folder
 * your wiki lives in, so it has to run where that folder is. A hosted version
 * would either be useless or would be asking for your files.
 */
export function InstallView({ siteMode }: { siteMode: boolean }) {
  return (
    <>
      <MarketingHeader />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-32 md:px-8">
        <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
          Install
        </p>
        <h1 className="t-section mt-3 text-[var(--lore-text-primary)]">
          Lore runs on your machine.
        </h1>
        <p className="t-lede mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
          It reads the folder your wiki already lives in, so it has to run where that
          folder is. Nothing you install here uploads anything — there is no code in the
          local build that could. If you later want the same wiki on a second machine, a{" "}
          <Link href="/pricing" className="text-[var(--lore-accent)] hover:underline">
            hosted plan
          </Link>{" "}
          adds encrypted sync as a deliberate opt-in. It is off until you choose it, and it
          changes nothing about the copy running here.
        </p>

        {siteMode ? (
          <div
            style={paletteVars(0)}
            className="mt-6 flex items-start gap-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5"
          >
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[var(--lore-accent)]" />
            <p className="t-body text-[var(--lore-text-secondary)]">
              You are reading the public site, so the app is switched off here. Every
              endpoint that touches a filesystem returns nothing on this host, by design.
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5">
            <p className="t-body flex-1 text-[var(--lore-text-secondary)]">
              You are already running Lore locally.
            </p>
            <Link
              href="/vault"
              className="inline-flex h-9 items-center rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
            >
              Open the app
            </Link>
          </div>
        )}

        {/* Registers the service worker and, on a browser that offers it, the
            install prompt. Renders nothing in site mode, where an install would
            be a shortcut to this page. */}
        <PwaInstall siteMode={siteMode} className="mt-3" />

        <Step
          slot={0}
          n="1"
          icon={Terminal}
          title="Run it from source"
          body="Node 20 or newer. Nothing else — no database, no account, no API key."
        >
          <CodeBlock
            label="Terminal"
            lines={[
              `git clone ${GITHUB_URL.replace(/^https?:\/\//, "https://")}.git`,
              "cd lore",
              "npm install",
              "npm run dev",
            ]}
          />
          <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
            Opens on <code>127.0.0.1:4646</code>. It binds to loopback deliberately, so
            nothing on your network can reach your wiki through it.
          </p>
        </Step>

        <Step
          slot={3}
          n="2"
          icon={Apple}
          title="Or build the desktop app"
          body="Same application, in a window, with a real folder picker and no terminal."
        >
          <CodeBlock
            label="Terminal"
            lines={["npm run dist:mac", "npm run dist:win", "npm run dist:linux"]}
          />
          <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
            The desktop build is the only way to get a native folder picker on Windows
            and Linux — in a browser, that button is macOS-only, because it shells out to
            osascript.
          </p>
          <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
            These builds are unsigned. macOS will ask you to approve it in System Settings
            the first time, and Windows SmartScreen will warn. Signing needs an Apple
            Developer membership and a Windows certificate, neither of which is configured
            here. AppImage cannot be assembled on a Mac — build it on Linux.
          </p>
        </Step>

        <Step
          slot={6}
          n="3"
          icon={MonitorDown}
          title="Point it at your wiki"
          body="One decision, then you are done. Nothing is copied, imported or reformatted."
        >
          <p className="t-body text-[var(--lore-text-secondary)]">
            Click <strong>Browse</strong> and choose the folder your markdown lives in — an
            Obsidian vault, a <code>notes/</code> directory, whatever you already keep. Lore
            reads it in place and only ever writes when you save a page or ask it to.
          </p>
        </Step>

        <h2 className="mt-14 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          What it never does
        </h2>
        <ul className="lore-bullets mt-3 space-y-2 text-[15px] leading-[1.7] text-[var(--lore-text-secondary)]">
          <li>Upload your wiki, or any part of it, anywhere.</li>
          <li>Listen on anything but loopback.</li>
          <li>
            Move, rename or reformat your files. The one file it can add is{" "}
            <code>AGENTS.md</code>, fenced so anything you wrote in it is preserved.
          </li>
          <li>
            Keep state inside your vault. Config, journal and the verification ledger all
            live in <code>~/.lore</code>, so a <code>git diff</code> of your notes stays clean.
          </li>
        </ul>
      </main>

      <MarketingFooter />
    </>
  );
}

function Step({
  slot,
  n,
  icon: Icon,
  title,
  body,
  children,
}: {
  slot: number;
  n: string;
  icon: typeof Terminal;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section style={paletteVars(slot)} className="mt-10">
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: "var(--plate)" }}
        >
          <Icon size={16} />
        </span>
        <span
          className="t-meta text-[var(--lore-text-tertiary)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          0{n}
        </span>
      </div>
      <h2 className="pal-title mt-3.5 text-[18px] font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="t-body mt-1.5 max-w-2xl text-[var(--lore-text-secondary)]">{body}</p>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}
