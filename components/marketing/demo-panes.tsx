"use client";

import { useState } from "react";
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  Clock,
  Compass,
  Copy,
  Eye,
  FileDown,
  FileText,
  Flame,
  Globe,
  HelpCircle,
  Inbox,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Undo2,
} from "lucide-react";
import {
  Button,
  ConsentSwitch,
  Empty,
  Panel,
  Stats,
} from "@/components/lore/observer-bits";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The panes behind the product shot.
 *
 * Every one of these is a replica of a screen the application actually has,
 * built out of the application's own primitives — `Panel`, `Stats`, `Button`,
 * `ConsentSwitch` come straight from components/lore/observer-bits, so a change
 * to how a panel looks in the app changes how it looks here. That is the point:
 * the previous shot drew its own approximation of the UI and drifted from it,
 * which is how a landing page ends up advertising software nobody shipped.
 *
 * What is faked is the data, not the interface. Nothing here reaches the
 * filesystem, and the sample content is invented — this is a public page, and a
 * screenshot with a real client name in it is worth less than no screenshot.
 */

// ------------------------------------------------------------------- shell

/** Mirrors ViewFrame from the app, minus the parts that need real state. */
export function Pane({
  title,
  lede,
  right,
  children,
}: {
  title: string;
  lede: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="lore-fade-up mx-auto w-full max-w-[860px] px-4 py-7 md:px-8 md:py-9">
      <header className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {/*
            * h2, where the application uses h1.
            *
            * In the app this pane IS the document and its title is the page's
            * heading. Here it is a figure inside a marketing page that already
            * has one — and two h1 elements leave a screen reader and a crawler
            * unable to say which of "Ask your own machine anything" and "Brief"
            * this page is about. Styling is unchanged; only the level moves.
            */}
          <h2 className="t-section text-[var(--lore-text-primary)]">{title}</h2>
          <p className="t-body mt-1 max-w-[62ch] text-[var(--lore-text-secondary)]">{lede}</p>
        </div>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </header>
      {children}
    </div>
  );
}

function Watching() {
  return (
    <span className="t-meta inline-flex items-center gap-1.5 rounded-full border border-[var(--lore-border)] px-2.5 py-1 text-[var(--lore-success)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-success)]" />
      Watching
    </span>
  );
}

/**
 * A read-only stand-in for a text field.
 *
 * The demo has no keyboard focus to give away and no server to answer, so these
 * are divs styled as inputs rather than inputs that do nothing — a real input
 * that swallows typing is a worse lie than a picture of one.
 */
function FauxInput({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 truncate rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5 text-[14px]",
        muted ? "text-[var(--lore-text-tertiary)]" : "text-[var(--lore-text-primary)]",
      )}
    >
      {value}
    </div>
  );
}

/** The app's own citation chip, as it renders under an answer. */
function Cite({ path }: { path: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-1.5 py-0.5 text-[11.5px] text-[var(--lore-text-secondary)]"
      style={{ fontFamily: "var(--font-mono), monospace" }}
    >
      <FileText size={10} />
      {path}
    </span>
  );
}

/**
 * A tiny abstract screenshot.
 *
 * Ghost's filmstrip is pictures of your screen, and the honest way to show that
 * on a marketing page is a shape that reads as a window without pretending to
 * be one. Real screenshots here would be either invented pixels or somebody's
 * actual desktop.
 */
function FauxFrame({ slot, dark }: { slot: number; dark?: boolean }) {
  return (
    <span
      style={paletteVars(slot)}
      className={cn(
        "flex h-20 w-full flex-col gap-1 p-1.5",
        dark ? "bg-[#101418]" : "bg-[var(--lore-surface-raised)]",
      )}
    >
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--plate)] opacity-70" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-border-strong)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-border-strong)]" />
      </span>
      <span className="block h-1.5 w-2/3 rounded-full bg-[var(--plate)] opacity-60" />
      <span className="block h-1 w-full rounded-full bg-[var(--lore-border-strong)] opacity-70" />
      <span className="block h-1 w-5/6 rounded-full bg-[var(--lore-border-strong)] opacity-50" />
      <span className="block h-1 w-4/6 rounded-full bg-[var(--lore-border-strong)] opacity-40" />
      <span className="mt-auto block h-1 w-1/2 rounded-full bg-[var(--plate)] opacity-40" />
    </span>
  );
}

// -------------------------------------------------------------------- brief

const BRIEF = [
  {
    slot: 0,
    title: "Deploy pipeline",
    path: "stack/deploy-pipeline.md",
    agent: "Claude Code",
    when: "2h ago",
    added: 12,
    removed: 31,
    line: "The deploy is no longer straight to production — it goes behind a five-minute canary, and the old \"never override a red build\" rule was deleted rather than edited.",
  },
  {
    slot: 2,
    title: "Pricing policy",
    path: "clients/pricing.md",
    agent: "Codex",
    when: "5h ago",
    added: 4,
    removed: 18,
    line: "Retainers now bill on the fifteenth instead of the first. Nothing else in the wiki agrees with that date yet.",
  },
  {
    slot: 1,
    title: "Client onboarding",
    path: "clients/onboarding.md",
    agent: "sync script",
    when: "yesterday",
    added: 22,
    removed: 0,
    line: "A new page: written scope before the kickoff call, reversing the order the operating notes still describe.",
  },
  {
    slot: 3,
    title: "Weekly rhythm",
    path: "operating/weekly-rhythm.md",
    agent: "Cursor",
    when: "yesterday",
    added: 6,
    removed: 2,
    line: "Ship days narrowed to Monday through Wednesday. Deep-work hours are unchanged.",
  },
];

