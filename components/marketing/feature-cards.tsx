"use client";

import {
  Bell,
  Calendar,
  Check,
  FileText,
  Globe,
  Inbox,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Terminal,
} from "lucide-react";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * One cropped card per capability.
 *
 * Not screenshots and not diagrams — the smallest slice of the real interface
 * that makes a claim checkable. A section that says "ask your screen what you
 * were doing" next to a stock illustration of a telescope has told the reader
 * nothing; the same sentence next to a filmstrip with a timestamped answer
 * under it has told them everything.
 *
 * Each is built from the same tokens as the application, so they follow the
 * light and dark themes rather than being baked into a PNG at one brightness.
 */

export function CardShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-4 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <p className="t-meta mb-2 font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
      {children}
    </p>
  );
}

function Query({ text, icon: Icon = Search }: { text: string; icon?: typeof Search }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5">
      <Icon size={14} className="shrink-0 text-[var(--lore-text-tertiary)]" />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
        {text}
      </span>
      <span className="shrink-0 rounded-md bg-[var(--lore-accent)] px-2 py-0.5 text-[11px] font-semibold text-white">
        Ask
      </span>
    </div>
  );
}

// -------------------------------------------------------------------- ghost

export function GhostCard() {
  return (
    <CardShell>
      <Head>Ghost · ask what you were doing</Head>
      <Query text="What was that error I got 20 minutes ago?" />

      <p className="mt-3 text-[13.5px] leading-[1.65] text-[var(--lore-text-primary)]">
        A TypeError in the browser console at 14:04 — <em>cannot read properties of null</em>. You
        had just rebuilt after editing{" "}
        <span style={{ fontFamily: "var(--font-mono), monospace" }}>lib/oracle.ts</span>.
      </p>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {[
          ["14:02", "Terminal", 0, true],
          ["14:04", "Chrome", 5, false],
          ["14:07", "Cursor", 2, true],
          ["14:11", "Chrome", 3, false],
        ].map(([at, app, slot, dark], i) => (
          <div
            key={at as string}
            style={paletteVars(slot as number)}
            className={cn(
              "overflow-hidden rounded-md border",
              i === 1 ? "border-[var(--lore-accent)]" : "border-[var(--lore-border)]",
            )}
          >
            <span
              className={cn(
                "flex h-12 flex-col gap-1 p-1.5",
                dark ? "bg-[#101418]" : "bg-[var(--lore-surface-raised)]",
              )}
            >
              <span className="block h-1 w-2/3 rounded-full bg-[var(--plate)] opacity-70" />
              <span className="block h-[3px] w-full rounded-full bg-[var(--lore-border-strong)] opacity-70" />
              <span className="block h-[3px] w-4/5 rounded-full bg-[var(--lore-border-strong)] opacity-50" />
              <span className="mt-auto block h-[3px] w-1/2 rounded-full bg-[var(--plate)] opacity-50" />
            </span>
            <span className="block truncate px-1.5 py-1 text-[10px] text-[var(--lore-text-tertiary)]">
              {at as string} · {app as string}
            </span>
          </div>
        ))}
      </div>

      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        Read by a model on this machine. Nothing was uploaded.
      </p>
    </CardShell>
  );
}

// ------------------------------------------------------------------- ledger

export function LedgerCard() {
  return (
    <CardShell>
      <Head>Ledger · every AI session on this machine</Head>
      <Query text="canary deploy" />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Claude Code 812", "Codex 447", "Cursor 690", "ChatGPT export 191"].map((chip, i) => (
          <span
            key={chip}
            style={paletteVars(i)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--lore-border)] px-2 py-1 text-[11.5px] text-[var(--lore-text-secondary)]"
          >
            <span className="pal-dot" />
            {chip}
          </span>
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        {[
          ["Why the canary was added", "Claude Code · 3 days ago", 0],
          ["Pooling moved out of the edge", "Codex · last week", 2],
          ["Session length, revisited", "Cursor · 3 weeks ago", 3],
        ].map(([title, meta, slot]) => (
          <div
            key={title as string}
            style={paletteVars(slot as number)}
            className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] px-2.5 py-2"
          >
            <span className="pal-dot" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--lore-text-primary)]">
              {title as string}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--lore-text-tertiary)]">
              {meta as string}
            </span>
          </div>
        ))}
      </div>

      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        2,140 sessions · 96,300 messages · indexed locally
      </p>
    </CardShell>
  );
}

