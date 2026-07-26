"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Copy, MousePointerClick } from "lucide-react";
import type { PageMeta, VaultIndex } from "@/lib/types";
import { colorForIndex } from "@/lib/palette";
import { cn, formatCount, relativeTime } from "@/lib/utils";

type Unit = "week" | "month";

const DAY = 86_400_000;

/** A wiki nobody has touched in this long is the headline, not a footnote. */
const QUIET_ALARM_DAYS = 7;

/**
 * How many buckets the chart draws. Past this, a bar is thinner than the gap
 * beside it and the shape stops being readable, so anything older is folded
 * into a single "before this window" count instead of being squeezed in.
 */
const WINDOW: Record<Unit, number> = { week: 26, month: 24 };

/**
 * A vault whose pages all landed within five minutes of each other was written
 * by a machine, not a person — git clone, rsync, unzip. mtime then records when
 * the files arrived, not when anyone thought about them, and every derived
 * chart is a lie. Detected rather than drawn.
 */
const CLONE_SPREAD_MS = 5 * 60_000;

/** Shortest bar we will draw. A one-edit bucket has to survive the rounding. */
const MIN_BAR_PERCENT = 5;

/**
 * Timeline — how the wiki grew, and what is being touched now.
 *
 * Everything here is derived from page mtime, which is the only history a plain
 * folder of markdown gives us for free. That makes the view cheap but also
 * fragile in one specific way (see CLONE_SPREAD_MS), so the fragile case is
 * called out on screen rather than silently rendered as a chart.
 */