export function BriefPane() {
  return (
    <Pane
      title="Brief"
      lede="Eight sentences on what your agents wrote since you last looked. One line per page, ranked by how much it matters."
      right={<Watching />}
    >
      <div className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4">
        <p className="text-[15px] leading-[1.65] text-[var(--lore-text-primary)]">
          Your agents changed <strong>41 pages</strong> in the last seven days. Four of them
          changed something you had relied on: the deploy rule, the billing date, the
          onboarding order and the ship days.
        </p>
        <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
          Read in about forty seconds · nothing here is waiting on you
        </p>
      </div>

      <div className="mt-4">
        <Stats
          items={[
            { label: "pages changed", value: "41" },
            { label: "lines removed", value: "612" },
            { label: "agents writing", value: "4" },
            { label: "git commits", value: "2", hint: "Most of it never reached a commit" },
          ]}
        />
      </div>

      <h2 className="mb-2 mt-6 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
        What changed
      </h2>

      <div className="space-y-2">
        {BRIEF.map((item) => (
          <article
            key={item.path}
            style={paletteVars(item.slot)}
            className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="pal-bar !h-4" />
              <span className="pal-title text-[14.5px] font-semibold">{item.title}</span>
              <span className="t-meta text-[var(--lore-text-tertiary)]">
                {item.agent} · {item.when}
              </span>
              <span className="flex-1" />
              <span
                className="text-[12px] tabular-nums"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                <span className="text-[var(--lore-success)]">+{item.added}</span>{" "}
                <span className="text-[var(--lore-danger)]">−{item.removed}</span>
              </span>
            </div>
            <p className="mt-1.5 text-[13.5px] leading-[1.6] text-[var(--lore-text-secondary)]">
              {item.line}
            </p>
            <p
              className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {item.path}
            </p>
          </article>
        ))}
      </div>
    </Pane>
  );
}

// ---------------------------------------------------------------------- ask

export function AskPane() {
  return (
    <Pane
      title="Ask"
      lede="Answers assembled from your own pages, with every source named. It says so when your wiki does not know."
    >
      <div className="flex flex-wrap gap-2">
        <FauxInput value="What did we decide about session length, and why?" />
        <Button variant="primary">
          <Send size={13} />
          Ask
        </Button>
      </div>

      <Panel>
        <p className="text-[15px] leading-[1.7] text-[var(--lore-text-primary)]">
          Session cookies, not JWTs — the deciding factor was revocation. Sessions live thirty
          days and refresh on use. That decision is eleven weeks old and nothing has contested
          it since.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="t-meta text-[var(--lore-text-tertiary)]">From</span>
          <Cite path="stack/auth-decisions.md" />
          <Cite path="stack/glossary.md" />
        </div>
        <p className="t-meta mt-3 border-t border-[var(--lore-border)] pt-3 text-[var(--lore-text-tertiary)]">
          Answered by a model on this machine · 2 pages read · nothing left the laptop
        </p>
      </Panel>

      <Panel title="It says when it does not know" hint="The failure mode that matters.">
        <div className="flex flex-wrap gap-2">
          <FauxInput value="What is our reseller discount?" muted />
        </div>
        <p className="mt-3 text-[14px] leading-[1.65] text-[var(--lore-text-secondary)]">
          Your wiki does not say. The closest pages are{" "}
          <span style={{ fontFamily: "var(--font-mono), monospace" }}>clients/pricing.md</span>{" "}
          and{" "}
          <span style={{ fontFamily: "var(--font-mono), monospace" }}>clients/vendors.md</span>,
          and neither mentions resellers. This question has now been asked four times — it is
          at the top of the to-write list.
        </p>
      </Panel>
    </Pane>
  );
}

// --------------------------------------------------------------------- wiki

export type WikiPage = {
  id: string;
  title: string;
  path: string;
  inbound: number;
  lines: string[];
};