// ------------------------------------------------------------------- oracle

export function OracleCard() {
  return (
    <CardShell>
      <Head>Oracle · one index over everything</Head>
      <Query text="what were the renewal terms we agreed?" />

      <p className="mt-3 text-[13.5px] leading-[1.65] text-[var(--lore-text-primary)]">
        One year with a rate lock, auto-renewing unless you give sixty days&rsquo; notice — and the
        vendor never put the notice period in writing.
      </p>

      <div className="mt-3 space-y-1">
        {[
          [Inbox, "Mail", "Re: renewal terms", "4 May", 0],
          [FileText, "Files", "renewal-2026.pdf", "2 May", 2],
          [MessageSquare, "Messages", "Thread with the vendor", "1 May", 3],
          [StickyNote, "Notes", "Vendor call, 28 Apr", "28 Apr", 1],
          [Globe, "Browsing", "Comparison of terms", "27 Apr", 5],
        ].map(([Icon, source, title, when, slot]) => {
          const I = Icon as typeof Inbox;
          return (
            <div
              key={title as string}
              style={paletteVars(slot as number)}
              className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] px-2.5 py-1.5"
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white"
                style={{ background: "var(--plate)" }}
              >
                <I size={10} />
              </span>
              <span className="w-[68px] shrink-0 text-[11px] text-[var(--lore-text-tertiary)]">
                {source as string}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--lore-text-primary)]">
                {title as string}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--lore-text-tertiary)]">
                {when as string}
              </span>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

// --------------------------------------------------------------- understudy

export function UnderstudyCard() {
  return (
    <CardShell>
      <Head>Understudy · measured, not described</Head>

      <div className="grid grid-cols-3 gap-1.5">
        {[
          ["14", "median words / sentence"],
          ["31%", "contractions"],
          ["0", "semicolons, ever"],
        ].map(([value, label]) => (
          <div
            key={label}
            className="rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-2.5 py-2"
          >
            <div className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
              {value}
            </div>
            <div className="mt-0.5 text-[10.5px] leading-tight text-[var(--lore-text-tertiary)]">
              {label}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5">
        <Sparkles size={14} className="shrink-0 text-[var(--lore-text-tertiary)]" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--lore-text-primary)]">
          Tell them we&rsquo;re holding at one year
        </span>
        <span className="shrink-0 rounded-md bg-[var(--lore-accent)] px-2 py-0.5 text-[11px] font-semibold text-white">
          Draft
        </span>
      </div>

      <div className="mt-3 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3">
        <p className="text-[13px] leading-[1.7] text-[var(--lore-text-primary)]">
          We&rsquo;re going to hold at a one-year term — a two-year commitment isn&rsquo;t something
          we can sign off on right now. The rate lock we discussed still works for us.
        </p>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="t-meta text-[var(--lore-text-tertiary)]">Voice match</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
          <span className="block h-full w-[88%] rounded-full bg-[var(--lore-success)]" />
        </span>
        <span className="t-meta tabular-nums text-[var(--lore-text-secondary)]">88%</span>
      </div>
    </CardShell>
  );
}

// --------------------------------------------------------------------- twin

export function TwinCard() {
  return (
    <CardShell>
      <Head>Twin · a rule you can read first</Head>

      <p className="text-[13.5px] leading-[1.6] text-[var(--lore-text-primary)]">
        You have moved 47 invoices out of Downloads this month. Want it to do that?
      </p>

      <div className="mt-3 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] p-3">
        <pre
          className="overflow-x-auto text-[11.5px] leading-[1.75] text-[var(--lore-text-primary)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >{`when   a file appears in ~/Downloads
and    its name matches /^INV-\\d+/
then   move it to ~/Clients/{client}/invoices
never  touch anything inside the wiki`}</pre>
      </div>

      <div className="mt-3 space-y-1">
        {["INV-4417.pdf → Clients/Northwind", "INV-4418.pdf → Clients/Northwind", "INV-4420.pdf → Clients/Harbour"].map(
          (line) => (
            <div
              key={line}
              className="flex items-center gap-2 rounded-md border border-dashed border-[var(--lore-border)] px-2.5 py-1.5"
            >
              <Check size={11} className="shrink-0 text-[var(--lore-text-tertiary)]" />
              <span
                className="min-w-0 truncate text-[11.5px] text-[var(--lore-text-secondary)]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {line}
              </span>
            </div>
          ),
        )}
      </div>

      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        Reporting only. Nothing on disk has moved, and one button undoes it if it ever does.
      </p>
    </CardShell>
  );
}

// ------------------------------------------------------------------- chorus

export function ChorusCard() {
  return (
    <CardShell>
      <Head>Chorus · where they disagree</Head>
      <Query text="Should we sign the two-year term for the discount?" icon={Send} />

      <div className="mt-3 space-y-1.5">
        {[
          ["Claude", "One year — walk on the two-year ask", 0],
          ["GPT", "Two years, but only with a break clause", 2],
          ["Gemini", "One year, and get the notice in writing", 3],
        ].map(([model, stance, slot]) => (
          <div
            key={model as string}
            style={paletteVars(slot as number)}
            className="flex items-start gap-2 rounded-lg border border-[var(--lore-border)] px-2.5 py-2"
          >
            <span className="pal-dot mt-1.5" />
            <span className="min-w-0">
              <span className="block text-[11.5px] font-semibold text-[var(--lore-text-tertiary)]">
                {model as string}
              </span>
              <span className="block text-[12.5px] leading-snug text-[var(--lore-text-primary)]">
                {stance as string}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-3">
        <p className="t-meta font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
          Could not agree
        </p>
        <p className="mt-1 text-[12.5px] leading-[1.6] text-[var(--lore-text-primary)]">
          Whether the discount is worth the commitment. All three raised the missing notice period
          unprompted — none of them was told it was unresolved.
        </p>
      </div>
    </CardShell>
  );
}

// ------------------------------------------------------------------ prophet

export function ProphetCard() {
  return (
    <CardShell>
      <Head>Prophet · it speaks first</Head>

      <div className="space-y-2">
        {[
          [Calendar, "in 18 minutes", "Pricing review with the vendor", "Last time you left the reseller discount unresolved. It still is, and four searches have asked for it since.", 2],
          [Bell, "since 2h ago", "The deploy rule changed under you", "Claude Code removed the line about red builds. You had signed that page off in March.", 0],
        ].map(([Icon, when, title, body, slot]) => {
          const I = Icon as typeof Bell;
          return (
            <div
              key={title as string}
              style={paletteVars(slot as number)}
              className="flex items-start gap-2.5 rounded-lg border border-[var(--lore-border)] p-3"
            >
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                style={{ background: "var(--plate)" }}
              >
                <I size={13} />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-[var(--lore-text-primary)]">
                    {title as string}
                  </span>
                  <span className="t-meta text-[var(--lore-text-tertiary)]">{when as string}</span>
                </span>
                <span className="mt-1 block text-[12.5px] leading-[1.6] text-[var(--lore-text-secondary)]">
                  {body as string}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        Built from what Ghost, Ledger and Oracle already indexed. Wave a card away twice and that
        kind stops appearing.
      </p>
    </CardShell>
  );
}

// -------------------------------------------------------- the wiki half

export function BriefCard() {
  return (
    <CardShell>
      <Head>Brief · what your agents wrote</Head>
      <p className="text-[13.5px] leading-[1.65] text-[var(--lore-text-primary)]">
        Your agents changed <strong>41 pages</strong> this week. Four of them changed something you
        had relied on.
      </p>
      <div className="mt-3 space-y-1.5">
        {[
          ["Deploy pipeline", "Claude Code", 12, 31, 0],
          ["Pricing policy", "Codex", 4, 18, 2],
          ["Client onboarding", "sync script", 22, 0, 1],
        ].map(([title, agent, added, removed, slot]) => (
          <div
            key={title as string}
            style={paletteVars(slot as number)}
            className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] px-2.5 py-2"
          >
            <span className="pal-bar !h-4" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--lore-text-primary)]">
              {title as string}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--lore-text-tertiary)]">
              {agent as string}
            </span>
            <span
              className="shrink-0 text-[11px] tabular-nums"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <span className="text-[var(--lore-success)]">+{added as number}</span>{" "}
              <span className="text-[var(--lore-danger)]">−{removed as number}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        612 lines deleted this week. Two of those changes reached a git commit.
      </p>
    </CardShell>
  );
}

export function AskCard() {
  return (
    <CardShell>
      <Head>Ask · answered from your own pages</Head>
      <Query text="What did we decide about session length, and why?" />
      <p className="mt-3 text-[13.5px] leading-[1.7] text-[var(--lore-text-primary)]">
        Session cookies, not JWTs — revocation was the deciding factor. Sessions live thirty days
        and refresh on use. That decision is eleven weeks old and nothing has contested it since.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {["stack/auth-decisions.md", "stack/glossary.md"].map((path) => (
          <span
            key={path}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-1.5 py-0.5 text-[11px] text-[var(--lore-text-secondary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <FileText size={9} />
            {path}
          </span>
        ))}
      </div>
      <p className="t-meta mt-2.5 border-t border-[var(--lore-border)] pt-2.5 text-[var(--lore-text-tertiary)]">
        Answered by a model on this machine · 2 pages read · nothing left the laptop
      </p>
    </CardShell>
  );
}

export function GapsCard() {
  return (
    <CardShell>
      <Head>Insights · what your wiki was asked for and did not have</Head>
      <div className="space-y-1.5">
        {[
          ["reseller discount", 4],
          ["refund window", 3],
          ["vendor payment terms", 2],
          ["notice period", 2],
        ].map(([query, asks]) => (
          <div
            key={query as string}
            className="flex items-center gap-2 rounded-lg border border-[var(--lore-border)] px-2.5 py-2"
          >
            <Search size={12} className="shrink-0 text-[var(--lore-text-tertiary)]" />
            <span
              className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {query as string}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--lore-text-tertiary)]">
              asked {asks as number}×
            </span>
          </div>
        ))}
      </div>
      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        Because your agents read the wiki through Lore, every empty search is logged. That list is
        what to write next.
      </p>
    </CardShell>
  );
}

export function WatchCard() {
  return (
    <CardShell>
      <Head>Watch · writes as they land</Head>
      <div className="space-y-1">
        {[
          ["14:12", "Claude Code", "rewrote", "stack/deploy-pipeline.md", 0],
          ["14:09", "Cursor", "appended", "operating/weekly-rhythm.md", 3],
          ["13:58", "Codex", "rewrote", "clients/pricing.md", 2],
          ["13:41", "sync script", "created", "clients/onboarding.md", 1],
          ["13:22", "you", "edited", "stack/glossary.md", 5],
        ].map(([at, who, verb, path, slot]) => (
          <div
            key={path as string}
            style={paletteVars(slot as number)}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--lore-border)] px-2.5 py-1.5"
          >
            <span className="pal-dot" />
            <span
              className="w-9 shrink-0 text-[10.5px] tabular-nums text-[var(--lore-text-tertiary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {at as string}
            </span>
            <span className="shrink-0 text-[12px] font-medium text-[var(--lore-text-primary)]">
              {who as string}
            </span>
            <span className="shrink-0 text-[10.5px] text-[var(--lore-text-tertiary)]">
              {verb as string}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--lore-text-secondary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {path as string}
            </span>
          </div>
        ))}
      </div>
      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        Nothing has to opt in, so nothing can quietly opt out.
      </p>
    </CardShell>
  );
}

/**
 * The terminal, with commands that exist.
 *
 * The first version of this card opened with `npx lore link ~/Documents/wiki`,
 * which is wrong twice: the CLI has no `link` verb — the folder is chosen in the
 * app — and the package is published as `lore-wiki`, so `npx lore` would fetch
 * somebody else's package entirely. Both invented, on the one element a
 * developer is most likely to copy.
 *
 * What is below is `lore brief`'s real output format, taken from the code in
 * bin/lore.mjs: a heading, then a bullet per change with the page and the agent
 * on the following line, then the totals.
 */
export function TerminalCard() {
  return (
    <CardShell className="bg-[#0d1117] p-0">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Terminal size={12} className="text-white/40" />
        <span
          className="text-[11px] text-white/40"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          ~/code/lore
        </span>
      </div>
      <pre
        className="overflow-x-auto px-3 py-3 text-[12px] leading-[1.8] text-white/85"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >{`$ npm install && npm run dev
  ready on http://127.0.0.1:4646

# point it at your folder in the app,
# then, from any terminal:

$ lore brief --days 7

What your agents wrote the last 7 days

  • The canary replaced the "never
    override a red build" rule.
    Deploy pipeline · Claude Code

  • Retainers now bill on the 15th.
    Pricing policy · Codex

41 writes across 12 pages.`}</pre>
    </CardShell>
  );
}
