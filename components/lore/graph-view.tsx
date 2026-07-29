"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Shuffle, Unlink } from "lucide-react";
import type { VaultIndex } from "@/lib/types";
import { PALETTE_SIZE, paletteVars } from "@/lib/palette";
import { cn, count, formatCount } from "@/lib/utils";

type GraphNode = SimulationNodeDatum & {
  id: string;
  title: string;
  folder: string;
  /** 0-based palette slot, matching the folder's colour in the sidebar. */
  slot: number;
  radius: number;
  backlinks: number;
  outbound: number;
  orphan: boolean;
};

type GraphLink = SimulationLinkDatum<GraphNode>;

type Theme = {
  plates: string[];
  edge: string;
  label: string;
  halo: string;
  accent: string;
  /** Already-resolved stack: `ctx.font` silently rejects a `var()`. */
  font: string;
};

/** Where the layout stops being worth animating. Below this it is settled. */
const SETTLED_ALPHA = 0.01;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;

/**
 * The wiki as a shape.
 *
 * A wiki's real structure is its link graph, and the two failures you can only
 * see from above are the cluster that never links out and the page nothing
 * points at. So folders carry their sidebar colour through to the canvas, and
 * orphans are drawn faint — the visual weight of a node is the amount of
 * attention the rest of the vault gives it.
 *
 * Everything is drawn to a single <canvas>. A DOM node per page dies somewhere
 * around a few hundred pages, and the vaults this is for are bigger than that.
 */