export function WikiPane({
  folder,
  pages,
  total,
}: {
  folder: string;
  pages: WikiPage[];
  total: number;
}) {
  return (
    <Pane
      title={folder}
      lede={`${total} pages · showing the ${pages.length} changed most recently, read straight off disk in your own headings and folder names`}
    >
      {pages.map((page, i) => (
        <div key={page.id} style={paletteVars(i)} className="group mt-7 first:mt-0">
          <div className="flex items-center gap-2.5">
            <span className="pal-bar" />
            <h4 className="pal-title text-[18px] font-semibold tracking-[-0.02em]">
              {page.title}
            </h4>
            <span className="flex-1" />
            <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12.5px] font-medium text-[var(--lore-text-secondary)] opacity-0 transition-opacity group-hover:opacity-100">
              <Pencil size={12} />
              Edit
            </span>
          </div>
          <p
            className="mt-1 text-[12px] text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {page.path} · {page.inbound} inbound
          </p>
          <ul className="pal-bullets mt-3 space-y-2">
            {page.lines.map((line) => (
              <li key={line} className="text-[15px] leading-[1.7] text-[var(--lore-text-primary)]">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Pane>
  );
}

// ------------------------------------------------------------------ prophet

const CARDS = [
  {
    slot: 2,
    icon: Calendar,
    when: "in 18 minutes",
    title: "Pricing review with the vendor",
    body: "Last time this ran you left the reseller discount unresolved. It is still unresolved, and four searches have asked for it since.",
    sources: ["calendar", "clients/pricing.md", "gap log"],
  },
  {
    slot: 0,
    icon: Flame,
    when: "since 2h ago",
    title: "The deploy rule changed under you",
    body: "Claude Code removed the line about red builds. You had signed that page off in March.",
    sources: ["watcher", "stack/deploy-pipeline.md"],
  },
  {
    slot: 3,
    icon: Inbox,
    when: "yesterday",
    title: "Two threads are waiting on a number from you",
    body: "Both quote the old billing date. The wiki now says the fifteenth.",
    sources: ["mail", "clients/pricing.md"],
  },
];

export function ProphetPane() {
  return (
    <Pane
      title="Prophet"
      lede="The only screen that speaks first. It watches what the other observers already indexed and tells you the thing you were about to need."
      right={<Watching />}
    >
      <ConsentSwitch
        id="demo-prophet"
        label="Prophet"
        reads="Reads what Ghost, Ledger and Oracle already indexed, plus your calendar, and raises a card when something is about to matter."
        enabled
        onChange={() => {}}
      />

      <div className="mt-4 space-y-2.5">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.title}
              style={paletteVars(card.slot)}
              className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ background: "var(--plate)" }}
                >
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
                      {card.title}
                    </h2>
                    <span className="t-meta text-[var(--lore-text-tertiary)]">{card.when}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] leading-[1.6] text-[var(--lore-text-secondary)]">
                    {card.body}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {card.sources.map((source) => (
                      <span
                        key={source}
                        className="t-meta rounded-md border border-[var(--lore-border)] px-1.5 py-0.5 text-[var(--lore-text-tertiary)]"
                      >
                        {source}
                      </span>
                    ))}
                    <span className="flex-1" />
                    <Button>Not now</Button>
                    <Button variant="primary">
                      Open
                      <ArrowRight size={12} />
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
        Every card names what it was built from. Dismiss one and it does not come back.
      </p>
    </Pane>
  );
}

// -------------------------------------------------------------------- ghost

const GHOST_FRAMES = [
  { at: "14:02", app: "Terminal", title: "npm run build", slot: 0, dark: true },
  { at: "14:04", app: "Chrome", title: "TypeError: cannot read …", slot: 5, dark: false },
  { at: "14:07", app: "Cursor", title: "lib/oracle.ts", slot: 2, dark: true },
  { at: "14:11", app: "Chrome", title: "stackoverflow.com", slot: 3, dark: false },
];

export function GhostPane() {
  const [selected, setSelected] = useState(1);
  return (
    <Pane
      title="Ghost"
      lede="It takes a picture of your screen every few seconds and writes down what is happening. Then you can ask it."
      right={<Watching />}
    >
      <ConsentSwitch
        id="demo-ghost"
        label="Ghost"
        reads="Takes a picture of your screen every few seconds and describes it with a model running on this machine."
        enabled
        onChange={() => {}}
      />

      <Panel
        title="Ask what you were doing"
        hint="Name a time if you can — “twenty minutes ago”, “this morning”, “yesterday”."
      >
        <div className="flex flex-wrap gap-2">
          <FauxInput value="What was that error I got 20 minutes ago?" />
          <Button variant="primary">
            <Search size={13} />
            Ask
          </Button>
        </div>

        <div className="mt-4">
          <p className="t-meta text-[var(--lore-text-tertiary)]">
            Looked between 13:52 and 14:12.
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--lore-text-primary)]">
            A TypeError in the browser console at 14:04 — <em>cannot read properties of null</em>{" "}
            on the oracle index page. You had just rebuilt after editing{" "}
            <span style={{ fontFamily: "var(--font-mono), monospace" }}>lib/oracle.ts</span>, and
            went to Stack Overflow about it three minutes later.
          </p>

          <div className="lore-scrollbar mt-4 flex min-w-0 gap-2 overflow-x-auto pb-2">
            {GHOST_FRAMES.map((frame, i) => (
              <button
                key={frame.at}
                type="button"
                onClick={() => setSelected(i)}
                aria-label={`Frame at ${frame.at}, ${frame.app}`}
                className={cn(
                  "w-36 shrink-0 overflow-hidden rounded-lg border text-left transition-colors",
                  i === selected
                    ? "border-[var(--lore-accent)]"
                    : "border-[var(--lore-border)] hover:border-[var(--lore-border-strong)]",
                )}
              >
                <FauxFrame slot={frame.slot} dark={frame.dark} />
                <span className="block px-2 py-1.5">
                  <span className="block truncate text-[11.5px] font-medium text-[var(--lore-text-primary)]">
                    {frame.at} · {frame.app}
                  </span>
                  <span className="t-meta block truncate text-[var(--lore-text-tertiary)]">
                    {frame.title}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3">
            <p className="t-meta text-[var(--lore-text-tertiary)]">
              Today {GHOST_FRAMES[selected].at} · {GHOST_FRAMES[selected].app} ·{" "}
              {GHOST_FRAMES[selected].title}
            </p>
            <p className="mt-1 text-[13.5px] text-[var(--lore-text-primary)]">
              {selected === 1
                ? "A browser devtools console showing a red TypeError, with the stack trace pointing at an oracle index page."
                : "Read by a model on this machine. Nothing about this frame left the laptop."}
            </p>
          </div>
        </div>
      </Panel>

      <div className="mt-4">
        <Stats
          items={[
            { label: "frames kept", value: "8.4k" },
            { label: "read by the model", value: "8.1k", hint: "312 waiting" },
            { label: "on disk", value: "1.9 GB" },
            { label: "oldest", value: "6 days ago", hint: "Kept for 7 days" },
          ]}
        />
      </div>

      <Panel title="Where the week went" hint="Frames captured per app in the last seven days.">
        <div className="space-y-1.5">
          {[
            ["Cursor", 2841, 1],
            ["Chrome", 2106, 0.74],
            ["Terminal", 1489, 0.52],
            ["Slack", 604, 0.21],
          ].map(([app, frames, share]) => (
            <div key={app as string} className="flex min-w-0 items-center gap-2">
              <span className="w-28 shrink-0 truncate text-[12.5px] text-[var(--lore-text-secondary)]">
                {app as string}
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
                <span
                  className="block h-full rounded-full bg-[var(--lore-accent)]"
                  style={{ width: `${(share as number) * 100}%` }}
                />
              </span>
              <span className="t-meta w-12 shrink-0 text-right text-[var(--lore-text-tertiary)]">
                {(frames as number).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Never capture" hint="While one of these is in front, no picture is taken at all.">
        <div className="flex flex-wrap gap-1.5">
          {["1Password", "Messages", "Banking", "Keychain Access"].map((app) => (
            <span
              key={app}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--lore-border)] px-2 py-1 text-[12px] text-[var(--lore-text-secondary)]"
            >
              {app}
              <span className="text-[var(--lore-text-tertiary)]">×</span>
            </span>
          ))}
        </div>
      </Panel>
    </Pane>
  );
}

// ------------------------------------------------------------------- ledger

const SESSIONS = [
  {
    tool: "Claude Code",
    slot: 0,
    when: "3 days ago",
    title: "Why the canary was added to the deploy",
    snippet:
      "…the five-minute canary exists because the 11 March rollback took nineteen minutes. Straight-to-prod was the cause, not the symptom…",
  },
  {
    tool: "Codex",
    slot: 2,
    when: "last week",
    title: "Pooling moved out of the edge",
    snippet:
      "…moved pooling into the application layer after the edge pooler ran out of connections at 400 concurrent…",
  },
  {
    tool: "Cursor",
    slot: 3,
    when: "3 weeks ago",
    title: "Session length, revisited",
    snippet:
      "…thirty days with refresh-on-use. Revocation was the reason we did not go to JWTs — this is the third time it has come up…",
  },
];

export function LedgerPane() {
  return (
    <Pane
      title="Ledger"
      lede="Every Claude Code session, Codex run and Cursor chat on this machine, in one search box. Including the ones you closed and forgot."
      right={<Watching />}
    >
      <ConsentSwitch
        id="demo-ledger"
        label="Ledger"
        reads="Reads the transcripts your AI tools already write to disk and indexes them locally. It does not talk to any of their servers."
        enabled
        onChange={() => {}}
      />

      <Panel>
        <div className="flex flex-wrap gap-2">
          <FauxInput value="canary deploy" />
          <Button variant="primary">
            <Search size={13} />
            Search
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            ["All", true],
            ["Claude Code", false],
            ["Codex", false],
            ["Cursor", false],
            ["ChatGPT export", false],
          ].map(([label, on]) => (
            <span
              key={label as string}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px]",
                on
                  ? "border-[var(--lore-accent)] bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
                  : "border-[var(--lore-border)] text-[var(--lore-text-secondary)]",
              )}
            >
              {label as string}
            </span>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {SESSIONS.map((session) => (
            <article
              key={session.title}
              style={paletteVars(session.slot)}
              className="rounded-lg border border-[var(--lore-border)] px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="pal-dot" />
                <span className="text-[14px] font-semibold text-[var(--lore-text-primary)]">
                  {session.title}
                </span>
                <span className="t-meta text-[var(--lore-text-tertiary)]">
                  {session.tool} · {session.when}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--lore-text-secondary)]">
                {session.snippet}
              </p>
            </article>
          ))}
        </div>
      </Panel>

      <div className="mt-4">
        <Stats
          items={[
            { label: "sessions indexed", value: "2,140" },
            { label: "messages", value: "96.3k" },
            { label: "tools", value: "4" },
            { label: "index size", value: "302 MB" },
          ]}
        />
      </div>
    </Pane>
  );
}

