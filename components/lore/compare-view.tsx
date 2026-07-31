"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diffWords } from "diff";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Columns2,
  GitCompare,
  Link2,
  Loader2,
  Search,
  Unlink2,
} from "lucide-react";
import type { PageMeta, VaultIndex } from "@/lib/types";
import { paletteVars, slotForKey } from "@/lib/palette";
import { renderMarkdown, stripFrontmatter, stripLeadingTitle } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/** A page fetched for one side, already stripped down to renderable body text. */
type Doc = { relPath: string; title: string; body: string };

type PageResponse = { page: PageMeta; raw: string };

type Mode = "read" | "diff";
type Side = "left" | "right";

/**
 * Compare — two pages, side by side.
 *
 * The reason this exists is that a wiki drifts: the same fact ends up written
 * twice, in two folders, in two voices, and you can't tell which one is current
 * by reading them one after the other. Reading mode is for judging tone and
 * structure; diff mode answers the narrower question of what actually differs,
 * word for word.
 */
export function CompareView({
  index,
  pageTitles,
}: {
  index: VaultIndex;
  pageTitles: Map<string, string>;
}) {
  const [leftPath, setLeftPath] = useState<string | null>(null);
  const [rightPath, setRightPath] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("read");
  const [syncScroll, setSyncScroll] = useState(true);

  // Loaded bodies are kept by path rather than by side, so swapping — or
  // re-picking a page you looked at a minute ago — is instant and never flashes
  // an empty pane while a request you already made comes back a second time.
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    const wanted = [leftPath, rightPath].filter(
      (path): path is string =>
        path !== null && !(path in docs) && !(path in errors) && !inFlight.current.has(path),
    );

    for (const relPath of wanted) {
      inFlight.current.add(relPath);
      fetch(`/api/page?path=${encodeURIComponent(relPath)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("That page could not be read.");
          return (await response.json()) as PageResponse;
        })
        .then((payload) => {
          inFlight.current.delete(relPath);
          setDocs((prev) => ({
            ...prev,
            [relPath]: {
              relPath,
              title: payload.page.title,
              // Stripped once here: both the reader and the diff want the body
              // without frontmatter or a duplicate H1, and diffing metadata
              // would report noise as a difference.
              body: stripLeadingTitle(stripFrontmatter(payload.raw), payload.page.title),
            },
          }));
        })
        .catch((error: unknown) => {
          inFlight.current.delete(relPath);
          setErrors((prev) => ({
            ...prev,
            [relPath]: error instanceof Error ? error.message : "That page could not be read.",
          }));
        });
    }
    // No abort on cleanup: a result is stored against the path that asked for
    // it, so a request that lands after the user has moved on is still correct
    // data for the next time that path is picked.
  }, [leftPath, rightPath, docs, errors]);

  const left = leftPath ? (docs[leftPath] ?? null) : null;
  const right = rightPath ? (docs[rightPath] ?? null) : null;
  const leftError = leftPath ? (errors[leftPath] ?? null) : null;
  const rightError = rightPath ? (errors[rightPath] ?? null) : null;
  const bothChosen = leftPath !== null && rightPath !== null;
  const bothLoaded = left !== null && right !== null;

  const leftHtml = useMemo(
    () => (left ? renderMarkdown(left.body, pageTitles) : ""),
    [left, pageTitles],
  );
  const rightHtml = useMemo(
    () => (right ? renderMarkdown(right.body, pageTitles) : ""),
    [right, pageTitles],
  );

  // Word diffing a long note is not free, so it only runs in the mode that
  // shows it.
  const changes = useMemo(
    () => (mode === "diff" && left && right ? diffWords(left.body, right.body) : null),
    [mode, left, right],
  );

  const tally = useMemo(() => {
    if (!changes) return null;
    let added = 0;
    let removed = 0;
    for (const change of changes) {
      if (change.added) added += change.count;
      else if (change.removed) removed += change.count;
    }
    return { added, removed };
  }, [changes]);

  const leftScroll = useRef<HTMLDivElement | null>(null);
  const rightScroll = useRef<HTMLDivElement | null>(null);
  // Which pane is currently driving. Without it, pane A scrolls pane B, whose
  // own scroll handler scrolls A back, and the two fight each other into a
  // stutter — the classic split-view feedback loop.
  const driver = useRef<Side | null>(null);
  const release = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (release.current !== null) window.clearTimeout(release.current);
    };
  }, []);

  const mirrorScroll = useCallback(
    (source: Side) => {
      if (!syncScroll || mode !== "read") return;
      if (driver.current !== null && driver.current !== source) return;

      const from = source === "left" ? leftScroll.current : rightScroll.current;
      const to = source === "left" ? rightScroll.current : leftScroll.current;
      if (!from || !to) return;

      const fromRange = from.scrollHeight - from.clientHeight;
      const toRange = to.scrollHeight - to.clientHeight;
      // Proportional, not absolute: the two documents are rarely the same
      // length, and matching pixel offsets would run the shorter one out
      // halfway down the longer one.
      to.scrollTop = fromRange <= 0 ? 0 : (from.scrollTop / fromRange) * toRange;

      driver.current = source;
      if (release.current !== null) window.clearTimeout(release.current);
      // Assigning scrollTop fires the other pane's scroll event
      // asynchronously; the lock has to outlive that echo, not just this call.
      release.current = window.setTimeout(() => {
        driver.current = null;
      }, 120);
    },
    [syncScroll, mode],
  );

  // Turning sync on mid-read should align the panes immediately rather than
  // waiting for the next scroll gesture.
  useEffect(() => {
    mirrorScroll("left");
  }, [mirrorScroll]);

  function swap() {
    setLeftPath(rightPath);
    setRightPath(leftPath);
  }

  return (
    <div className="flex h-full min-h-[34rem] flex-col px-6 py-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
            Compare
          </h1>
          <p className="t-body mt-1 text-[var(--lore-text-secondary)]">
            Two pages, side by side — or word for word.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-[var(--lore-border)] p-0.5">
            <ModeButton
              active={mode === "read"}
              onClick={() => setMode("read")}
              icon={<Columns2 size={13} />}
              label="Read"
            />
            <ModeButton
              active={mode === "diff"}
              onClick={() => setMode("diff")}
              disabled={!bothLoaded}
              icon={<GitCompare size={13} />}
              label="Diff"
            />
          </div>

          <button
            type="button"
            onClick={() => setSyncScroll((on) => !on)}
            disabled={mode !== "read"}
            aria-pressed={syncScroll}
            title={syncScroll ? "Scrolling is linked" : "Panes scroll independently"}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors disabled:opacity-40",
              syncScroll
                ? "border-[var(--lore-accent)] bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
                : "border-[var(--lore-border)] text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
            )}
          >
            {syncScroll ? <Link2 size={13} /> : <Unlink2 size={13} />}
            Sync
          </button>

          <button
            type="button"
            onClick={swap}
            disabled={!bothChosen}
            title="Swap sides"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-40"
          >
            <ArrowLeftRight size={13} />
            Swap
          </button>
        </div>
      </header>

      {/* The pickers sit above the panes, not inside them: a pane clips its own
          overflow so a dropdown opened within one would be cut off. */}
      <div className="relative z-20 mt-5 grid gap-3 md:grid-cols-2">
        <PagePicker
          label="Left"
          pages={index.pages}
          value={leftPath}
          onChange={setLeftPath}
        />
        <PagePicker
          label="Right"
          pages={index.pages}
          value={rightPath}
          onChange={setRightPath}
        />
      </div>

      {!bothChosen ? (
        <EmptyState chosen={(leftPath ? 1 : 0) + (rightPath ? 1 : 0)} />
      ) : mode === "diff" ? (
        <Pane className="mt-3">
          <PaneHeader
            title="Word diff"
            meta={
              tally
                ? `${tally.added} added · ${tally.removed} removed`
                : "Reading both pages…"
            }
          />
          <div className="lore-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {changes ? (
              <div
                className="whitespace-pre-wrap break-words text-[13px] leading-[1.75] text-[var(--lore-text-primary)]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {changes.map((change, i) =>
                  change.added ? (
                    <ins
                      key={i}
                      className="rounded-[3px] no-underline"
                      style={{
                        background: "color-mix(in srgb, var(--lore-success) 22%, transparent)",
                      }}
                    >
                      {change.value}
                    </ins>
                  ) : change.removed ? (
                    <del
                      key={i}
                      className="rounded-[3px] decoration-1"
                      style={{
                        background: "color-mix(in srgb, var(--lore-danger) 20%, transparent)",
                      }}
                    >
                      {change.value}
                    </del>
                  ) : (
                    <span key={i} className="text-[var(--lore-text-secondary)]">
                      {change.value}
                    </span>
                  ),
                )}
              </div>
            ) : (leftError ?? rightError) ? (
              <p className="t-body text-[var(--lore-danger)]">{leftError ?? rightError}</p>
            ) : (
              <Waiting />
            )}
          </div>
        </Pane>
      ) : (
        // Explicit rows so the stacked mobile layout splits the available
        // height instead of letting two content-sized rows overflow it.
        <div className="mt-3 grid min-h-0 flex-1 grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1">
          <ReadPane
            doc={left}
            html={leftHtml}
            error={leftError}
            scrollRef={leftScroll}
            onScroll={() => mirrorScroll("left")}
          />
          <ReadPane
            doc={right}
            html={rightHtml}
            error={rightError}
            scrollRef={rightScroll}
            onScroll={() => mirrorScroll("right")}
          />
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors disabled:opacity-40",
        active
          ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
          : "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Pane({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

function PaneHeader({
  title,
  meta,
  slot,
}: {
  title: string;
  meta: string;
  slot?: number;
}) {
  return (
    <div
      style={slot === undefined ? undefined : paletteVars(slot)}
      className="flex min-w-0 items-center gap-2.5 border-b border-[var(--lore-border)] px-4 py-2.5"
    >
      {slot === undefined ? null : <span className="pal-dot" />}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[15px] font-semibold",
          slot === undefined ? "text-[var(--lore-text-primary)]" : "pal-title",
        )}
      >
        {title}
      </span>
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
        {meta}
      </span>
    </div>
  );
}

function ReadPane({
  doc,
  html,
  error,
  scrollRef,
  onScroll,
}: {
  doc: Doc | null;
  html: string;
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  return (
    <Pane>
      {doc ? (
        <PaneHeader title={doc.title} meta={doc.relPath} slot={slotForKey(doc.relPath)} />
      ) : null}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="lore-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        {error ? (
          <p className="t-body text-[var(--lore-danger)]">{error}</p>
        ) : doc ? (
          <div className="lore-prose text-[15px]" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <Waiting />
        )}
      </div>
    </Pane>
  );
}

function Waiting() {
  return (
    <div className="flex justify-center py-8 text-[var(--lore-text-tertiary)]">
      <Loader2 size={16} className="animate-spin" />
    </div>
  );
}

function EmptyState({ chosen }: { chosen: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <span
        style={paletteVars(4)}
        className="pal-chip flex h-11 w-11 items-center justify-center rounded-xl"
      >
        <Columns2 size={18} />
      </span>
      <p className="mt-3.5 text-[15px] font-medium text-[var(--lore-text-primary)]">
        {chosen === 0 ? "Pick a page for each side" : "Pick the second page"}
      </p>
      <p className="t-meta mt-1 max-w-sm text-[var(--lore-text-tertiary)]">
        Read them side by side, or switch to Diff to see exactly which words moved.
      </p>
    </div>
  );
}

/**
 * Searchable page picker.
 *
 * A plain `<select>` is unusable past a few dozen notes and shows only titles —
 * and a wiki reliably contains two pages called "Overview". Filtering matches
 * the path as well as the title, and every row shows its path, so the two are
 * always tellable apart.
 */
function PagePicker({
  label,
  pages,
  value,
  onChange,
}: {
  label: string;
  pages: PageMeta[];
  value: string | null;
  onChange: (relPath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = useMemo(
    () => pages.find((page) => page.relPath === value) ?? null,
    [pages, value],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? pages.filter(
          (page) =>
            page.title.toLowerCase().includes(q) || page.relPath.toLowerCase().includes(q),
        )
      : pages;
    // Capped because an open dropdown holding every page in a large vault is
    // slow to paint; typing is the way through the rest.
    return hits.slice(0, 60);
  }, [pages, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function pick(page: PageMeta) {
    onChange(page.relPath);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const page = matches[active];
      if (page) pick(page);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] px-3 text-left transition-colors hover:border-[var(--lore-border-strong)]"
      >
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--lore-text-primary)]">
          {selected ? selected.title : <span className="text-[var(--lore-text-tertiary)]">Choose a page</span>}
        </span>
        <ChevronDown size={14} className="shrink-0 text-[var(--lore-text-tertiary)]" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border border-[var(--lore-border-strong)] bg-[var(--lore-surface)] shadow-lg">
          <div className="flex items-center gap-2 border-b border-[var(--lore-border)] px-3">
            <Search size={13} className="shrink-0 text-[var(--lore-text-tertiary)]" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={`compare-list-${label}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Filter by title or path"
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--lore-text-primary)] outline-none placeholder:text-[var(--lore-text-tertiary)]"
            />
          </div>

          {matches.length === 0 ? (
            <p className="t-meta px-3 py-3 text-[var(--lore-text-tertiary)]">No page matches.</p>
          ) : (
            <ul
              id={`compare-list-${label}`}
              ref={listRef}
              role="listbox"
              className="lore-scrollbar max-h-72 overflow-y-auto py-1"
            >
              {matches.map((page, i) => (
                <li key={page.id} role="option" aria-selected={page.relPath === value}>
                  <button
                    type="button"
                    onClick={() => pick(page)}
                    onMouseEnter={() => setActive(i)}
                    style={paletteVars(slotForKey(page.relPath))}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                      i === active ? "bg-[var(--lore-surface-raised)]" : "",
                    )}
                  >
                    <span className="pal-dot" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--lore-text-primary)]">
                      {page.title}
                    </span>
                    <span
                      className="hidden shrink-0 truncate text-[11px] text-[var(--lore-text-tertiary)] sm:block"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      {page.relPath}
                    </span>
                    {page.relPath === value ? (
                      <Check size={12} className="shrink-0 text-[var(--lore-accent)]" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
