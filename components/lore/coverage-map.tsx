"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageMeta, VaultIndex } from "@/lib/types";
import { paletteVars } from "@/lib/palette";
import { cn, formatCount } from "@/lib/utils";

/* -------------------------------------------------------------- the algorithm */

type Rect = { x: number; y: number; w: number; h: number };
type Placed<T> = Rect & { item: T };

/**
 * Squarified treemap (Bruls, Huizing & van Wijk, 2000).
 *
 * Written out rather than pulled from d3-hierarchy: it is one loop, and a
 * hierarchy dependency would cost more than it saves. Items are laid out into
 * rows along whichever side of the free rectangle is currently shorter, and a
 * row closes as soon as adding one more item would make the row's worst aspect
 * ratio worse than it already is — that is the entire method.
 */
function squarify<T>(items: { item: T; value: number }[], rect: Rect): Placed<T>[] {
  const out: Placed<T>[] = [];
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;

  // Values become pixel areas up front so the aspect-ratio test below compares
  // like with like instead of mixing word counts and pixels.
  const scale = (rect.w * rect.h) / total;
  const queue = items
    .map((i) => ({ item: i.item, area: i.value * scale }))
    .sort((a, b) => b.area - a.area);

  let free: Rect = { ...rect };
  let row: { item: T; area: number }[] = [];
  let rowArea = 0;
  let rowMin = Number.POSITIVE_INFINITY;
  let rowMax = 0;

  /** Worst (largest) aspect ratio in a row of `sum` area laid along `side`. */
  const worst = (sum: number, min: number, max: number, side: number) => {
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  const place = () => {
    if (rowArea > 0) {
      if (free.w >= free.h) {
        const thickness = rowArea / free.h;
        let y = free.y;
        for (const entry of row) {
          const h = (entry.area / rowArea) * free.h;
          out.push({ item: entry.item, x: free.x, y, w: thickness, h });
          y += h;
        }
        free = { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h };
      } else {
        const thickness = rowArea / free.w;
        let x = free.x;
        for (const entry of row) {
          const w = (entry.area / rowArea) * free.w;
          out.push({ item: entry.item, x, y: free.y, w, h: thickness });
          x += w;
        }
        free = { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
      }
    }
    row = [];
    rowArea = 0;
    rowMin = Number.POSITIVE_INFINITY;
    rowMax = 0;
  };

  for (const entry of queue) {
    const side = Math.min(free.w, free.h);
    if (side <= 0) break;
    if (row.length > 0) {
      const before = worst(rowArea, rowMin, rowMax, side);
      const after = worst(
        rowArea + entry.area,
        Math.min(rowMin, entry.area),
        Math.max(rowMax, entry.area),
        side,
      );
      if (after > before) place();
    }
    row.push(entry);
    rowArea += entry.area;
    rowMin = Math.min(rowMin, entry.area);
    rowMax = Math.max(rowMax, entry.area);
  }
  place();

  return out;
}

/* ------------------------------------------------------------------- colour */

type ColorMode = "folder" | "staleness" | "connectedness";

const MODES: { id: ColorMode; label: string }[] = [
  { id: "folder", label: "Folder" },
  { id: "staleness", label: "Staleness" },
  { id: "connectedness", label: "Links" },
];

const DAY = 86_400_000;

/** Past this many days a page is drawn as fully rotten. */
const ROT_DAYS = 180;

/** Inbound + outbound links at which a page counts as fully connected. */
const HUB_LINKS = 6;

/**
 * Every fill is the hue diluted into the surface rather than laid on at full
 * strength. That is what lets one label colour (`--lore-text-primary`) stay
 * readable on all three modes in both themes: diluting toward the surface pulls
 * every fill to roughly the surface's lightness, so the hue still reads but the
 * contrast against type does not flip between light and dark.
 */
function wash(hue: string, strength = 46) {
  return `color-mix(in oklab, ${hue} ${strength}%, var(--lore-surface))`;
}

/** Cool (fresh) to warm (rotten), on the health tokens. */
function stalenessHue(days: number) {
  const t = Math.min(Math.max(days / ROT_DAYS, 0), 1);
  return `color-mix(in oklab, var(--lore-danger) ${(t * 100).toFixed(1)}%, var(--lore-success))`;
}

/**
 * Orphans are the alarm; everything else is deliberately calm. A page with one
 * link sits at the accent and drifts to the success green as it gains more, so
 * a red cell is the only thing that pulls the eye.
 */
function connectednessHue(degree: number) {
  if (degree === 0) return "var(--lore-danger)";
  const t = Math.min(degree, HUB_LINKS) / HUB_LINKS;
  return `color-mix(in oklab, var(--lore-success) ${(t * 100).toFixed(1)}%, var(--lore-accent))`;
}

/* --------------------------------------------------------------- the layout */

type Cell = Rect & {
  page: PageMeta;
  folderName: string;
  slot: number;
  days: number;
  degree: number;
  fill: string;
};

type Frame = Rect & {
  key: string;
  name: string;
  slot: number;
  share: number;
  headerHeight: number;
};

type FolderNode = {
  key: string;
  name: string;
  slot: number;
  words: number;
  pages: PageMeta[];
};

/** A folder only earns a title strip once it is tall and wide enough to hold one. */
const HEADER_HEIGHT = 15;

export function CoverageMap({
  index,
  onOpenPage,
}: {
  index: VaultIndex;
  onOpenPage: (pageId: string) => void;
}) {
  const [mode, setMode] = useState<ColorMode>("folder");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ cell: Cell; x: number; y: number } | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  // Width comes from the element, height from the width: the map has no natural
  // height of its own, and letting it grow with a fixed aspect keeps rectangles
  // square-ish at every breakpoint instead of squashing them on a phone.
  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      setSize((prev) => {
        const h = Math.round(Math.min(Math.max(w * 0.62, 300), 620));
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const folders = useMemo<FolderNode[]>(() => {
    // Colour is the folder's position in `index.folders`, exactly as the sidebar
    // assigns it, so a folder is the same colour in both places.
    const slots = new Map(index.folders.map((f, i) => [f.folder, i]));
    const byFolder = new Map<string, FolderNode>();
    for (const page of index.pages) {
      let node = byFolder.get(page.folder);
      if (!node) {
        node = {
          key: page.folder || "__root",
          name: page.folder || "Root",
          slot: slots.get(page.folder) ?? byFolder.size,
          words: 0,
          pages: [],
        };
        byFolder.set(page.folder, node);
      }
      // An empty page still has to occupy a cell, or the map quietly lies about
      // how many pages exist.
      node.words += Math.max(page.words, 1);
      node.pages.push(page);
    }
    return [...byFolder.values()].sort((a, b) => b.words - a.words);
  }, [index.pages, index.folders]);

  const totals = useMemo(() => {
    const words = folders.reduce((sum, f) => sum + f.words, 0);
    const largest = folders[0];
    return {
      words,
      pages: index.pages.length,
      largestName: largest?.name ?? null,
      largestShare: largest && words > 0 ? largest.words / words : 0,
    };
  }, [folders, index.pages.length]);

  const layout = useMemo(() => {
    const cells: Cell[] = [];
    const frames: Frame[] = [];
    if (size.w <= 0 || size.h <= 0 || folders.length === 0) return { cells, frames };

    const now = Date.now();
    const folderRects = squarify(
      folders.map((f) => ({ item: f, value: f.words })),
      { x: 0, y: 0, w: size.w, h: size.h },
    );

    for (const { item: folder, x, y, w, h } of folderRects) {
      // One pixel of air on each side; the folder's own surface shows through
      // the gap and separates neighbouring folders without drawn borders.
      const inner = { x: x + 1, y: y + 1, w: Math.max(w - 2, 0), h: Math.max(h - 2, 0) };
      const headerHeight = inner.h >= 44 && inner.w >= 56 ? HEADER_HEIGHT : 0;

      frames.push({
        ...inner,
        key: folder.key,
        name: folder.name,
        slot: folder.slot,
        share: totals.words > 0 ? folder.words / totals.words : 0,
        headerHeight,
      });

      const body = {
        x: inner.x,
        y: inner.y + headerHeight,
        w: inner.w,
        h: Math.max(inner.h - headerHeight, 0),
      };
      const pageRects = squarify(
        folder.pages.map((p) => ({ item: p, value: Math.max(p.words, 1) })),
        body,
      );

      for (const placed of pageRects) {
        const page = placed.item;
        const days = Math.max(0, Math.round((now - page.mtime) / DAY));
        const degree = page.links.length + (index.backlinks[page.id]?.length ?? 0);
        // `--plate` resolves off the cell's own paletteVars below, so folder
        // mode never has to name a palette slot by hand.
        const hue =
          mode === "folder"
            ? "var(--plate)"
            : mode === "staleness"
              ? stalenessHue(days)
              : connectednessHue(degree);
        cells.push({
          x: placed.x,
          y: placed.y,
          w: placed.w,
          h: placed.h,
          page,
          folderName: folder.name,
          slot: folder.slot,
          days,
          degree,
          fill: wash(hue),
        });
      }
    }

    return { cells, frames };
  }, [folders, size, mode, index.backlinks, totals.words]);

  const handleHover = useCallback((cell: Cell, clientX: number, clientY: number) => {
    const box = shellRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ cell, x: clientX - box.left, y: clientY - box.top });
  }, []);
  const handleLeave = useCallback(() => setHover(null), []);

  if (index.pages.length === 0) {
    return (
      <p className="text-[15px] text-[var(--lore-text-tertiary)]">
        Nothing to map yet — this vault has no pages.
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="min-w-0 text-[13px] text-[var(--lore-text-secondary)]">
          <span className="font-medium text-[var(--lore-text-primary)] tabular-nums">
            {formatCount(totals.pages)}
          </span>{" "}
          pages ·{" "}
          <span className="font-medium text-[var(--lore-text-primary)] tabular-nums">
            {formatCount(totals.words)}
          </span>{" "}
          words
          {totals.largestName ? (
            <>
              {" "}
              · <span className="text-[var(--lore-text-primary)]">{totals.largestName}</span> is{" "}
              <span className="tabular-nums">{Math.round(totals.largestShare * 100)}%</span> of it
            </>
          ) : null}
        </p>
        <div className="flex shrink-0 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface)] p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors",
                mode === m.id
                  ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
                  : "text-[var(--lore-text-tertiary)] hover:text-[var(--lore-text-secondary)]",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={shellRef}
        onMouseLeave={handleLeave}
        className="relative w-full min-w-0 overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-background)]"
        style={{ height: size.h || 320 }}
      >
        <MapCells
          cells={layout.cells}
          frames={layout.frames}
          onHover={handleHover}
          onOpen={onOpenPage}
        />
        {hover ? <Tooltip hover={hover} width={size.w} height={size.h} /> : null}
      </div>

      <Legend mode={mode} folders={folders} />
    </div>
  );
}

/* ---------------------------------------------------------------- rendering */

/**
 * Split out and memoised because the tooltip follows the cursor: without this,
 * every mouse move would reconcile a couple of thousand rectangles. The cells
 * only depend on the layout, so they re-render when the map changes and never
 * because of a hover.
 */
const MapCells = memo(function MapCells({
  cells,
  frames,
  onHover,
  onOpen,
}: {
  cells: Cell[];
  frames: Frame[];
  onHover: (cell: Cell, clientX: number, clientY: number) => void;
  onOpen: (pageId: string) => void;
}) {
  return (
    <>
      {frames.map((frame) => (
        <div
          key={frame.key}
          style={{
            ...paletteVars(frame.slot),
            position: "absolute",
            left: frame.x,
            top: frame.y,
            width: frame.w,
            height: frame.h,
            borderRadius: 5,
          }}
          className="overflow-hidden bg-[var(--lore-surface-raised)]"
        >
          {frame.headerHeight > 0 ? (
            <div
              className="plate flex items-center gap-1.5 px-1.5"
              style={{ height: frame.headerHeight, borderRadius: 0 }}
            >
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-none">
                {frame.name}
              </span>
              {frame.w >= 110 ? (
                <span className="plate-muted shrink-0 text-[11px] leading-none tabular-nums">
                  {Math.round(frame.share * 100)}%
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}

      {cells.map((cell) => {
        const showTitle = cell.w >= 44 && cell.h >= 19;
        const showWords = cell.w >= 68 && cell.h >= 36;
        return (
          <button
            key={cell.page.id}
            type="button"
            // Slivers too small to carry a label are skipped in the tab order:
            // a 1500-page vault would otherwise be 1500 indistinguishable stops.
            tabIndex={showTitle ? 0 : -1}
            aria-label={`${cell.page.title} — ${cell.page.words} words`}
            onClick={() => onOpen(cell.page.id)}
            onMouseMove={(e) => onHover(cell, e.clientX, e.clientY)}
            onFocus={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              onHover(cell, box.left + box.width / 2, box.top);
            }}
            style={{
              ...paletteVars(cell.slot),
              position: "absolute",
              left: cell.x,
              top: cell.y,
              width: Math.max(cell.w - 1, 0),
              height: Math.max(cell.h - 1, 0),
              background: cell.fill,
              borderRadius: 3,
            }}
            className="overflow-hidden text-left transition-[outline-color] hover:z-10 hover:outline-2 hover:-outline-offset-2 hover:outline-[var(--lore-text-primary)] focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--lore-accent)]"
          >
            {showTitle ? (
              <span className="block truncate px-1 pt-[3px] text-[11px] font-medium leading-[1.25] text-[var(--lore-text-primary)]">
                {cell.page.title}
              </span>
            ) : null}
            {showWords ? (
              <span className="block truncate px-1 text-[11px] leading-[1.4] tabular-nums text-[var(--lore-text-secondary)]">
                {formatCount(cell.page.words)}w
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
});

function Tooltip({
  hover,
  width,
  height,
}: {
  hover: { cell: Cell; x: number; y: number };
  width: number;
  height: number;
}) {
  const { cell, x, y } = hover;
  const boxWidth = 230;
  // Flip the card to the other side of the cursor near an edge so it never
  // forces the shell to scroll.
  const left = x + 14 + boxWidth > width ? Math.max(x - 14 - boxWidth, 4) : x + 14;
  const top = Math.min(y + 14, Math.max(height - 96, 4));

  return (
    <div
      style={{ ...paletteVars(cell.slot), left, top, width: boxWidth }}
      className="pointer-events-none absolute z-20 rounded-lg border border-[var(--lore-border-strong)] bg-[var(--lore-surface)] px-2.5 py-2 shadow-lg"
    >
      <p className="truncate text-[13px] font-medium text-[var(--lore-text-primary)]">
        {cell.page.title}
      </p>
      <p className="mt-1 flex items-center gap-1.5">
        <span className="pal-dot" />
        <span className="pal-chip min-w-0 truncate rounded px-1.5 py-px text-[11px]">
          {cell.folderName}
        </span>
      </p>
      <p className="mt-1.5 text-[11px] tabular-nums text-[var(--lore-text-secondary)]">
        {formatCount(cell.page.words)} words · edited{" "}
        {cell.days === 0 ? "today" : `${formatCount(cell.days)}d ago`} ·{" "}
        {cell.degree === 0 ? "orphan" : `${cell.degree} links`}
      </p>
    </div>
  );
}

function Legend({ mode, folders }: { mode: ColorMode; folders: FolderNode[] }) {
  if (mode === "staleness") {
    return (
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[11px] text-[var(--lore-text-tertiary)]">Edited today</span>
        <span
          className="h-2 w-28 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${wash("var(--lore-success)")}, ${wash("var(--lore-danger)")})`,
          }}
        />
        <span className="text-[11px] text-[var(--lore-text-tertiary)]">{ROT_DAYS}d+</span>
      </div>
    );
  }

  if (mode === "connectedness") {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Swatch fill={wash("var(--lore-danger)")} label="Orphan" />
        <Swatch fill={wash(connectednessHue(1))} label="Lightly linked" />
        <Swatch fill={wash(connectednessHue(HUB_LINKS))} label={`Hub (${HUB_LINKS}+)`} />
      </div>
    );
  }

  const shown = folders.slice(0, 6);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {shown.map((folder) => (
        <span key={folder.key} style={paletteVars(folder.slot)} className="flex items-center gap-1.5">
          <span className="pal-dot" />
          <span className="text-[11px] text-[var(--lore-text-tertiary)]">{folder.name}</span>
        </span>
      ))}
      {folders.length > shown.length ? (
        <span className="text-[11px] text-[var(--lore-text-tertiary)]">
          +{folders.length - shown.length} more
        </span>
      ) : null}
    </div>
  );
}

function Swatch({ fill, label }: { fill: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: fill }} />
      <span className="text-[11px] text-[var(--lore-text-tertiary)]">{label}</span>
    </span>
  );
}
