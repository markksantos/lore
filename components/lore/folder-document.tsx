"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageSection } from "@/components/lore/page-section";
import type { PageMeta } from "@/lib/types";
import type { VaultIndex } from "@/lib/types";
import {
  ContextRail,
  OutlineRail,
  useActiveSection,
} from "@/components/lore/document-rails";

export type Section = {
  page: PageMeta;
  raw: string;
};

type FolderData = {
  folder: string;
  sections: Section[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

/** Matches the server default. A real vault has folders of 600+ pages. */
const PAGE_SIZE = 40;

/**
 * A folder rendered as one continuous document.
 *
 * This is the whole idea: you don't open files, you read a folder. Each page is
 * a coloured section in a single scroll, editable in place. Agents write to the
 * files directly — Lore watches the result rather than standing in front of it,
 * so what you are reading is the vault itself, never a staging copy of it.
 */
export function FolderDocument({
  folder,
  revision,
  index,
  pageTitles,
  focusPage,
  onOpenPage,
  onChanged,
}: {
  folder: string;
  revision: number;
  index: VaultIndex;
  pageTitles: Map<string, string>;
  focusPage: string | null;
  onOpenPage: (pageId: string) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<FolderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sectionIds = useMemo(
    () => (data?.sections ?? []).map((section) => `sec-${cssId(section.page.relPath)}`),
    [data],
  );
  const activeSection = useActiveSection(sectionIds);

  const load = useCallback(
    async (append = false) => {
      const offset = append ? (data?.sections.length ?? 0) : 0;
      const response = await fetch(
        `/api/folder?path=${encodeURIComponent(folder)}&offset=${offset}&limit=${PAGE_SIZE}`,
      );
      if (!response.ok) {
        setError((await response.json()).error ?? "Could not open that folder.");
        return;
      }
      setError(null);
      const next: FolderData = await response.json();
      setData((current) =>
        append && current
          ? { ...next, sections: [...current.sections, ...next.sections] }
          : next,
      );
    },
    [folder, data?.sections.length],
  );

  useEffect(() => {
    // Deliberately not depending on `load` — it changes identity whenever a
    // page is appended, which would restart the folder from scratch mid-scroll.
    void loadRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, revision]);

  const loadRef = useRef(load);
  loadRef.current = load;

  // Search lands you on a page, not a folder, so the document scrolls to it
  // once its section has actually rendered.
  useEffect(() => {
    if (!focusPage || !data) return;
    const el = document.getElementById(`sec-${cssId(focusPage)}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusPage, data]);

  if (error && !data) {
    return (
      <Empty title="Could not open that folder" body={error} />
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--lore-text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const activeId = activeSection ?? sectionIds[0] ?? null;
  const activePage =
    data.sections.find((s) => `sec-${cssId(s.page.relPath)}` === activeId)?.page ?? null;

  return (
    <div
      ref={scrollRef}
      className="mx-auto grid w-full max-w-[110rem] grid-cols-1 gap-x-8 px-6 py-9 md:px-8 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[13rem_minmax(0,1fr)_18rem]"
    >
      <div className="hidden xl:block">
        <OutlineRail
          pages={data.sections.map((s) => s.page)}
          activeId={activeId}
          onJump={(relPath) =>
            document
              .getElementById(`sec-${cssId(relPath)}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />
      </div>

      <div className="min-w-0 max-w-3xl">
      <header>
        <h1 className="text-[27px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          {data.folder || "Root"}
        </h1>
        <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
          {data.total === data.sections.length
            ? `${data.total} ${data.total === 1 ? "page" : "pages"}`
            : `${data.sections.length} of ${data.total} pages · newest first`}
        </p>
      </header>

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--lore-danger)]/30 px-3.5 py-2.5 text-[13px] text-[var(--lore-danger)]">
          {error}
        </p>
      ) : null}

      {data.sections.length === 0 ? (
        <Empty
          title="Nothing here yet"
          body="This folder has no markdown pages. Create one from the sidebar."
        />
      ) : null}

      <div className="mt-2">
        {data.sections.map((section, i) => (
          <PageSection
            key={section.page.relPath}
            index={i}
            id={`sec-${cssId(section.page.relPath)}`}
            section={section}
            pageTitles={pageTitles}
            onOpenPage={onOpenPage}
            onChanged={async () => {
              await load();
              onChanged();
            }}
          />
        ))}

        {data.hasMore ? (
          <button
            type="button"
            onClick={() => load(true)}
            className="mt-8 w-full rounded-xl border border-[var(--lore-border)] py-3 text-[13.5px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
          >
            Load more — showing {data.sections.length} of {data.total}
          </button>
        ) : null}
      </div>
      </div>

      <ContextRail page={activePage} index={index} onOpenPage={onOpenPage} />
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-16 flex flex-col items-center px-8 text-center">
      <p className="text-[15px] font-medium text-[var(--lore-text-secondary)]">{title}</p>
      <p className="t-body mt-1.5 max-w-sm text-[var(--lore-text-tertiary)]">{body}</p>
    </div>
  );
}

/** A path is not a valid DOM id fragment; slashes and dots have to go. */
function cssId(relPath: string): string {
  return relPath.replace(/[^a-zA-Z0-9]/g, "-");
}
