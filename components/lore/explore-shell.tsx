"use client";

import { useState } from "react";
import {
  Share2,
  LayoutGrid,
  SlidersHorizontal,
  Copy,
  ClipboardCheck,
  CalendarClock,
  Columns2,
} from "lucide-react";
import type { VaultIndex } from "@/lib/types";
import { DesktopOnlyNotice, useIsDesktop } from "@/components/lore/app-shell";
import { GraphView } from "@/components/lore/graph-view";
import { CoverageMap } from "@/components/lore/coverage-map";
import { ExplorerView } from "@/components/lore/explorer-view";
import { DuplicatesView } from "@/components/lore/duplicates-view";
import { SchemaView } from "@/components/lore/schema-view";
import { TimelineView } from "@/components/lore/timeline-view";
import { CompareView } from "@/components/lore/compare-view";
import { cn } from "@/lib/utils";

/**
 * Explore — the seven ways of looking at the corpus, behind one nav item.
 *
 * These are grouped rather than promoted to the sidebar for a reason. Only one
 * of them is a place you work; the rest are lenses you reach for occasionally.
 * Giving each its own top-level slot would imply they are all equally load
 * bearing, and would push the nav past the point where anyone reads it.
 */

/**
 * `fills` marks the two lenses that size themselves to the pane rather than
 * flowing as a document: the graph runs a force simulation inside a fixed box,
 * and Compare is two independently scrolling columns. Those must not sit in a
 * scroller — an outer scrollbar on a canvas that already fills the space is how
 * you get two nested scrollbars and a graph you cannot pan.
 *
 * Everything else is a document and needs somewhere to scroll. It did not have
 * one: `main` is deliberately overflow-hidden on this view (see vault-app), this
 * container was overflow-hidden too, and the five document lenses each render a
 * plain div. Anything below the fold — most of Browse, all of a long Timeline —
 * was simply unreachable.
 */
const TABS = [
  { id: "explorer", label: "Browse", icon: SlidersHorizontal, fills: false },
  { id: "graph", label: "Graph", icon: Share2, fills: true },
  { id: "map", label: "Map", icon: LayoutGrid, fills: false },
  { id: "timeline", label: "Timeline", icon: CalendarClock, fills: false },
  { id: "compare", label: "Compare", icon: Columns2, fills: true },
  { id: "duplicates", label: "Duplicates", icon: Copy, fills: false },
  { id: "schema", label: "Schema", icon: ClipboardCheck, fills: false },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ExploreShell({
  index,
  pageTitles,
  onOpenPage,
}: {
  index: VaultIndex;
  pageTitles: Map<string, string>;
  onOpenPage: (pageId: string) => void;
}) {
  const [tab, setTab] = useState<TabId>("explorer");
  /* The graph is the one lens with no honest phone form: it draws the whole
     corpus into a ~310px canvas where the nodes overlap into a smear and are
     too small to hit. The other six reflow into a single readable column. */
  const isDesktop = useIsDesktop();

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--lore-border)] px-6 py-2.5 md:px-8">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                tab === t.id
                  ? "bg-[var(--lore-surface-raised)] text-[var(--lore-text-primary)]"
                  : "text-[var(--lore-text-secondary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
              )}
            >
              <Icon size={14} className="opacity-80" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Each lens is mounted only while selected. The graph runs a physics
          simulation and the duplicate finder hashes the whole corpus — keeping
          those alive behind a hidden tab would burn a laptop for nothing. */}
      <div
        className={cn(
          "min-w-0 flex-1",
          TABS.find((t) => t.id === tab)?.fills
            ? "overflow-hidden"
            : "lore-scrollbar overflow-y-auto",
        )}
      >
        {tab === "explorer" ? <ExplorerView index={index} onOpenPage={onOpenPage} /> : null}
        {tab === "graph" ? (
          isDesktop ? (
            <GraphView index={index} onOpenPage={onOpenPage} />
          ) : (
            <DesktopOnlyNotice feature="The graph" />
          )
        ) : null}
        {tab === "map" ? <CoverageMap index={index} onOpenPage={onOpenPage} /> : null}
        {tab === "timeline" ? <TimelineView index={index} onOpenPage={onOpenPage} /> : null}
        {tab === "compare" ? <CompareView index={index} pageTitles={pageTitles} /> : null}
        {tab === "duplicates" ? <DuplicatesView index={index} onOpenPage={onOpenPage} /> : null}
        {tab === "schema" ? <SchemaView index={index} /> : null}
      </div>
    </div>
  );
}
