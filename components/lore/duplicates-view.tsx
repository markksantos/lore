"use client";

import { useEffect, useMemo, useState } from "react";
import { CopyCheck, Loader2 } from "lucide-react";
import type { PageMeta, VaultIndex } from "@/lib/types";
import { paletteVars } from "@/lib/palette";
import { findNearDuplicates, type DuplicatePair } from "@/lib/similarity";
import { cn, count, formatCount } from "@/lib/utils";

type FolderSection = { page: PageMeta; raw: string };
type FolderResponse = { sections: FolderSection[]; hasMore: boolean };
type Doc = { id: string; title: string; text: string };

type Phase =
  | { kind: "reading"; done: number; total: number }
  | { kind: "comparing"; docs: number }
  | { kind: "done"; docs: number }
  | { kind: "error"; message: string };

/** Folders are read a few at a time: enough concurrency to keep the network
 *  busy, few enough that a 200-folder vault doesn't open 200 sockets. */
const FOLDER_BATCH = 4;
const PAGE_SIZE = 40;

/** `/api/folder` is paginated and defaults to 40 sections. Asking for its
 *  maximum keeps the number of round trips down; the folder is still read to
 *  the end regardless of how many that takes. */
const FOLDER_LIMIT = 200;

/** YAML frontmatter is boilerplate every note shares the shape of — left in, two
 *  unrelated notes score as similar on their tag lists alone. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

/** Yield to the browser between work units. requestIdleCallback where it exists
 *  (Safari still doesn't), a macrotask everywhere else — either way the frame
 *  gets to paint before the next chunk runs. */
function whenIdle(run: () => void): void {
  const view = window as IdleWindow;
  if (typeof view.requestIdleCallback === "function") view.requestIdleCallback(run, { timeout: 200 });
  else window.setTimeout(run, 0);
}

/**
 * Duplicates — the same thing said twice.
 *
 * A wiki that agents write into drifts toward restatement: a policy gets
 * appended to one note, then written again in another, and neither side knows
 * about the other. Nothing in a file tree shows you that. This does, and it
 * shows both texts side by side with the overlapping wording marked, because
 * the only useful next step is deciding which one survives.
 */
export function DuplicatesView({
  index,
  onOpenPage,
}: {
  index: VaultIndex;
  onOpenPage: (pageId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "reading", done: 0, total: 0 });
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [bodies, setBodies] = useState<Map<string, string>>(new Map());
  const [visible, setVisible] = useState(PAGE_SIZE);

  const metaById = useMemo(
    () => new Map(index.pages.map((page) => [page.id, page] as const)),
    [index.pages],
  );

  // Keyed on the scan timestamp rather than the index object: a re-render that
  // hands back an equal-but-new index must not restart a full vault read.
  useEffect(() => {
    const controller = new AbortController();
    const folders = index.folders.map((folder) => folder.folder);
    const docs: Doc[] = [];
    let cancelled = false;
    let cursor = 0;

    setPairs([]);
    setBodies(new Map());
    setVisible(PAGE_SIZE);
    setPhase(
      folders.length === 0
        ? { kind: "done", docs: 0 }
        : { kind: "reading", done: 0, total: folders.length },
    );

    /** One folder, all of it. The endpoint pages, so a folder holding more
     *  sections than a single response can carry has to be walked to the end —
     *  otherwise the pages past the first response are never compared and the
     *  view quietly reports duplicates over a subset of the vault. */
    async function readFolder(folder: string): Promise<FolderSection[]> {
      const collected: FolderSection[] = [];
      for (let offset = 0; !cancelled; offset += FOLDER_LIMIT) {
        const response = await fetch(
          `/api/folder?path=${encodeURIComponent(folder)}&offset=${offset}&limit=${FOLDER_LIMIT}`,
          { signal: controller.signal },
        );
        if (!response.ok) break;
        const body = (await response.json()) as FolderResponse;
        collected.push(...body.sections);
        if (!body.hasMore || body.sections.length === 0) break;
      }
      return collected;
    }

    async function readBatch() {
      const batch = folders.slice(cursor, cursor + FOLDER_BATCH);
      cursor += batch.length;

      const sections = await Promise.all(batch.map(readFolder));
      if (cancelled) return;

      for (const section of sections.flat()) {
        docs.push({
          id: section.page.id,
          title: section.page.title,
          text: section.raw.replace(FRONTMATTER, ""),
        });
      }

      setPhase({ kind: "reading", done: cursor, total: folders.length });
      whenIdle(cursor < folders.length ? step : compare);
    }

    function compare() {
      if (cancelled) return;
      setPhase({ kind: "comparing", docs: docs.length });
      // A second hop, deliberately: the "comparing" frame has to paint before
      // the synchronous MinHash pass starts, or the user stares at the old
      // progress bar for the whole comparison.
      whenIdle(() => {
        if (cancelled) return;
        setBodies(new Map(docs.map((doc) => [doc.id, doc.text] as const)));
        setPairs(findNearDuplicates(docs));
        setPhase({ kind: "done", docs: docs.length });
      });
    }

    function step() {
      if (cancelled) return;
      readBatch().catch((error: unknown) => {
        if (cancelled) return;
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not read the vault.",
        });
      });
    }

    if (folders.length > 0) whenIdle(step);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [index.scannedAt, index.folders]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Duplicates
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Pages that say the same thing in slightly different words. Agents restate rather
          than copy, so this compares wording, not filenames.
        </p>
      </header>

      {phase.kind === "error" ? (
        <p className="t-body rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4 text-[var(--lore-danger)]">
          {phase.message}
        </p>
      ) : phase.kind === "done" ? (
        <Results
          pairs={pairs}
          docs={phase.docs}
          bodies={bodies}
          metaById={metaById}
          visible={visible}
          onShowMore={() => setVisible((count) => count + PAGE_SIZE)}
          onOpenPage={onOpenPage}
        />
      ) : (
        <Progress phase={phase} />
      )}
    </div>
  );
}

