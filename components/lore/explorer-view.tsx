"use client";

import { Children, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import type { PageMeta, VaultIndex } from "@/lib/types";
import { paletteVars } from "@/lib/palette";
import { cn, formatCount, relativeTime } from "@/lib/utils";

/** Matches the default review window used by the health report in lib/wiki.ts. */
const STALE_MS = 180 * 24 * 60 * 60 * 1000;

/** The four derived states. Bits, not strings, so a page's whole status set is
 *  one integer and the counting pass can test membership without allocating. */
const ORPHAN = 1;
const UNTAGGED = 2;
const STALE = 4;
const HAS_LINKS = 8;

const STATUSES = [
  { bit: ORPHAN, label: "Orphan", hint: "nothing links in, links nowhere" },
  { bit: UNTAGGED, label: "Untagged", hint: "no tags at all" },
  { bit: STALE, label: "Stale", hint: "untouched 180+ days" },
  { bit: HAS_LINKS, label: "Has links", hint: "links out to other pages" },
] as const;

type SortKey = "title" | "folder" | "tags" | "words" | "mtime" | "backlinks";
type SortDir = "asc" | "desc";

/** Text columns read best ascending; counts and dates read best largest-first. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  title: "asc",
  folder: "asc",
  tags: "asc",
  words: "desc",
  mtime: "desc",
  backlinks: "desc",
};

const COLUMNS: { key: SortKey; label: string; numeric: boolean; className: string }[] = [
  { key: "title", label: "Title", numeric: false, className: "" },
  { key: "folder", label: "Folder", numeric: false, className: "hidden md:table-cell" },
  { key: "tags", label: "Tags", numeric: false, className: "hidden lg:table-cell" },
  { key: "words", label: "Words", numeric: true, className: "hidden sm:table-cell" },
  { key: "mtime", label: "Last edited", numeric: true, className: "" },
  { key: "backlinks", label: "Links in", numeric: true, className: "hidden sm:table-cell" },
];

/** Rendering every row of a big wiki costs more than anyone reads. */
const ROW_CAP = 200;

/** Everything about a page the explorer needs, precomputed once per index so
 *  the filtering pass does no string work beyond the text match. */
type Row = {
  page: PageMeta;
  statusMask: number;
  backlinks: number;
  /** Lower-cased title + path + tags, joined — the text filter's haystack. */
  haystack: string;
  tagLabel: string;
};

/**
 * Explorer — browse the wiki by clicking instead of querying.
 *
 * Facets combine as AND across the three rails and OR inside one, which is what
 * people expect from a shopping filter: picking two tags widens, picking a tag
 * and a folder narrows. Every option carries the count it would produce, and an
 * option that would empty the screen is disabled rather than merely warned
 * about — a dead end is a bug, not a result.
 */
export function ExplorerView({
  index,
  onOpenPage,
}: {
  index: VaultIndex;
  onOpenPage: (pageId: string) => void;
}) {
  const [folders, setFolders] = useState<ReadonlySet<string>>(() => new Set());
  const [tags, setTags] = useState<ReadonlySet<string>>(() => new Set());
  const [statusMaskSel, setStatusMaskSel] = useState(0);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "mtime",
    dir: "desc",
  });

  // Staleness is measured against one instant captured on mount. Reading the
  // clock inside the memo would make an otherwise pure computation re-run with
  // different answers on every render.
  const now = useRef(Date.now()).current;

  const rows = useMemo<Row[]>(
    () =>
      index.pages.map((page) => {
        const backlinks = index.backlinks[page.id]?.length ?? 0;
        let statusMask = 0;
        if (backlinks === 0 && page.links.length === 0) statusMask |= ORPHAN;
        if (page.tags.length === 0) statusMask |= UNTAGGED;
        if (now - page.mtime > STALE_MS) statusMask |= STALE;
        if (page.links.length > 0) statusMask |= HAS_LINKS;
        return {
          page,
          statusMask,
          backlinks,
          haystack: `${page.title} ${page.relPath} ${page.tags.join(" ")}`.toLowerCase(),
          tagLabel: page.tags.join(", "),
        };
      }),
    [index.pages, index.backlinks, now],
  );

  const needle = text.trim().toLowerCase();

  /**
   * One pass produces both the result set and every facet count.
   *
   * A facet's own selection is excluded from its own counts — that is what lets
   * you see "and 12 more in Clients" while Clients is already picked, instead of
   * every unpicked option reading zero. The text filter is folded into all three
   * counts so a search can never leave a clickable option that yields nothing.
   */
  const { results, folderCounts, tagCounts, statusCounts } = useMemo(() => {
    const folderCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const statusCounts = new Map<number, number>();
    const results: Row[] = [];

    for (const row of rows) {
      if (needle && !row.haystack.includes(needle)) continue;

      const okFolder = folders.size === 0 || folders.has(row.page.folder);
      const okTag = tags.size === 0 || row.page.tags.some((t) => tags.has(t));
      const okStatus = statusMaskSel === 0 || (row.statusMask & statusMaskSel) !== 0;

      if (okTag && okStatus) {
        folderCounts.set(row.page.folder, (folderCounts.get(row.page.folder) ?? 0) + 1);
      }
      if (okFolder && okStatus) {
        for (const tag of row.page.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      if (okFolder && okTag) {
        for (const { bit } of STATUSES) {
          if (row.statusMask & bit) statusCounts.set(bit, (statusCounts.get(bit) ?? 0) + 1);
        }
      }
      if (okFolder && okTag && okStatus) results.push(row);
    }

    return { results, folderCounts, tagCounts, statusCounts };
  }, [rows, folders, tags, statusMaskSel, needle]);

  const sorted = useMemo(() => {
    const factor = sort.dir === "asc" ? 1 : -1;
    // Sorting a copy: `results` is memoised and reused by the count pass above.
    return [...results].sort((a, b) => {
      switch (sort.key) {
        case "title":
          return factor * a.page.title.localeCompare(b.page.title);
        case "folder":
          return (
            factor * (a.page.folder.localeCompare(b.page.folder) ||
              a.page.title.localeCompare(b.page.title))
          );
        case "tags":
          return factor * (a.tagLabel.localeCompare(b.tagLabel) || a.page.title.localeCompare(b.page.title));
        case "words":
          return factor * (a.page.words - b.page.words);
        case "mtime":
          return factor * (a.page.mtime - b.page.mtime);
        case "backlinks":
          return factor * (a.backlinks - b.backlinks);
      }
    });
  }, [results, sort]);

  const shown = sorted.slice(0, ROW_CAP);
  const selectedCount = folders.size + tags.size + countBits(statusMaskSel);

  function toggle<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  }

  function clearAll() {
    setFolders(new Set());
    setTags(new Set());
    setStatusMaskSel(0);
  }

  function onSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: DEFAULT_DIR[key] },
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-9">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Explorer
        </h1>
        <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
          Click your way through the wiki. Filters stack, and an option that would empty the
          screen is never clickable.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="relative flex h-9 min-w-0 flex-1 basis-64 items-center">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 text-[var(--lore-text-tertiary)]"
          />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Filter these results…"
            className="h-9 w-full min-w-0 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] pl-8 pr-3 text-[13px] text-[var(--lore-text-primary)] outline-none transition-colors placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)]"
          />
        </label>

        {selectedCount > 0 || needle ? (
          <span className="t-meta shrink-0 tabular-nums text-[var(--lore-text-tertiary)]">
            {formatCount(results.length)} of {formatCount(index.pages.length)}
          </span>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          {[...folders].map((folder) => (
            <Chip
              key={`f-${folder}`}
              slot={0}
              label={folder || "root"}
              onRemove={() => setFolders((s) => toggle(s, folder))}
            />
          ))}
          {[...tags].map((tag) => (
            <Chip
              key={`t-${tag}`}
              slot={5}
              label={`#${tag}`}
              onRemove={() => setTags((s) => toggle(s, tag))}
            />
          ))}
          {STATUSES.filter(({ bit }) => statusMaskSel & bit).map(({ bit, label }) => (
            <Chip
              key={`s-${bit}`}
              slot={6}
              label={label}
              onRemove={() => setStatusMaskSel((m) => m ^ bit)}
            />
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="h-6 rounded-md px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-primary)]"
          >
            Clear all
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full min-w-0 shrink-0 space-y-5 lg:w-60">
          <Rail slot={0} title="Folder">
            {index.folders.map(({ folder }) => (
              <Option
                key={folder}
                label={folder || "root"}
                count={folderCounts.get(folder) ?? 0}
                selected={folders.has(folder)}
                onToggle={() => setFolders((s) => toggle(s, folder))}
              />
            ))}
          </Rail>

          <Rail slot={5} title="Tag">
            {index.tags.map(({ tag }) => (
              <Option
                key={tag}
                label={`#${tag}`}
                count={tagCounts.get(tag) ?? 0}
                selected={tags.has(tag)}
                onToggle={() => setTags((s) => toggle(s, tag))}
              />
            ))}
          </Rail>

          <Rail slot={6} title="Status">
            {STATUSES.map(({ bit, label, hint }) => (
              <Option
                key={bit}
                label={label}
                hint={hint}
                count={statusCounts.get(bit) ?? 0}
                selected={(statusMaskSel & bit) !== 0}
                onToggle={() => setStatusMaskSel((m) => m ^ bit)}
              />
            ))}
          </Rail>
        </aside>

        <section className="min-w-0 flex-1">
          {shown.length === 0 ? (
            <div className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-10 text-center">
              <p className="t-body text-[var(--lore-text-secondary)]">
                {needle ? `Nothing matches “${text.trim()}”.` : "No pages here yet."}
              </p>
              {needle ? (
                <button
                  type="button"
                  onClick={() => setText("")}
                  className="mt-2 text-[13px] font-medium text-[var(--lore-accent)]"
                >
                  Clear the text filter
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="lore-scrollbar overflow-x-auto rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
                <table className="w-full min-w-[34rem] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[var(--lore-border)]">
                      {COLUMNS.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          aria-sort={
                            sort.key === column.key
                              ? sort.dir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          className={cn("p-0", column.className)}
                        >
                          <button
                            type="button"
                            onClick={() => onSort(column.key)}
                            className={cn(
                              "flex w-full items-center gap-1 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] transition-colors hover:text-[var(--lore-text-primary)]",
                              column.numeric && "justify-end",
                              sort.key === column.key
                                ? "text-[var(--lore-text-primary)]"
                                : "text-[var(--lore-text-tertiary)]",
                            )}
                          >
                            {column.label}
                            {sort.key === column.key ? (
                              sort.dir === "asc" ? (
                                <ArrowUp size={11} />
                              ) : (
                                <ArrowDown size={11} />
                              )
                            ) : null}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr
                        key={row.page.id}
                        tabIndex={0}
                        onClick={() => onOpenPage(row.page.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpenPage(row.page.id);
                          }
                        }}
                        className="cursor-pointer border-b border-[var(--lore-border)] outline-none transition-colors last:border-0 hover:bg-[var(--lore-surface-raised)] focus-visible:bg-[var(--lore-surface-raised)]"
                      >
                        <td className="max-w-[18rem] truncate px-3 py-2.5 text-[13px] text-[var(--lore-text-primary)]">
                          {row.page.title}
                        </td>
                        <td className="hidden max-w-[10rem] truncate px-3 py-2.5 text-[13px] text-[var(--lore-text-secondary)] md:table-cell">
                          {row.page.folder || "root"}
                        </td>
                        <td className="hidden max-w-[14rem] px-3 py-2.5 lg:table-cell">
                          <span className="flex gap-1 overflow-hidden">
                            {row.page.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="lore-tag shrink-0">
                                {tag}
                              </span>
                            ))}
                            {row.page.tags.length > 3 ? (
                              <span className="shrink-0 text-[12px] text-[var(--lore-text-tertiary)]">
                                +{row.page.tags.length - 3}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="hidden px-3 py-2.5 text-right text-[13px] tabular-nums text-[var(--lore-text-secondary)] sm:table-cell">
                          {formatCount(row.page.words)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-[13px] text-[var(--lore-text-secondary)]">
                          {relativeTime(row.page.mtime)}
                        </td>
                        <td className="hidden px-3 py-2.5 text-right text-[13px] tabular-nums text-[var(--lore-text-secondary)] sm:table-cell">
                          {row.backlinks}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
                {sorted.length > ROW_CAP
                  ? `Showing ${ROW_CAP} of ${formatCount(sorted.length)} — narrow the filters to see the rest.`
                  : `${formatCount(sorted.length)} ${sorted.length === 1 ? "page" : "pages"}.`}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function countBits(mask: number): number {
  let n = 0;
  for (let bits = mask; bits; bits >>= 1) n += bits & 1;
  return n;
}

/** How many options a facet shows before it offers the rest. */
const FACET_VISIBLE = 12;

function Rail({
  slot,
  title,
  children,
}: {
  slot: number;
  title: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const shown = expanded ? items : items.slice(0, FACET_VISIBLE);
  const hidden = items.length - shown.length;

  return (
    <section style={paletteVars(slot)} className="min-w-0">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
        <span className="pal-bar !h-3.5" />
        <span className="pal-title">{title}</span>
      </h2>
      {/*
       * Deliberately NOT its own scroller.
       *
       * These were `max-h-72 overflow-y-auto`, which kept a wiki with 200 tags
       * from pushing the table down — at the cost of putting two scrollable
       * boxes inside a scrollable page. Chrome latches the wheel to whichever
       * one the pointer is over, so you scroll, hit the end of a facet list,
       * and the page stops dead until you scroll again. That is the "I have to
       * scroll twice to reach the bottom" everyone runs into here.
       *
       * The list is capped by COUNT instead (see Facet's `visible`), which
       * solves the same problem without a second scrollbar.
       */}
      <div className="space-y-px pr-1">{shown}</div>
      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[12px] font-medium text-[var(--lore-text-tertiary)] transition-colors hover:text-[var(--lore-text-primary)]"
        >
          {expanded ? "Show fewer" : `Show all ${formatCount(items.length)}`}
        </button>
      ) : null}
    </section>
  );
}

function Option({
  label,
  hint,
  count,
  selected,
  onToggle,
}: {
  label: string;
  hint?: string;
  count: number;
  selected: boolean;
  onToggle: () => void;
}) {
  // A selected option stays live even at zero, otherwise a combination that
  // narrows to nothing would trap the user with no way to undo it.
  const dead = count === 0 && !selected;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={dead}
      title={hint}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        selected
          ? "pal-chip font-medium"
          : dead
            ? "cursor-default text-[var(--lore-text-tertiary)] opacity-45"
            : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function Chip({
  slot,
  label,
  onRemove,
}: {
  slot: number;
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      style={paletteVars(slot)}
      className="pal-chip inline-flex h-6 max-w-[14rem] items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-opacity hover:opacity-80"
    >
      <span className="min-w-0 truncate">{label}</span>
      <X size={11} className="shrink-0 opacity-70" />
    </button>
  );
}
