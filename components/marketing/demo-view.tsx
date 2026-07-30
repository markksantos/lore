"use client";

import Link from "next/link";
import { ArrowRight, Download as DownloadIcon, FolderOpen } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { HeroSimulator } from "@/components/marketing/hero-simulator";

/**
 * The hosted demo.
 *
 * Lore reads a folder on your disk, so there can be no hosted version of the
 * real thing — which left the site in the position of describing an interface
 * nobody could see. Reviewers said so repeatedly: no screenshot, no demo, you
 * must build from source to find out what it looks like.
 *
 * This is the same interactive mock the landing page carries, given the whole
 * window and a sample wiki. It runs entirely in the browser on fixture data. It
 * touches no filesystem and calls no API, which is why it is safe to host at all
 * and why it works identically on the public site and on your own machine.
 *
 * It is labelled as a sample rather than dressed up as the real app. Someone who
 * clicks Sign off here and later finds their own wiki unchanged should never
 * have been surprised.
 */
export function DemoView() {
  return (
    <>
      <MarketingHeader />

      <main className="mx-auto max-w-[86rem] px-4 pb-16 pt-28 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
              Try it
            </p>
            <h1 className="t-section mt-2 text-[var(--lore-text-primary)]">
              A sample wiki, in your browser.
            </h1>
            <p className="t-body mt-2 max-w-2xl text-[var(--lore-text-secondary)]">
              Click around. This is the real interface running on twelve made-up pages — the
              folders, the search, the reading view and the change list all behave as they do
              on your own wiki.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/web"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--lore-accent)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
            >
              <FolderOpen size={15} />
              Open your own wiki
            </Link>
            <Link
              href="/download"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--lore-border)] px-4 text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              <DownloadIcon size={15} />
              Download
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--lore-border)] px-4 text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            >
              Pricing
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <div className="mt-6">
          <HeroSimulator fullHeight />
        </div>

        <p className="t-meta mt-4 text-[var(--lore-text-tertiary)]">
          Sample data, in your browser only. Nothing here reads or writes a file, and there is
          no server behind it — which is also true of the app you download, apart from the
          folder you point it at.
        </p>

        <section className="mt-14 grid gap-4 md:grid-cols-3">
          <Note
            title="This is a mock — the real thing is one click away"
            body="These twelve pages are made up. If you want the real interface on your own notes without installing anything, /web opens a folder you choose and reads it in this browser. Nothing is uploaded there either; it is the same refusal to hold your data, done a different way."
          />
          <Note
            title="What the real one adds"
            body="Your own pages — plus the brief, which tells you in one sentence each what your agents wrote, and Ask, which answers questions from your wiki and cites the passages. Neither can be faked on sample data, which is why they are not in this demo."
          />
          <Note
            title="It is free"
            body="The download is the whole application — nothing is held back for a paid tier. Paid plans add syncing between machines, which is the one thing a program on one laptop cannot do for itself."
          />
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5">
      <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        {title}
      </h2>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">{body}</p>
    </div>
  );
}