function Progress({ phase }: { phase: Extract<Phase, { kind: "reading" | "comparing" }> }) {
  const reading = phase.kind === "reading";
  const ratio = reading && phase.total > 0 ? phase.done / phase.total : 1;

  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-5">
      <div className="flex items-center gap-2.5">
        <Loader2 size={14} className="animate-spin text-[var(--lore-text-tertiary)]" />
        <p className="text-[15px] text-[var(--lore-text-primary)]">
          {reading
            ? `Reading folder ${formatCount(Math.min(phase.done + 1, phase.total))} of ${formatCount(phase.total)}`
            : `Comparing ${count(phase.docs, "page")}`}
        </p>
      </div>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-[var(--lore-surface-raised)]">
        <div
          className={cn(
            "h-full rounded-full bg-[var(--lore-accent)] transition-[width] duration-300",
            !reading && "animate-pulse",
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        {reading
          ? "Every page body has to be read once — the comparison is on prose, not on the index."
          : "Only pages that share wording are compared in full, so this stays quick as the vault grows."}
      </p>
    </section>
  );
}

function Results({
  pairs,
  docs,
  bodies,
  metaById,
  visible,
  onShowMore,
  onOpenPage,
}: {
  pairs: DuplicatePair[];
  docs: number;
  bodies: Map<string, string>;
  metaById: Map<string, PageMeta>;
  visible: number;
  onShowMore: () => void;
  onOpenPage: (pageId: string) => void;
}) {
  if (pairs.length === 0) {
    return (
      <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-8 text-center">
        <CopyCheck size={20} className="mx-auto text-[var(--lore-success)]" />
        <p className="mt-3 text-[15px] font-medium text-[var(--lore-text-primary)]">
          No overlapping pages
        </p>
        <p className="t-body mt-1 text-[var(--lore-text-secondary)]">
          Nothing in {count(docs, "page")} shares more than a third of its wording with
          anything else.
        </p>
      </section>
    );
  }

  return (
    <>
      <p className="t-meta mb-3.5 text-[var(--lore-text-tertiary)]">
        {formatCount(pairs.length)} {pairs.length === 1 ? "pair" : "pairs"} across{" "}
        {count(docs, "page")}, most overlapping first.
      </p>

      <div className="space-y-3.5">
        {pairs.slice(0, visible).map((pair, position) => (
          <PairCard
            key={`${pair.a}|${pair.b}`}
            pair={pair}
            slot={position}
            bodies={bodies}
            metaById={metaById}
            onOpenPage={onOpenPage}
          />
        ))}
      </div>

      {pairs.length > visible ? (
        <button
          type="button"
          onClick={onShowMore}
          className="mt-4 inline-flex h-9 items-center rounded-lg border border-[var(--lore-border)] px-3.5 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
        >
          Show {formatCount(Math.min(PAGE_SIZE, pairs.length - visible))} more
        </button>
      ) : null}
    </>
  );
}

function PairCard({
  pair,
  slot,
  bodies,
  metaById,
  onOpenPage,
}: {
  pair: DuplicatePair;
  slot: number;
  bodies: Map<string, string>;
  metaById: Map<string, PageMeta>;
  onOpenPage: (pageId: string) => void;
}) {
  return (
    <article
      style={paletteVars(slot)}
      className="overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]"
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-[var(--lore-border)] px-4 py-2.5">
        <span className="pal-dot" />
        <span className="pal-chip rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums">
          {Math.round(pair.score * 100)}% overlap
        </span>
        <span className="t-meta min-w-0 truncate text-[var(--lore-text-tertiary)]">
          {pair.shared.length > 0
            ? `${pair.shared.length} shared ${pair.shared.length === 1 ? "passage" : "passages"}`
            : "shared wording throughout"}
        </span>
      </header>

      {/* gap-px over a border colour draws the hairline between the two sides
          without a rule that has to know which side it belongs to. */}
      <div className="grid gap-px bg-[var(--lore-border)] sm:grid-cols-2">
        <Side
          pageId={pair.a}
          meta={metaById.get(pair.a)}
          text={bodies.get(pair.a) ?? ""}
          phrases={pair.shared}
          onOpenPage={onOpenPage}
        />
        <Side
          pageId={pair.b}
          meta={metaById.get(pair.b)}
          text={bodies.get(pair.b) ?? ""}
          phrases={pair.shared}
          onOpenPage={onOpenPage}
        />
      </div>

      {pair.shared.length > 0 ? (
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-4 py-2.5">
          <span className="t-meta mr-1 text-[var(--lore-text-tertiary)]">In common</span>
          {pair.shared.map((phrase) => (
            <span
              key={phrase}
              className="pal-chip max-w-full truncate rounded-md px-2 py-0.5 text-[11px] font-medium"
            >
              {phrase}
            </span>
          ))}
        </footer>
      ) : null}
    </article>
  );
}

function Side({
  pageId,
  meta,
  text,
  phrases,
  onOpenPage,
}: {
  pageId: string;
  meta: PageMeta | undefined;
  text: string;
  phrases: string[];
  onOpenPage: (pageId: string) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden bg-[var(--lore-surface)] px-4 py-3.5">
      <button
        type="button"
        onClick={() => onOpenPage(pageId)}
        className="block w-full min-w-0 truncate text-left text-[15px] font-semibold text-[var(--lore-text-primary)] transition-colors hover:text-[var(--lore-accent)]"
      >
        {meta?.title ?? pageId}
      </button>
      <p className="t-meta mt-0.5 truncate text-[var(--lore-text-tertiary)]">
        {meta ? `${meta.folder || "root"} · ${formatCount(meta.words)} words` : pageId}
      </p>
      <Snippet text={text} phrases={phrases} />
    </div>
  );
}

type Segment = { text: string; hit: boolean };

const SNIPPET_LENGTH = 420;
const SNIPPET_LEAD = 110;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The phrases come back from the shingler as bare words, but the page they came
 * from has punctuation, newlines and markdown between them — so each phrase is
 * matched as its words separated by any run of non-word characters rather than
 * as a literal substring.
 */
function phraseRegExp(phrases: string[]): RegExp | null {
  const usable = phrases.filter((phrase) => phrase.trim().length > 0);
  if (usable.length === 0) return null;
  const alternatives = [...usable]
    // Longest first so an overlapping short phrase can't win the match and
    // leave the rest of a passage unmarked.
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.trim().split(/\s+/).map(escapeRegExp).join("[^A-Za-z0-9']+"));
  return new RegExp(alternatives.join("|"), "gi");
}