// ------------------------------------------------------------------- oracle

const ORACLE_HITS = [
  {
    icon: Inbox,
    source: "Mail",
    slot: 0,
    title: "Re: renewal terms",
    when: "4 May",
    snippet: "…happy to hold the current rate through the renewal if we sign before the 30th…",
  },
  {
    icon: FileText,
    source: "Files",
    slot: 2,
    title: "renewal-2026.pdf",
    when: "2 May",
    snippet: "…auto-renews annually unless notice is given sixty days before the term ends…",
  },
  {
    icon: MessageSquare,
    source: "Messages",
    slot: 3,
    title: "Thread with the vendor",
    when: "1 May",
    snippet: "…said they'd put the sixty-day notice in writing. Never did…",
  },
  {
    icon: StickyNote,
    source: "Notes",
    slot: 1,
    title: "Vendor call, 28 Apr",
    when: "28 Apr",
    snippet: "…they want a two-year term. We said one, with a rate lock…",
  },
  {
    icon: Globe,
    source: "Browsing",
    slot: 5,
    title: "Comparison of contract terms",
    when: "27 Apr",
    snippet: "…read for eleven minutes, three days before the call…",
  },
];

export function OraclePane() {
  return (
    <Pane
      title="Oracle"
      lede="Your files, mail, messages, calendar, notes and browsing history — one index, one question, all of it on this machine."
      right={<Watching />}
    >
      <ConsentSwitch
        id="demo-oracle"
        label="Oracle"
        reads="Indexes the sources you tick below. Each one is a separate decision, and the index never leaves this machine."
        enabled
        onChange={() => {}}
      />

      <Panel>
        <div className="flex flex-wrap gap-2">
          <FauxInput value="what were the renewal terms we agreed?" />
          <Button variant="primary">
            <Search size={13} />
            Ask
          </Button>
        </div>

        <p className="mt-3.5 text-[14.5px] leading-[1.7] text-[var(--lore-text-primary)]">
          One year with a rate lock, renewing automatically unless you give sixty days&rsquo;
          notice. The rate hold was offered by email on 4 May and depended on signing before
          the 30th. The vendor said they would confirm the notice period in writing and did
          not.
        </p>

        <div className="mt-4 space-y-1.5">
          {ORACLE_HITS.map((hit) => {
            const Icon = hit.icon;
            return (
              <div
                key={hit.title}
                style={paletteVars(hit.slot)}
                className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[var(--lore-border)] px-3 py-2.5"
              >
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
                  style={{ background: "var(--plate)" }}
                >
                  <Icon size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13.5px] font-medium text-[var(--lore-text-primary)]">
                      {hit.title}
                    </span>
                    <span className="t-meta text-[var(--lore-text-tertiary)]">
                      {hit.source} · {hit.when}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-[var(--lore-text-secondary)]">
                    {hit.snippet}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="What is indexed" hint="Each source is its own switch. Turning one off deletes what it indexed.">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ["Files", "182,400 documents", true],
            ["Mail", "61,200 messages", true],
            ["Messages", "44,900 texts", true],
            ["Calendar", "3,180 events", true],
            ["Notes", "912 notes", true],
            ["Browsing history", "88,600 visits", false],
          ].map(([label, count, on]) => (
            <div
              key={label as string}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--lore-border)] px-3 py-2"
            >
              <span
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full",
                  on ? "bg-[var(--lore-accent)]" : "bg-[var(--lore-border-strong)]",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white",
                    on ? "translate-x-[1.125rem]" : "translate-x-0.5",
                  )}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[var(--lore-text-primary)]">
                  {label as string}
                </span>
                <span className="t-meta block text-[var(--lore-text-tertiary)]">
                  {count as string}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </Pane>
  );
}

