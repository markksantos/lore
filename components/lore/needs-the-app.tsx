"use client";

import Link from "next/link";
import { ArrowRight, Monitor } from "lucide-react";
import { ViewFrame } from "@/components/lore/observer-bits";

/**
 * What a browser tab says about a feature that needs the machine.
 *
 * The temptation is to hide these screens entirely in the web build. That would
 * be tidier and worse: someone reading about Ghost on the site and then opening
 * the web app would find no trace of it and conclude it does not exist. So the
 * screen is here, it describes the feature properly, and it says exactly which
 * part of it a browser cannot do — not "unavailable", but "a web page cannot
 * photograph your screen, by design".
 *
 * That last part matters. The browser's inability here is a security property,
 * not a gap in the implementation, and saying so turns a limitation into a
 * reason to trust the thing.
 */

export const OBSERVER_BLURB = {
  ghost: {
    title: "Ghost",
    what: "Takes a picture of your screen every few seconds, describes it with a model on your own machine, and lets you ask what you were doing twenty minutes ago.",
    why: "A web page cannot photograph your screen, and should not be able to. That is the browser sandbox working, not Lore missing a feature.",
  },
  ledger: {
    title: "Ledger",
    what: "Indexes every Claude Code session, Codex run and Cursor chat already on your Mac, and gives them one search box.",
    why: "Those transcripts live in your home folder. A browser tab is handed one folder you picked and can see nothing else.",
  },
  oracle: {
    title: "Oracle",
    what: "Indexes your files, mail, messages, calendar, notes, browsing and photos, and answers questions across all of them at once.",
    why: "Mail and Messages sit behind macOS's Full Disk Access, which is granted to applications. There is no version of that a web page can ask for.",
  },
  twin: {
    title: "Twin",
    what: "Notices the filing you do over and over — forty-seven files from Downloads into project folders — and offers to take it over.",
    why: "This tab has read-only access to one folder. It cannot move a file, which is the entire point of the feature.",
  },
  prophet: {
    title: "Prophet",
    what: "Reads your calendar and what the other observers found, and tells you the thing you were about to need. Your call is in twenty minutes; here is what you discussed last time.",
    why: "Every card comes from an observer that cannot run here, so in a browser tab it would have nothing to read.",
  },
  chorus: {
    title: "Chorus",
    what: "Sends one question to several models, has them critique each other, then produces an answer that names what they could not agree on.",
    why: "Running it here would mean your API keys living in a browser and your question passing through somebody's proxy. The app keeps both on your machine.",
  },
  understudy: {
    title: "Understudy",
    what: "Measures how you actually write and drafts in that voice.",
    why: "The measurements run here. Drafting needs a model on your machine.",
  },
} as const;

export function NeedsTheApp({ feature }: { feature: keyof typeof OBSERVER_BLURB }) {
  const blurb = OBSERVER_BLURB[feature];
  return (
    <ViewFrame title={blurb.title} lede={blurb.what}>
      <section className="mt-2 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-5">
        <p className="flex items-start gap-2.5">
          <Monitor size={16} className="mt-0.5 shrink-0 text-[var(--lore-text-tertiary)]" />
          <span className="min-w-0 text-[14px] leading-relaxed text-[var(--lore-text-secondary)]">
            {blurb.why}
          </span>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/download"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3 text-[13px] font-medium text-[var(--lore-button-primary-fg)] transition-colors hover:bg-[var(--lore-accent-hover)]"
          >
            Get the app
            <ArrowRight size={13} />
          </Link>
          <span className="t-meta text-[var(--lore-text-tertiary)]">
            Free, open source, and it reads the same folder you just opened here.
          </span>
        </div>
      </section>

      <p className="t-meta mt-4 text-[var(--lore-text-tertiary)]">
        Everything else on this tab is the real application: the same screens, reading the folder
        you granted, with nothing uploaded.
      </p>
    </ViewFrame>
  );
}