export function TimelineView({
  index,
  onOpenPage,
}: {
  index: VaultIndex;
  onOpenPage: (pageId: string) => void;
}) {
  const [unit, setUnit] = useState<Unit>("week");
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  /**
   * Folders take their colour from their position in `index.folders`, exactly
   * as the sidebar does, so a stack segment and a sidebar dot are the same
   * colour for the same folder.
   */
  const slotOf = useMemo(() => {
    const slots = new Map<string, number>();
    index.folders.forEach((entry, i) => slots.set(entry.folder, i));
    return slots;
  }, [index.folders]);

  const pulse = useMemo(() => vaultPulse(index.pages), [index.pages]);

  const chart = useMemo(
    () => (pulse ? buildChart(index.pages, unit, pulse.oldest, slotOf) : null),
    [index.pages, unit, pulse, slotOf],
  );

  const rot = useMemo(() => folderRot(index.pages, slotOf), [index.pages, slotOf]);

  if (!pulse) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-9">
        <Header />
        <p className="t-body mt-6 text-[var(--lore-text-secondary)]">
          Nothing to plot yet — this vault has no pages.
        </p>
      </div>
    );
  }

  // The bucket whose contents are listed: hover previews, click commits. The
  // readout follows the mouse so scanning the chart costs no clicks.
  const readoutKey = hovered ?? selected;
  const readout = chart && readoutKey !== null ? chart.byKey.get(readoutKey) : undefined;
  const selectedBucket = chart && selected !== null ? chart.byKey.get(selected) : undefined;

  return (
    <div className="mx-auto max-w-3xl px-8 py-9">
      <Header />

      <QuietHeadline days={pulse.quietDays} newest={pulse.newest} />

      {pulse.isClone ? (
        <CloneNotice count={index.pages.length} at={pulse.newest} />
      ) : chart ? (
        <section className="mt-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
              Edits over time
            </h2>
            <div className="flex items-center gap-1 rounded-lg border border-[var(--lore-border)] p-0.5">
              {(["week", "month"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setUnit(option);
                    // Bucket keys don't survive a unit change, so a stale
                    // selection would highlight an unrelated bar.
                    setSelected(null);
                    setHovered(null);
                  }}
                  className={cn(
                    "h-7 rounded-md px-3 text-[13px] font-medium capitalize transition-colors",
                    unit === option
                      ? "bg-[var(--lore-accent-tint)] text-[var(--lore-accent)]"
                      : "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-4">
            <div className="flex min-h-[1.55rem] flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {readout ? (
                <>
                  <span className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
                    {readout.label}
                  </span>
                  <span className="t-meta text-[var(--lore-text-secondary)]">
                    {readout.total === 0
                      ? "nothing touched"
                      : `${formatCount(readout.total)} ${readout.total === 1 ? "edit" : "edits"} across ${readout.folders.length} ${readout.folders.length === 1 ? "folder" : "folders"}`}
                  </span>
                </>
              ) : (
                <span className="t-meta text-[var(--lore-text-tertiary)]">
                  {formatCount(chart.windowTotal)} edits in the last {chart.keys.length}{" "}
                  {unit === "week" ? "weeks" : "months"} · hover a bar, click to open it
                </span>
              )}
            </div>

            <div className="mt-3 flex h-[168px] items-end gap-[3px]">
              {chart.keys.map((key) => {
                const bucket = chart.byKey.get(key)!;
                const isSelected = selected === key;
                const height =
                  bucket.total === 0
                    ? 0
                    : Math.max(MIN_BAR_PERCENT, (bucket.total / chart.max) * 100);

                return (
                  <button
                    key={key}
                    type="button"
                    onMouseEnter={() => setHovered(key)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(key)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setSelected(isSelected ? null : key)}
                    aria-pressed={isSelected}
                    title={`${bucket.label} — ${bucket.total} ${bucket.total === 1 ? "edit" : "edits"}`}
                    className={cn(
                      "flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end rounded-[5px] px-[1px] pt-1 pb-[3px] transition-colors",
                      isSelected
                        ? "bg-[var(--lore-accent-tint)]"
                        : "hover:bg-[var(--lore-surface-raised)]",
                    )}
                  >
                    {bucket.total === 0 ? (
                      <span className="h-[2px] w-full rounded-full bg-[var(--lore-border-strong)]" />
                    ) : (
                      <span
                        // col-reverse so the first folder stacks at the bottom
                        // and the order of colours is stable bar to bar.
                        className="flex w-full flex-col-reverse overflow-hidden rounded-[3px]"
                        style={{ height: `${height}%` }}
                      >
                        {bucket.folders.map((slice) => (
                          <span
                            key={slice.folder}
                            style={{
                              ...colorForIndex(slice.slot),
                              background: "var(--plate)",
                              height: `${(slice.count / bucket.total) * 100}%`,
                            }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px] text-[var(--lore-text-tertiary)]">
              <span className="min-w-0 truncate">{chart.firstLabel}</span>
              <span className="min-w-0 truncate">now</span>
            </div>
          </div>

          {chart.legend.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {chart.legend.map((entry) => (
                <span key={entry.folder} className="flex min-w-0 items-center gap-1.5">
                  <span style={colorForIndex(entry.slot)} className="pal-dot" />
                  <span className="min-w-0 truncate text-[11px] text-[var(--lore-text-secondary)]">
                    {entry.folder || "root"}
                  </span>
                  <span className="text-[11px] tabular-nums text-[var(--lore-text-tertiary)]">
                    {entry.count}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          {chart.before > 0 ? (
            <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
              {formatCount(chart.before)} older{" "}
              {chart.before === 1 ? "edit sits" : "edits sit"} before this window. Switch to
              months to see further back.
            </p>
          ) : null}

          <BucketPages bucket={selectedBucket} onOpenPage={onOpenPage} slotOf={slotOf} />
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
          Longest untouched
        </h2>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          {pulse.isClone
            ? "Every file in this vault carries the same timestamp, so these ages are all the age of the copy."
            : "Age of the newest page in each folder. A folder nobody has edited in months is rotting quietly — nothing warns you, it just gets more wrong."}
        </p>

        <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
          {rot.slice(0, 8).map((entry) => (
            <div key={entry.folder} className="flex items-center gap-3 px-4 py-2.5">
              <span style={colorForIndex(entry.slot)} className="pal-dot" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
                {entry.folder || "root"}
              </span>
              <span className="hidden w-24 shrink-0 sm:block">
                <span
                  className="block h-[5px] rounded-full"
                  style={{
                    ...colorForIndex(entry.slot),
                    background: "var(--plate)",
                    // Relative to the stalest folder, so the longest bar is
                    // always full and the comparison is between folders rather
                    // than against an invented ceiling.
                    width: `${Math.max(6, (entry.days / Math.max(1, rot[0].days)) * 100)}%`,
                  }}
                />
              </span>
              <span className="t-meta w-24 shrink-0 text-right tabular-nums text-[var(--lore-text-secondary)]">
                {entry.days === 0 ? "today" : `${formatCount(entry.days)}d`}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Header() {
  return (
    <header className="mb-7">
      <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
        Timeline
      </h1>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        When this wiki was written, which parts were alive at the time, and how long it has
        been since anyone came back.
      </p>
    </header>
  );
}

/**
 * The one number that decides whether the rest of this page matters. A wiki
 * that has gone quiet is stale everywhere at once, so past the alarm threshold
 * it stops being a stat and becomes a sentence.
 */
function QuietHeadline({ days, newest }: { days: number; newest: number }) {
  const alarmed = days > QUIET_ALARM_DAYS;

  return (
    <section
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 overflow-hidden rounded-xl border px-5 py-4",
        alarmed
          ? "border-[var(--lore-danger)] bg-[var(--lore-surface)]"
          : "border-[var(--lore-border)] bg-[var(--lore-surface)]",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums"
          style={{ color: alarmed ? "var(--lore-danger)" : "var(--lore-success)" }}
        >
          {formatCount(days)}
        </span>
        <span className="text-[15px] font-medium text-[var(--lore-text-secondary)]">
          {days === 1 ? "day" : "days"} quiet
        </span>
      </div>
      <div className="min-w-0 flex-1">
        {alarmed ? (
          <p className="flex items-start gap-2 text-[15px] font-semibold text-[var(--lore-danger)]">
            <AlertTriangle size={16} className="mt-[3px] shrink-0" />
            <span className="min-w-0">
              Nobody has touched this wiki in over a week.
            </span>
          </p>
        ) : (
          <p className="text-[15px] font-medium text-[var(--lore-text-primary)]">
            This wiki is being kept.
          </p>
        )}
        <p className="t-meta mt-0.5 text-[var(--lore-text-secondary)]">
          Most recent edit {relativeTime(newest)}
          {alarmed ? " — an agent reading it now is reading last month's answer." : "."}
        </p>
      </div>
    </section>
  );
}

/** Shown instead of a histogram when mtime carries no history worth plotting. */
function CloneNotice({ count, at }: { count: number; at: number }) {
  return (
    <section className="mt-9 overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-5">
      <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        <Copy size={16} className="shrink-0 text-[var(--lore-text-tertiary)]" />
        No history to plot
      </h2>
      <p className="t-body mt-2 text-[var(--lore-text-secondary)]">
        All {formatCount(count)} pages carry the same modified time ({relativeTime(at)}). That
        is the signature of a copy — a fresh <code>git clone</code>, an rsync, an unzipped
        archive — which rewrites every timestamp to the moment the files landed.
      </p>
      <p className="t-body mt-2.5 text-[var(--lore-text-secondary)]">
        A histogram of that is one giant bar saying nothing, so it isn&apos;t drawn. The
        timeline will fill in on its own as you and your agents start editing pages; until
        then, treat the ages below as the age of the copy, not of the writing.
      </p>
    </section>
  );
}

function BucketPages({
  bucket,
  slotOf,
  onOpenPage,
}: {
  bucket: BucketData | undefined;
  slotOf: Map<string, number>;
  onOpenPage: (pageId: string) => void;
}) {
  if (!bucket) {
    return (
      <p className="t-meta mt-4 flex items-center gap-1.5 text-[var(--lore-text-tertiary)]">
        <MousePointerClick size={13} className="shrink-0" />
        Click a bar to list the pages edited in that period.
      </p>
    );
  }

  return (
    <div className="mt-5">
      <h3 className="text-[15px] font-semibold text-[var(--lore-text-primary)]">
        Edited in {bucket.label}
      </h3>
      {bucket.pages.length === 0 ? (
        <p className="t-body mt-1.5 text-[var(--lore-text-tertiary)]">
          Nothing was touched in this period.
        </p>
      ) : (
        <div className="mt-2.5 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
          {bucket.pages.slice(0, 40).map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => onOpenPage(page.id)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--lore-surface-raised)]"
            >
              <span style={colorForIndex(slotOf.get(page.folder) ?? 0)} className="pal-dot" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--lore-text-primary)]">
                {page.title}
              </span>
              <span className="t-meta hidden min-w-0 shrink truncate text-[var(--lore-text-tertiary)] sm:block">
                {page.folder || "root"}
              </span>
              <span className="t-meta w-20 shrink-0 text-right text-[var(--lore-text-tertiary)]">
                {relativeTime(page.mtime)}
              </span>
            </button>
          ))}
        </div>
      )}
      {bucket.pages.length > 40 ? (
        <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">
          Showing 40 of {formatCount(bucket.pages.length)}.
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- derivation */

type FolderSlice = { folder: string; slot: number; count: number };

type BucketData = {
  key: number;
  label: string;
  total: number;
  folders: FolderSlice[];
  pages: PageMeta[];
};

type Pulse = {
  newest: number;
  oldest: number;
  quietDays: number;
  isClone: boolean;
};

function vaultPulse(pages: PageMeta[]): Pulse | null {
  if (pages.length === 0) return null;

  let newest = pages[0].mtime;
  let oldest = pages[0].mtime;
  for (const page of pages) {
    if (page.mtime > newest) newest = page.mtime;
    if (page.mtime < oldest) oldest = page.mtime;
  }

  return {
    newest,
    oldest,
    // Floor, not round: 30 hours of silence is one day quiet, not two.
    quietDays: Math.max(0, Math.floor((Date.now() - newest) / DAY)),
    isClone: pages.length >= 3 && newest - oldest <= CLONE_SPREAD_MS,
  };
}

function startOfBucket(ms: number, unit: Unit): number {
  const date = new Date(ms);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Monday-start weeks: a Sunday edit belongs to the week it closed, not to the
  // one that hasn't begun.
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

function previousBucket(ms: number, unit: Unit): number {
  const date = new Date(ms);
  if (unit === "month") date.setMonth(date.getMonth() - 1);
  else date.setDate(date.getDate() - 7);
  return date.getTime();
}

function bucketLabel(ms: number, unit: Unit): string {
  const date = new Date(ms);
  return unit === "month"
    ? date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : `week of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

type Chart = {
  keys: number[];
  byKey: Map<number, BucketData>;
  max: number;
  windowTotal: number;
  before: number;
  firstLabel: string;
  legend: FolderSlice[];
};

function buildChart(
  pages: PageMeta[],
  unit: Unit,
  oldest: number,
  slotOf: Map<string, number>,
): Chart {
  const now = Date.now();
  const current = startOfBucket(now, unit);
  const first = startOfBucket(oldest, unit);

  // Walk back from the current bucket so "now" is always the right-hand edge —
  // the axis a reader checks first — and empty periods stay visible as gaps.
  const keys: number[] = [];
  for (let key = current; key >= first && keys.length < WINDOW[unit]; key = previousBucket(key, unit)) {
    keys.push(key);
  }
  keys.reverse();
  const earliest = keys[0];

  const grouped = new Map<number, PageMeta[]>();
  let before = 0;
  for (const page of pages) {
    // Clock skew can put a file in the future; clamp so it lands on the last
    // bar rather than off the end of the chart.
    const key = Math.min(startOfBucket(page.mtime, unit), current);
    if (key < earliest) {
      before++;
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), page]);
  }

  const legendCounts = new Map<string, number>();
  const byKey = new Map<number, BucketData>();
  let max = 1;
  let windowTotal = 0;

  for (const key of keys) {
    const bucketPages = (grouped.get(key) ?? []).sort((a, b) => b.mtime - a.mtime);
    const counts = new Map<string, number>();
    for (const page of bucketPages) {
      counts.set(page.folder, (counts.get(page.folder) ?? 0) + 1);
      legendCounts.set(page.folder, (legendCounts.get(page.folder) ?? 0) + 1);
    }

    const folders = [...counts.entries()]
      .map(([folder, count]) => ({ folder, slot: slotOf.get(folder) ?? 0, count }))
      // Sorted by folder name so a folder occupies the same layer in every bar
      // and the eye can follow one colour across the chart.
      .sort((a, b) => a.folder.localeCompare(b.folder));

    max = Math.max(max, bucketPages.length);
    windowTotal += bucketPages.length;
    byKey.set(key, {
      key,
      label: bucketLabel(key, unit),
      total: bucketPages.length,
      folders,
      pages: bucketPages,
    });
  }

  const legend = [...legendCounts.entries()]
    .map(([folder, count]) => ({ folder, slot: slotOf.get(folder) ?? 0, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    keys,
    byKey,
    max,
    windowTotal,
    before,
    firstLabel: bucketLabel(earliest, unit),
    legend,
  };
}

function folderRot(
  pages: PageMeta[],
  slotOf: Map<string, number>,
): { folder: string; slot: number; days: number; }[] {
  const newest = new Map<string, number>();
  for (const page of pages) {
    newest.set(page.folder, Math.max(newest.get(page.folder) ?? 0, page.mtime));
  }

  const now = Date.now();
  return [...newest.entries()]
    .map(([folder, mtime]) => ({
      folder,
      slot: slotOf.get(folder) ?? 0,
      days: Math.max(0, Math.floor((now - mtime) / DAY)),
    }))
    .sort((a, b) => b.days - a.days || a.folder.localeCompare(b.folder));
}