export function GraphView({
  index,
  onOpenPage,
}: {
  index: VaultIndex;
  onOpenPage: (pageId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);

  // Folder colour is assigned by position in `index.folders`, exactly as the
  // sidebar does it — the graph would be lying if the same folder were a
  // different colour in each place.
  const slotByFolder = useMemo(() => {
    const map = new Map<string, number>();
    index.folders.forEach((entry, i) => map.set(entry.folder, i % PALETTE_SIZE));
    return map;
  }, [index.folders]);

  const graph = useMemo(() => {
    const visible = folderFilter === null
      ? index.pages
      : index.pages.filter((page) => page.folder === folderFilter);

    const allowed = new Set(visible.map((page) => page.id));

    const nodes: GraphNode[] = visible.map((page) => {
      const backlinks = index.backlinks[page.id]?.length ?? 0;
      const outbound = page.links.length;
      return {
        id: page.id,
        title: page.title,
        folder: page.folder,
        slot: slotByFolder.get(page.folder) ?? 0,
        // sqrt keeps a 200-backlink hub from swallowing the screen while still
        // reading as clearly bigger than a page with two.
        radius: Math.min(3 + Math.sqrt(backlinks) * 2.4, 15),
        backlinks,
        outbound,
        orphan: backlinks === 0 && outbound === 0,
      };
    });

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const links: GraphLink[] = [];
    const adjacency = new Map<string, Set<string>>();
    const seen = new Set<string>();

    for (const page of visible) {
      for (const target of page.links) {
        // Links out of the current filter have no node to attach to, and a
        // self-link is a rendering artefact rather than structure.
        if (!allowed.has(target) || target === page.id) continue;
        const key = page.id < target ? `${page.id}\u0000${target}` : `${target}\u0000${page.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: byId.get(page.id)!, target: byId.get(target)! });
        if (!adjacency.has(page.id)) adjacency.set(page.id, new Set());
        if (!adjacency.has(target)) adjacency.set(target, new Set());
        adjacency.get(page.id)!.add(target);
        adjacency.get(target)!.add(page.id);
      }
    }

    // Inside a filtered folder a page can be well-linked globally yet isolated
    // locally; dim it either way, since that is what the current view shows.
    if (folderFilter !== null) {
      for (const node of nodes) node.orphan = !adjacency.has(node.id);
    }

    return {
      nodes,
      links,
      adjacency,
      orphans: nodes.reduce((n, node) => n + (node.orphan ? 1 : 0), 0),
    };
  }, [index.pages, index.backlinks, folderFilter, slotByFolder]);

  const foldersInView = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) counts.set(node.folder, (counts.get(node.folder) ?? 0) + 1);
    return index.folders
      .map((entry, i) => ({ folder: entry.folder, slot: i % PALETTE_SIZE, count: entry.count }))
      .filter((entry) => folderFilter === null || counts.has(entry.folder));
  }, [index.folders, graph.nodes, folderFilter]);

  const openRef = useRef(onOpenPage);
  openRef.current = onOpenPage;

  const hoveredIdRef = useRef<string | null>(null);
  const resetViewRef = useRef<() => void>(() => {});

  useEffect(() => {
    const element = canvasRef.current;
    const shell = shellRef.current;
    if (!element || !shell || graph.nodes.length === 0) return;

    const context = element.getContext("2d");
    if (!context) return;

    // Explicitly typed rather than relying on narrowing: the draw and pointer
    // helpers below are hoisted function declarations, which TypeScript will
    // not narrow into.
    const canvas: HTMLCanvasElement = element;
    const ctx: CanvasRenderingContext2D = context;

    const { nodes, links, adjacency } = graph;
    const size = { width: shell.clientWidth || 1, height: shell.clientHeight || 1 };
    const view = { x: 0, y: 0, k: 1 };

    // ------------------------------------------------------------------ theme
    // Canvas can't use CSS variables, so the palette is sampled off the root
    // element and re-sampled whenever the theme class flips. Reading it once at
    // mount would leave the graph painted in the previous theme's colours.
    let theme: Theme = readTheme();

    function readTheme(): Theme {
      const styles = getComputedStyle(document.documentElement);
      const value = (name: string) => styles.getPropertyValue(name).trim();
      return {
        plates: Array.from({ length: PALETTE_SIZE }, (_, i) => value(`--pal-${i + 1}`)),
        edge: value("--lore-border-strong"),
        label: value("--lore-text-secondary"),
        halo: value("--lore-background"),
        accent: value("--lore-accent"),
        font: styles.fontFamily || "system-ui, sans-serif",
      };
    }

    // ------------------------------------------------------------- simulation
    const simulation: Simulation<GraphNode, GraphLink> = forceSimulation(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((node) => node.id)
          .distance(42),
      )
      // distanceMax caps the n-body work: past a few hundred px the repulsion
      // is noise, and paying for it is what makes big graphs crawl.
      .force("charge", forceManyBody<GraphNode>().strength(-28).distanceMax(320))
      .force("center", forceCenter(size.width / 2, size.height / 2))
      .force("collide", forceCollide<GraphNode>().radius((node) => node.radius + 2.5))
      .alphaDecay(0.035)
      .velocityDecay(0.36)
      .stop();

    let frame: number | null = null;
    let drawQueued = false;

    /** Advance the layout until it settles, then let the rAF loop die. */
    function tickLoop() {
      simulation.tick();
      paint();
      frame = simulation.alpha() > SETTLED_ALPHA ? requestAnimationFrame(tickLoop) : null;
    }

    function reheat(alpha: number) {
      simulation.alpha(Math.max(simulation.alpha(), alpha));
      if (frame === null) frame = requestAnimationFrame(tickLoop);
    }

    /** A repaint with no physics — hover, pan and zoom must not reheat. */
    function requestPaint() {
      if (drawQueued || frame !== null) return;
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        paint();
      });
    }

    // ---------------------------------------------------------------- drawing
    function paint() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);

      const focus = hoveredIdRef.current;
      const neighbours = focus ? adjacency.get(focus) : undefined;
      const lit = (id: string) => !focus || id === focus || neighbours?.has(id) === true;

      // Edges are batched into whole-graph stroke calls. One path per edge would
      // be thousands of context state changes a frame. The unhovered case takes
      // the allocation-free path because that is the one that runs every frame
      // while the layout is settling.
      ctx.lineWidth = 1 / view.k;
      if (!focus) {
        strokeEdges(links, theme.edge, 0.3);
      } else {
        const dim: GraphLink[] = [];
        const bright: GraphLink[] = [];
        for (const link of links) {
          const source = link.source as GraphNode;
          const target = link.target as GraphNode;
          if (source.id === focus || target.id === focus) bright.push(link);
          else dim.push(link);
        }
        strokeEdges(dim, theme.edge, 0.06);
        strokeEdges(bright, theme.accent, 0.75);
      }

      // Nodes are batched by (colour, emphasis) so the whole graph is at most
      // 8 palette slots x 3 states of fill calls.
      for (let slot = 0; slot < PALETTE_SIZE; slot++) {
        fillNodes(slot, "lit", 1);
        fillNodes(slot, "orphan", focus ? 0.12 : 0.3);
        fillNodes(slot, "dim", 0.14);
      }

      if (focus) {
        const node = nodes.find((candidate) => candidate.id === focus);
        if (node) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = theme.accent;
          ctx.lineWidth = 2 / view.k;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, node.radius + 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      drawLabels(lit);
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function strokeEdges(subset: GraphLink[], color: string, alpha: number) {
      if (subset.length === 0) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const link of subset) {
        const source = link.source as GraphNode;
        const target = link.target as GraphNode;
        ctx.moveTo(source.x ?? 0, source.y ?? 0);
        ctx.lineTo(target.x ?? 0, target.y ?? 0);
      }
      ctx.stroke();
    }

    function fillNodes(slot: number, state: "lit" | "dim" | "orphan", alpha: number) {
      const focus = hoveredIdRef.current;
      const neighbours = focus ? adjacency.get(focus) : undefined;
      let started = false;
      for (const node of nodes) {
        if (node.slot !== slot) continue;
        const inFocus = !focus || node.id === focus || neighbours?.has(node.id) === true;
        // An orphan you are pointing at stops being background: it is dimmed
        // for having no links, not for being off-topic.
        const nodeState =
          node.id === focus ? "lit" : node.orphan ? "orphan" : inFocus ? "lit" : "dim";
        if (nodeState !== state) continue;
        if (!started) {
          ctx.beginPath();
          started = true;
        }
        ctx.moveTo((node.x ?? 0) + node.radius, node.y ?? 0);
        ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, Math.PI * 2);
      }
      if (!started) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = theme.plates[slot] || theme.accent;
      ctx.fill();
    }

    function drawLabels(lit: (id: string) => boolean) {
      const focus = hoveredIdRef.current;
      // Titles are only legible once you've zoomed in, and drawing 1500 of them
      // every frame is the single most expensive thing this canvas could do.
      const showAll = view.k >= 1.35 || nodes.length <= 140;
      if (!showAll && !focus) return;

      const left = -view.x / view.k;
      const top = -view.y / view.k;
      const right = left + size.width / view.k;
      const bottom = top + size.height / view.k;

      ctx.font = `${11 / view.k}px ${theme.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3 / view.k;
      ctx.strokeStyle = theme.halo;
      ctx.lineJoin = "round";

      for (const node of nodes) {
        const visible = focus ? lit(node.id) : showAll;
        if (!visible) continue;
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        if (x < left || x > right || y < top || y > bottom) continue;
        ctx.globalAlpha = node.id === focus ? 1 : 0.85;
        const label = node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title;
        // A background-coloured stroke under the glyphs keeps titles readable
        // where they cross an edge, without painting a box behind every one.
        ctx.strokeText(label, x, y + node.radius + 3 / view.k);
        ctx.fillStyle = theme.label;
        ctx.fillText(label, x, y + node.radius + 3 / view.k);
      }
    }

    // ----------------------------------------------------------- interactions
    function toWorld(event: PointerEvent | WheelEvent) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - view.x) / view.k,
        y: (event.clientY - rect.top - view.y) / view.k,
      };
    }

    function nodeAt(wx: number, wy: number): GraphNode | null {
      let best: GraphNode | null = null;
      let bestDistance = Infinity;
      // A flat scan of 1500 nodes is ~0.02ms; a quadtree here would be cost
      // without benefit, and would need rebuilding every tick.
      for (const node of nodes) {
        const dx = wx - (node.x ?? 0);
        const dy = wy - (node.y ?? 0);
        const distance = dx * dx + dy * dy;
        const reach = (node.radius + 6 / view.k) ** 2;
        if (distance < reach && distance < bestDistance) {
          best = node;
          bestDistance = distance;
        }
      }
      return best;
    }

    let pointerId: number | null = null;
    let panned = false;
    let last = { x: 0, y: 0 };

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      panned = false;
      last = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (pointerId === event.pointerId) {
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        if (!panned && Math.hypot(dx, dy) < 3) return;
        panned = true;
        view.x += dx;
        view.y += dy;
        last = { x: event.clientX, y: event.clientY };
        requestPaint();
        return;
      }
      const world = toWorld(event);
      const hit = nodeAt(world.x, world.y);
      canvas.style.cursor = hit ? "pointer" : "grab";
      if ((hit?.id ?? null) === hoveredIdRef.current) return;
      hoveredIdRef.current = hit?.id ?? null;
      setHovered(hit);
      requestPaint();
    }

    function endPointer(event: PointerEvent) {
      // A cancelled pointer has already lost capture, and releasing it again
      // throws.
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      pointerId = null;
    }

    function onPointerUp(event: PointerEvent) {
      if (pointerId !== event.pointerId) return;
      endPointer(event);
      // A press that moved is a pan, not a click on whatever ended up under it.
      if (panned) return;
      const world = toWorld(event);
      const hit = nodeAt(world.x, world.y);
      if (hit) openRef.current(hit.id);
    }

    /** An interrupted gesture opens nothing. */
    function onPointerCancel(event: PointerEvent) {
      if (pointerId !== event.pointerId) return;
      endPointer(event);
    }

    function onPointerLeave() {
      if (hoveredIdRef.current === null) return;
      hoveredIdRef.current = null;
      setHovered(null);
      requestPaint();
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, view.k * Math.exp(-event.deltaY * 0.0015)),
      );
      // Anchor the zoom on the cursor: the world point under it must not move.
      view.x = mx - ((mx - view.x) * next) / view.k;
      view.y = my - ((my - view.y) * next) / view.k;
      view.k = next;
      requestPaint();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.style.cursor = "grab";

    // The one control that deliberately restarts the physics: a settled layout
    // can end up with a knot no amount of panning untangles.
    resetViewRef.current = () => {
      view.x = 0;
      view.y = 0;
      view.k = 1;
      reheat(0.55);
    };

    // ------------------------------------------------------------- observers
    const resize = new ResizeObserver(() => {
      const width = shell.clientWidth || 1;
      const height = shell.clientHeight || 1;
      if (width === size.width && height === size.height) return;
      size.width = width;
      size.height = height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      simulation.force("center", forceCenter(width / 2, height / 2));
      reheat(0.2);
    });
    resize.observe(shell);

    const themeWatch = new MutationObserver(() => {
      theme = readTheme();
      requestPaint();
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Seed the canvas size before the first frame so the initial layout is
    // centred rather than snapping once the ResizeObserver fires.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Same layout, no animation: settle it in one synchronous burst.
      for (let i = 0; i < 240 && simulation.alpha() > SETTLED_ALPHA; i++) simulation.tick();
      paint();
    } else {
      frame = requestAnimationFrame(tickLoop);
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      simulation.stop();
      resize.disconnect();
      themeWatch.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      hoveredIdRef.current = null;
      resetViewRef.current = () => {};
    };
  }, [graph]);

  const selectFolder = useCallback((folder: string | null) => {
    setHovered(null);
    hoveredIdRef.current = null;
    setFolderFilter(folder);
  }, []);

  if (index.pages.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-9">
        <Header linkCount={0} nodeCount={0} orphanCount={0} />
        <div className="mt-8 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-6 py-12 text-center">
          <p className="t-body text-[var(--lore-text-secondary)]">
            Nothing to draw yet. The graph appears once the vault has pages —
            it&apos;s a picture of how they link to each other.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[560px] flex-col px-8 py-9">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Header
          nodeCount={graph.nodes.length}
          linkCount={graph.links.length}
          orphanCount={graph.orphans}
        />
        <button
          type="button"
          onClick={() => resetViewRef.current()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-3 text-[13px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
        >
          <Shuffle size={13} />
          Re-layout
        </button>
      </div>

      <div
        ref={shellRef}
        className="relative mt-5 min-h-0 w-full flex-1 overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]"
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />

        {graph.nodes.length === 0 ? (
          <p className="t-body absolute inset-0 flex items-center justify-center px-6 text-center text-[var(--lore-text-tertiary)]">
            No pages in this folder.
          </p>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3">
          {hovered ? (
            <div className="max-w-[min(18rem,60%)] min-w-0 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] px-3 py-2 shadow-sm">
              <p className="truncate text-[13px] font-semibold text-[var(--lore-text-primary)]">
                {hovered.title}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--lore-text-tertiary)]">
                {hovered.folder || "root"}
              </p>
              <p className="mt-1.5 text-[11px] tabular-nums text-[var(--lore-text-secondary)]">
                {formatCount(hovered.backlinks)} in · {formatCount(hovered.outbound)} out
              </p>
            </div>
          ) : null}
        </div>

        <Legend
          folders={foldersInView}
          active={folderFilter}
          onSelect={selectFolder}
          total={index.pages.length}
        />

        {/* Hidden on narrow screens, where it would sit on top of the legend. */}
        <p className="pointer-events-none absolute bottom-3 right-3 hidden text-[11px] text-[var(--lore-text-tertiary)] sm:block">
          drag to pan · scroll to zoom · click to open
        </p>
      </div>
    </div>
  );
}

function Header({
  nodeCount,
  linkCount,
  orphanCount,
}: {
  nodeCount: number;
  linkCount: number;
  orphanCount: number;
}) {
  return (
    <header className="min-w-0">
      <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
        Graph
      </h1>
      <p className="t-body mt-1.5 text-[var(--lore-text-secondary)]">
        {count(nodeCount, "page")}, {count(linkCount, "link")}.{" "}
        {orphanCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-[var(--lore-text-tertiary)]">
            <Unlink size={12} />
            {formatCount(orphanCount)} floating free
          </span>
        ) : nodeCount > 0 ? (
          <span className="text-[var(--lore-text-tertiary)]">Everything is connected.</span>
        ) : null}
      </p>
    </header>
  );
}