// --------------------------------------------------------------- understudy

export function UnderstudyPane() {
  return (
    <Pane
      title="Understudy"
      lede="It measures how you actually write — sentence length, contractions, the words you reach for — then drafts in it. The measurements never leave this machine."
      right={<Watching />}
    >
      <ConsentSwitch
        id="demo-understudy"
        label="Understudy"
        reads="Reads your sent mail and messages to measure your writing, then keeps the measurements — not the text."
        enabled
        onChange={() => {}}
      />

      <div className="mt-4">
        <Stats
          items={[
            { label: "words measured", value: "1.2M" },
            { label: "median sentence", value: "14 words" },
            { label: "contractions", value: "31%" },
            { label: "voice match", value: "88%", hint: "How close the last draft scored" },
          ]}
        />
      </div>

      <Panel title="Draft in your voice">
        <div className="flex flex-wrap gap-2">
          <FauxInput value="Tell the vendor we're holding at one year, and we need the notice period in writing." />
          <Button variant="primary">
            <Sparkles size={13} />
            Draft
          </Button>
        </div>

        <div className="mt-3.5 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3.5">
          <p className="whitespace-pre-line text-[14px] leading-[1.75] text-[var(--lore-text-primary)]">
            {`Thanks for sending that over.

We're going to hold at a one-year term — a two-year commitment isn't something we can sign off on right now. The rate lock we discussed on the 4th still works for us.

One thing I do need before we sign: the sixty-day notice period in writing. It came up on the call and in the thread, but it isn't in the document.`}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="t-meta text-[var(--lore-text-tertiary)]">Voice match</span>
          <span className="h-2 w-32 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
            <span className="block h-full w-[88%] rounded-full bg-[var(--lore-success)]" />
          </span>
          <span className="t-meta tabular-nums text-[var(--lore-text-secondary)]">88%</span>
          <span className="flex-1" />
          <Button>Make it shorter</Button>
          <Button>Less formal</Button>
        </div>
      </Panel>
    </Pane>
  );
}

// --------------------------------------------------------------------- twin

export function TwinPane() {
  return (
    <Pane
      title="Twin"
      lede="It watches the filing you repeat and offers to take it over — as a rule you can read first, that reports before it moves anything."
      right={<Watching />}
    >
      <ConsentSwitch
        id="demo-twin"
        label="Twin"
        reads="Watches the folders you name for the moves you make by hand, and proposes a rule when it sees the same one enough times."
        enabled
        onChange={() => {}}
      />

      <Panel title="Noticed" hint="Seen 14 times in the last three weeks.">
        <div style={paletteVars(2)} className="rounded-lg border border-[var(--lore-border)] p-3.5">
          <div className="flex items-center gap-2.5">
            <span className="pal-bar !h-4" />
            <span className="pal-title text-[14.5px] font-semibold">
              Invoices land in Downloads and end up in Clients
            </span>
          </div>
          <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--lore-text-secondary)]">
            Every PDF whose name starts with <code>INV-</code> gets moved from{" "}
            <code>~/Downloads</code> to <code>~/Clients/&lt;name&gt;/invoices</code> within a day
            of arriving. The folder is taken from the text on the first page.
          </p>

          <div className="mt-3 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] p-3">
            <p className="t-meta mb-1.5 text-[var(--lore-text-tertiary)]">The rule, in full</p>
            <pre
              className="overflow-x-auto text-[12px] leading-[1.7] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >{`when   a file appears in ~/Downloads