function snippetSegments(text: string, phrases: string[]): Segment[] {
  // Collapsed to one line: this is a proof, not a rendering of the note, and
  // markdown's blank lines would otherwise eat most of the window.
  const flat = text.replace(/\s+/g, " ").trim();
  const pattern = phraseRegExp(phrases);
  if (!pattern) return [{ text: flat.slice(0, SNIPPET_LENGTH), hit: false }];

  pattern.lastIndex = 0;
  const first = pattern.exec(flat);

  // Open on the first shared passage rather than on the top of the page: the
  // overlap is usually buried, and a snippet that doesn't contain it proves
  // nothing.
  let start = Math.max(0, (first?.index ?? 0) - SNIPPET_LEAD);
  if (start > 0) {
    const boundary = flat.indexOf(" ", start);
    start = boundary === -1 ? start : boundary + 1;
  }
  let end = Math.min(flat.length, start + SNIPPET_LENGTH);
  if (end < flat.length) {
    const boundary = flat.lastIndexOf(" ", end);
    end = boundary > start ? boundary : end;
  }

  const window = flat.slice(start, end);
  const segments: Segment[] = [];
  let cursor = 0;

  pattern.lastIndex = 0;
  for (const match of window.matchAll(pattern)) {
    const at = match.index;
    if (at > cursor) segments.push({ text: window.slice(cursor, at), hit: false });
    segments.push({ text: match[0], hit: true });
    cursor = at + match[0].length;
  }
  if (cursor < window.length) segments.push({ text: window.slice(cursor), hit: false });

  if (start > 0) segments.unshift({ text: "… ", hit: false });
  if (end < flat.length) segments.push({ text: " …", hit: false });
  return segments;
}

function Snippet({ text, phrases }: { text: string; phrases: string[] }) {
  const segments = useMemo(() => snippetSegments(text, phrases), [text, phrases]);

  if (segments.length === 0) return null;

  return (
    <p className="t-meta mt-2.5 break-words text-[var(--lore-text-secondary)]">
      {segments.map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="pal-chip rounded-[4px] px-[3px] py-[1px]">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