/**
 * Legend and filter are the same control: reading the colour and isolating that
 * folder are the same intent, and two widgets for one idea is one too many.
 */
function Legend({
  folders,
  active,
  onSelect,
  total,
}: {
  folders: { folder: string; slot: number; count: number }[];
  active: string | null;
  onSelect: (folder: string | null) => void;
  total: number;
}) {
  return (
    <div className="lore-scrollbar absolute bottom-3 left-3 max-h-[min(60%,16rem)] w-[min(13rem,45%)] overflow-y-auto rounded-lg border border-[var(--lore-border)] bg-[var(--lore-surface-raised)] p-1.5">
      <LegendRow
        label="All folders"
        count={total}
        selected={active === null}
        onClick={() => onSelect(null)}
      />
      {folders.map((entry) => (
        <LegendRow
          key={entry.folder}
          label={entry.folder || "root"}
          count={entry.count}
          slot={entry.slot}
          selected={active === entry.folder}
          onClick={() => onSelect(active === entry.folder ? null : entry.folder)}
        />
      ))}
    </div>
  );
}

function LegendRow({
  label,
  count,
  slot,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  slot?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The dot is coloured from the same --pal-N the canvas samples, so the
      // legend can never drift from what is actually drawn.
      style={slot === undefined ? undefined : paletteVars(slot)}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
        selected ? "bg-[var(--lore-accent-tint)]" : "hover:bg-[var(--lore-surface)]",
      )}
    >
      {slot === undefined ? (
        <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--lore-border-strong)]" />
      ) : (
        <span className="pal-dot" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11px]",
          selected
            ? "font-medium text-[var(--lore-text-primary)]"
            : "text-[var(--lore-text-secondary)]",
        )}
      >
        {label}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-[var(--lore-text-tertiary)]">
        {count}
      </span>
    </button>
  );
}