and    its name matches /^INV-\\d+/
and    it is a PDF
then   move it to ~/Clients/{client}/invoices
never  touch anything inside the wiki`}</pre>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary">
              <Play size={12} />
              Run it, but only report
            </Button>
            <Button>Let it move files</Button>
            <Button>Not this one</Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="What it would have done"
        hint="Reporting only. Nothing on disk has moved."
        right={
          <Button>
            <Undo2 size={12} />
            Undo everything
          </Button>
        }
      >
        <div className="space-y-1.5">
          {[
            ["INV-4417.pdf", "→ Clients/Northwind/invoices"],
            ["INV-4418.pdf", "→ Clients/Northwind/invoices"],
            ["INV-4420.pdf", "→ Clients/Harbour/invoices"],
          ].map(([file, dest]) => (
            <div
              key={file}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-[var(--lore-border)] px-3 py-2"
            >
              <Check size={12} className="shrink-0 text-[var(--lore-text-tertiary)]" />
              <span
                className="min-w-0 truncate text-[12.5px] text-[var(--lore-text-primary)]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {file}
              </span>
              <span className="t-meta truncate text-[var(--lore-text-tertiary)]">{dest}</span>
            </div>
          ))}
        </div>
      </Panel>
    </Pane>
  );
}

// ------------------------------------------------------------------- chorus

const VOICES = [
  {
    model: "Claude",
    slot: 0,
    stance: "One year, and walk on the two-year ask",
    text: "The rate lock is worth less than the flexibility. A two-year term at this price is a bet that your usage does not change, and your usage changed twice this year.",
  },
  {
    model: "GPT",
    slot: 2,
    stance: "Two years, but only with an exit",
    text: "Take the longer term if you can attach a break clause at twelve months. The discount is real money and the clause costs them nothing to give.",
  },
  {
    model: "Gemini",
    slot: 3,
    stance: "One year, and get the notice in writing first",
    text: "The unresolved sixty-day notice is the bigger risk. Signing anything before that is in the document is what turns a one-year term into a two-year one.",
  },
];

export function ChorusPane() {
  return (
    <Pane
      title="Chorus"
      lede="Several models answer the same question, read each other, then name what they could not agree on. The disagreement is the useful part."
    >
      <div className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-2.5">
        <p className="t-body text-[var(--lore-text-secondary)]">
          <span className="font-medium text-[var(--lore-text-primary)]">
            This one leaves the machine.
          </span>{" "}
          Chorus sends your question to the providers you have given keys for — that is the whole
          point of it. Every other screen in Lore runs against a model on this laptop.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <FauxInput value="Should we sign the two-year term for the discount?" />
        <Button variant="primary">
          <Loader2 size={13} className="animate-spin" />
          Round 2 of 3
        </Button>
      </div>

      <div className="mt-4 grid gap-2.5 lg:grid-cols-3">
        {VOICES.map((voice) => (
          <article
            key={voice.model}
            style={paletteVars(voice.slot)}
            className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-3.5"
          >
            <div className="flex items-center gap-2">
              <span className="pal-dot" />
              <span className="pal-title text-[13.5px] font-semibold">{voice.model}</span>
            </div>
            <p className="mt-2 text-[13px] font-medium leading-snug text-[var(--lore-text-primary)]">
              {voice.stance}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-[var(--lore-text-secondary)]">
              {voice.text}
            </p>
          </article>
        ))}
      </div>

      <Panel title="What they could not agree on">
        <ul className="lore-bullets space-y-2 text-[14px] leading-[1.65] text-[var(--lore-text-secondary)]">
          <li>
            Whether the discount is worth a longer commitment. Two said no, one said yes with a
            break clause — and the one that said yes is the only one that priced the discount.
          </li>
          <li>
            All three raised the missing notice period unprompted. None of them was told it was
            unresolved.
          </li>
        </ul>
        <p className="t-meta mt-3 border-t border-[var(--lore-border)] pt-3 text-[var(--lore-text-tertiary)]">
          3 models · 3 rounds · $0.04 · every response kept so you can read the argument, not just
          the verdict
        </p>
      </Panel>
    </Pane>
  );
}

// ------------------------------------------------------------------ changes

export function ChangesPane() {
  return (
    <Pane
      title="Changes"
      lede="Every page an agent rewrote, what it removed, and which agent did it. Nothing is blocked and nothing is queued."
      right={<Watching />}
    >
      <Panel>
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] font-bold leading-none tabular-nums text-[var(--lore-text-primary)]">
            612
          </span>
          <span className="text-[15px] leading-[1.6] text-[var(--lore-text-secondary)]">
            lines your agents deleted this week, across 41 pages
          </span>
        </div>
        <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
          <div className="w-[8%]" style={{ background: "var(--lore-danger)" }} />
          <div className="w-[22%]" style={{ background: "var(--pal-7)" }} />
          <div className="w-[70%]" style={{ background: "var(--lore-border-strong)" }} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--lore-text-tertiary)]">
          <span>Rewritten in place 3</span>
          <span>Appended 9</span>
          <span>Created 29</span>
        </div>
      </Panel>

      <div className="mt-4 space-y-2">
        {[
          ["Deploy pipeline", "Claude Code", "rewritten · 2h ago", 12, 31],
          ["Pricing policy", "Codex", "rewritten · 5h ago", 4, 18],
          ["Client onboarding", "sync script", "created · 3d ago", 22, 0],
        ].map(([title, agent, meta, added, removed], i) => (
          <article
            key={title as string}
            style={paletteVars(i)}
            className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="pal-bar !h-4" />
              <span className="pal-title text-[14.5px] font-semibold">{title as string}</span>
              <span className="t-meta text-[var(--lore-text-tertiary)]">
                {agent as string} · {meta as string}
              </span>
              <span className="flex-1" />
              <span
                className="text-[12px] tabular-nums"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                <span className="text-[var(--lore-success)]">+{added as number}</span>{" "}
                <span className="text-[var(--lore-danger)]">−{removed as number}</span>
              </span>
              <Button>Open diff</Button>
            </div>
          </article>
        ))}
      </div>
    </Pane>
  );
}

// -------------------------------------------------------------------- watch

const FEED = [
  ["14:12", "Claude Code", "rewrote", "stack/deploy-pipeline.md", 0],
  ["14:09", "Cursor", "appended", "operating/weekly-rhythm.md", 3],
  ["13:58", "Codex", "rewrote", "clients/pricing.md", 2],
  ["13:41", "sync script", "created", "clients/onboarding.md", 1],
  ["13:22", "you", "edited", "stack/glossary.md", 5],
];

export function WatchPane() {
  return (
    <Pane
      title="Watch"
      lede="A live feed of writes as they land, straight from the folder. Nothing has to opt in, so nothing can quietly opt out."
      right={<Watching />}
    >
      <div className="space-y-1.5">
        {FEED.map(([at, who, verb, path, slot]) => (
          <div
            key={path as string}
            style={paletteVars(slot as number)}
            className="flex min-w-0 items-center gap-2.5 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3 py-2.5"
          >
            <span className="pal-dot" />
            <span
              className="t-meta w-10 shrink-0 tabular-nums text-[var(--lore-text-tertiary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {at as string}
            </span>
            <span className="shrink-0 text-[13px] font-medium text-[var(--lore-text-primary)]">
              {who as string}
            </span>
            <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
              {verb as string}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--lore-text-secondary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {path as string}
            </span>
          </div>
        ))}
      </div>
      <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
        Claude Code, Cursor, Codex, a sync script, you at midnight — the watcher does not care
        which.
      </p>
    </Pane>
  );
}

// ----------------------------------------------------------------- timeline

export function TimelinePane() {
  return (
    <Pane
      title="Timeline"
      lede="What your wiki said on any past day, reconstructed from its own history. Not a diff — the page as it read that morning."
    >
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <Clock size={13} className="text-[var(--lore-text-tertiary)]" />
          <span className="text-[13.5px] text-[var(--lore-text-secondary)]">
            Showing <strong className="text-[var(--lore-text-primary)]">stack/deploy-pipeline.md</strong>{" "}
            as it read on
          </span>
          <span className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-2.5 py-1 text-[13px] text-[var(--lore-text-primary)]">
            12 March
          </span>
        </div>
        <div className="mt-3 flex h-8 items-end gap-px">
          {[3, 1, 0, 5, 2, 0, 0, 7, 4, 1, 0, 2, 9, 3, 0, 1, 6, 2, 0, 4, 12, 5, 1, 0].map(
            (n, i) => (
              <span
                key={i}
                className={cn(
                  "min-w-0 flex-1 rounded-t-sm",
                  i === 12 ? "bg-[var(--lore-accent)]" : "bg-[var(--lore-border-strong)]",
                )}
                style={{ height: `${Math.max(8, (n / 12) * 100)}%` }}
              />
            ),
          )}
        </div>
        <p className="t-meta mt-1.5 text-[var(--lore-text-tertiary)]">
          Writes per day over the last month. The tall bar is the day the deploy rule changed.
        </p>
      </Panel>

      <div style={paletteVars(0)} className="mt-4">
        <div className="flex items-center gap-2.5">
          <span className="pal-bar" />
          <h4 className="pal-title text-[18px] font-semibold tracking-[-0.02em]">
            Deploy pipeline
          </h4>
          <span className="t-meta rounded-full border border-[var(--lore-border)] px-2 py-0.5 text-[var(--lore-text-tertiary)]">
            as of 12 March
          </span>
        </div>
        <ul className="pal-bullets mt-3 space-y-2">
          <li className="text-[15px] leading-[1.7] text-[var(--lore-text-primary)]">
            Push to main deploys to production. There is no staging step.
          </li>
          <li className="text-[15px] leading-[1.7] text-[var(--lore-text-primary)]">
            A red build blocks the deploy — never override it.
          </li>
        </ul>
        <p className="t-meta mt-3 text-[var(--lore-text-tertiary)]">
          Both of those lines are gone from today&rsquo;s version.
        </p>
      </div>
    </Pane>
  );
}

// ----------------------------------------------------------------- insights

export function InsightsPane() {
  return (
    <Pane
      title="Insights"
      lede="Your agents read the wiki through Lore, so Lore can answer two questions nothing else can."
    >
      <div style={paletteVars(3)} className="flex items-center gap-2.5">
        <span className="pal-bar" />
        <h4 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <Flame size={15} className="text-[var(--lore-text-tertiary)]" />
          Pages your agents actually open
        </h4>
      </div>
      <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)]">
        {[
          ["stack/deploy-pipeline.md", 148, 0],
          ["clients/pricing.md", 96, 2],
          ["operating/weekly-rhythm.md", 61, 1],
        ].map(([path, reads, slot]) => (
          <div
            key={path as string}
            style={paletteVars(slot as number)}
            className="flex items-center gap-2.5 px-4 py-2.5"
          >
            <span className="pal-dot" />
            <span
              className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {path as string}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-[var(--lore-text-tertiary)]">
              {reads as number} reads
            </span>
          </div>
        ))}
      </div>
      <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
        Nine of these twelve pages were not opened once this month.
      </p>

      <div style={paletteVars(6)} className="mt-7 flex items-center gap-2.5">
        <span className="pal-bar" />
        <h4 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          <HelpCircle size={15} className="text-[var(--lore-text-tertiary)]" />
          Searches that returned nothing
        </h4>
      </div>
      <div className="mt-3 space-y-2">
        {[
          ["reseller discount", 4],
          ["refund window", 3],
          ["vendor payment terms", 2],
        ].map(([query, asks]) => (
          <div
            key={query as string}
            className="flex items-center gap-2.5 rounded-xl border border-[var(--lore-border)] px-4 py-2.5"
          >
            <Search size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
            <span
              className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {query as string}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-[var(--lore-text-tertiary)]">
              asked {asks as number}×
            </span>
          </div>
        ))}
      </div>
      <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
        Every line here is a page your wiki was asked for and did not have.
      </p>
    </Pane>
  );
}

// ------------------------------------------------------------------ explore

export function ExplorePane() {
  return (
    <Pane
      title="Explore"
      lede="The shape of the corpus — what links to what, what nothing links to, and which two pages say the same thing differently."
    >
      <Stats
        items={[
          { label: "pages", value: "462" },
          { label: "links", value: "1,908" },
          { label: "orphans", value: "38", hint: "Nothing links to these" },
          { label: "near-duplicates", value: "12" },
        ]}
      />

      <Panel title="Nothing links here" hint="Written, then never referenced again.">
        <div className="flex flex-wrap gap-1.5">
          {[
            "projects/atlas.md",
            "clients/vendors.md",
            "operating/postmortems.md",
            "stack/redis-notes.md",
            "projects/beacon.md",
          ].map((path, i) => (
            <span
              key={path}
              style={paletteVars(i)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--lore-border)] px-2 py-1 text-[12px] text-[var(--lore-text-secondary)]"
            >
              <span className="pal-dot" />
              <span style={{ fontFamily: "var(--font-mono), monospace" }}>{path}</span>
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="These two say the same thing" hint="Different words, same claim — written eight weeks apart.">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ["stack/auth-decisions.md", "Session cookies over JWTs. Revocation was the deciding factor."],
            ["stack/glossary.md", "We use server-side sessions because we need to be able to revoke."],
          ].map(([path, line], i) => (
            <div
              key={path}
              style={paletteVars(i * 2)}
              className="rounded-lg border border-[var(--lore-border)] p-3"
            >
              <p
                className="t-meta text-[var(--lore-text-tertiary)]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {path}
              </p>
              <p className="mt-1 text-[13px] leading-[1.6] text-[var(--lore-text-primary)]">
                {line}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <Link2 size={13} className="text-[var(--lore-text-tertiary)]" />
          <span className="t-meta text-[var(--lore-text-tertiary)]">
            94% similar · neither links to the other
          </span>
        </div>
      </Panel>
    </Pane>
  );
}

// -------------------------------------------------------------- connections

export function ConnectionsPane() {
  return (
    <Pane
      title="Connections"
      lede="Two ways in, and your agents keep their own file tools either way. Wire whichever one your setup supports."
    >
      <Panel>
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--lore-accent-tint)] text-[12px] font-semibold text-[var(--lore-accent)]">
            1
          </span>
          <h4 className="text-[14.5px] font-semibold text-[var(--lore-text-primary)]">
            Drop an index into the vault
          </h4>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--lore-text-secondary)]">
          One page listing every note, its folder and its tags. Any agent that reads files finds
          it without being told — no protocol, no config.
        </p>
        <div className="mt-3">
          <Button variant="primary">
            <FileDown size={13} />
            Write AGENTS.md
          </Button>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--lore-accent-tint)] text-[12px] font-semibold text-[var(--lore-accent)]">
            2
          </span>
          <h4 className="text-[14.5px] font-semibold text-[var(--lore-text-primary)]">
            Connect over MCP
          </h4>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--lore-text-secondary)]">
          Nine tools for the wiki — <code>wiki_index</code>, <code>wiki_search</code>,{" "}
          <code>wiki_read</code>, <code>wiki_context</code>, <code>wiki_brief</code> and four more —
          plus three that reach what Lore observed on this machine, behind their own switch.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-[var(--lore-border)]">
          <div className="flex items-center justify-between border-b border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-1.5">
            <span className="t-meta text-[var(--lore-text-tertiary)]">.mcp.json</span>
            <span className="t-meta inline-flex items-center gap-1.5 text-[var(--lore-text-secondary)]">
              <Copy size={11} />
              Copy
            </span>
          </div>
          <pre
            className="overflow-x-auto bg-[var(--lore-background)] px-3 py-2.5 text-[12px] leading-[1.7] text-[var(--lore-text-primary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >{`{ "mcpServers": { "lore": {
    "command": "node",
    "args": ["…/lore/mcp/server.mjs"]
} } }`}</pre>
        </div>
      </Panel>
    </Pane>
  );
}

// ----------------------------------------------------------------- settings

export function SettingsPane() {
  return (
    <Pane
      title="Settings"
      lede="The folder, the lock, and the model. Three decisions, and two of them are already made."
    >
      <Panel title="Linked folder">
        <div className="flex flex-wrap items-center gap-2">
          <FauxInput value="~/Documents/wiki" />
          <Button>Change</Button>
        </div>
        <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
          462 pages · scanned in under a second · Lore&rsquo;s own state lives in ~/.lore, outside this
          folder, so it never turns up in a git diff of your notes.
        </p>
      </Panel>

      <Panel title="Read-only">
        <div className="flex items-start gap-3">
          <span className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-[var(--lore-accent)]">
            <span className="absolute top-0.5 h-5 w-5 translate-x-[1.125rem] rounded-full bg-white shadow-sm" />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-[var(--lore-text-primary)]">
              Lore cannot write to your wiki
            </p>
            <p className="t-meta mt-0.5 text-[var(--lore-text-tertiary)]">
              Enforced at the route boundary, before any of our code runs. On by default. Twin
              will not touch a file inside the wiki at all while this is on.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Local model" hint="Everything except Chorus runs against this.">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2 text-[13px] text-[var(--lore-text-primary)]">
            qwen3-vl:8b
          </span>
          <span className="t-meta inline-flex items-center gap-1.5 text-[var(--lore-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-success)]" />
            Ollama running
          </span>
          <span className="flex-1" />
          <Button>
            <Eye size={12} />
            Test it
          </Button>
        </div>
      </Panel>

      <Panel title="This machine">
        <p className="t-body text-[var(--lore-text-secondary)]">
          Seven observers, each off until you switch it on, each with its own delete button.
          Nothing here has an account, a server or a way to send your folder anywhere.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Prophet", "Ghost", "Ledger", "Oracle", "Understudy", "Twin", "Chorus"].map(
            (name, i) => (
              <span
                key={name}
                style={paletteVars(i)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--lore-border)] px-2 py-1 text-[12px] text-[var(--lore-text-secondary)]"
              >
                <span className="pal-dot" />
                {name}
              </span>
            ),
          )}
        </div>
      </Panel>
    </Pane>
  );
}

// ------------------------------------------------------------------ fallback

export function StubPane({
  title,
  lede,
  icon: Icon,
}: {
  title: string;
  lede: string;
  icon: typeof Compass;
}) {
  return (
    <Pane title={title} lede={lede}>
      <Empty>
        <span className="inline-flex items-center gap-2">
          <Icon size={14} />
          Live in the downloaded app.
        </span>
      </Empty>
    </Pane>
  );
}

export { Bell, Search as SearchIcon };
