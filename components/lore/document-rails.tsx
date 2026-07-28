"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, ArrowUpRight, Hash, Sparkles } from "lucide-react";
import type { PageMeta, VaultIndex } from "@/lib/types";
import { paletteVars } from "@/lib/palette";
import { cn, relativeTime } from "@/lib/utils";

/**
 * The two rails either side of the reading column.
 *
 * The document is held at a ~700px measure because that is where prose stays
 * readable, which on a wide monitor left roughly a third of the window empty on
 * each side. Widening the text instead would trade a real reading benefit for
 * the appearance of density.
 *
 * So the gutters answer the two questions you actually have while reading a
 * wiki — *where am I in this folder* on the left, and *what connects to this
 * page* on the right — and both track the section you are currently looking at.
 */

// ------------------------------------------------------------------ scroll spy

/**
 * The element that actually scrolls.
 *
 * Both spies below originally listened on `window`, which is wrong here and
 * silently so: the app shell puts the document inside an `overflow-y-auto`
 * <main>, so the window never scrolls, no scroll event ever fires on it, and
 * both rails sat permanently on their first item. Nothing errored — the
 * highlight was simply always wrong, which is why it survived several passes.
 *
 * Walks up from a node that is inside the scroller rather than assuming which
 * element it is, so a future layout change cannot quietly break this again.
 */
function scrollParentOf(node: Element | null): HTMLElement | Window {
  let current = node?.parentElement ?? null;
  while (current) {
    const overflow = getComputedStyle(current).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      current.scrollHeight > current.clientHeight + 8
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return window;
}


/**
 * Which section is being read.
 *
 * Uses the topmost section whose heading has passed the top quarter of the
 * viewport, rather than IntersectionObserver's "most visible" — with sections
 * of wildly different lengths, most-visible keeps a long section selected while
 * you are plainly reading the short one after it.
 */
export function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    if (!ids.length) return;

    const pick = () => {
      const line = window.innerHeight * 0.25;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      setActive(current);
    };

    pick();
    // Passive: this only reads layout, and blocking the scroll thread to keep a
    // highlight in sync is a bad trade on a long document.
    const scroller = scrollParentOf(document.getElementById(ids[0]));
    scroller.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      scroller.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [ids]);

  return active;
}

// ------------------------------------------------------------------ left rail

export function OutlineRail({
  pages,
  activeId,
  onJump,
}: {
  pages: PageMeta[];
  activeId: string | null;
  onJump: (relPath: string) => void;
}) {
  if (pages.length < 2) return null;

  return (
    <nav
      aria-label="Pages in this folder"
      className="sticky top-9 hidden max-h-[calc(100svh-5rem)] overflow-y-auto lore-scrollbar xl:block"
    >
      <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
        In this folder
      </p>
      <ul className="space-y-px">
        {pages.map((page, i) => {
          const isActive = activeId === `sec-${cssId(page.relPath)}`;
          return (
            <li key={page.relPath}>
              <button
                type="button"
                onClick={() => onJump(page.relPath)}
                style={paletteVars(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
                  isActive
                    ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                    : "text-[var(--lore-text-tertiary)] hover:text-[var(--lore-text-secondary)]",
                )}
              >
                <span
                  className={cn(
                    "h-3.5 w-[2px] shrink-0 rounded-full transition-opacity",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                  style={{ background: "var(--plate)" }}
                />
                <span className="truncate">{page.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The headings inside one page.
 *
 * The folder outline above answers "where am I in this folder", which is the
 * wrong question on a 5,000-word architecture note where the whole folder is one
 * page. This answers "where am I in this page", and only appears when a page is
 * long enough for that to be a real question.
 */
export function PageOutline({
  raw,
  onJump,
}: {
  raw: string;
  onJump: (heading: string) => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  const headings = useMemo(() => {
    const out: { depth: number; text: string }[] = [];
    let fenced = false;
    for (const line of raw.split("\n")) {
      // A "#" inside a fenced block is a shell comment, not a heading.
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced) continue;
      const match = /^(#{1,4})\s+(.*)$/.exec(line);
      if (match) out.push({ depth: match[1].length, text: match[2].trim() });
    }
    return out;
  }, [raw]);

  /* Tracks the heading you are reading, on the same rule the folder rail uses:
     the last heading to have passed the top quarter of the viewport. Matching by
     text rather than by an id because these headings are rendered from markdown
     and carry none. */
  useEffect(() => {
    if (headings.length < 3) return;

    const pick = () => {
      const line = window.innerHeight * 0.25;
      const rendered = [...document.querySelectorAll<HTMLElement>(".lore-prose h1, .lore-prose h2, .lore-prose h3, .lore-prose h4")];
      let current: string | null = null;
      for (const node of rendered) {
        if (node.getBoundingClientRect().top <= line) current = node.textContent?.trim() ?? null;
        else break;
      }
      setActive(current);
    };

    pick();
    const scroller = scrollParentOf(document.querySelector(".lore-prose"));
    scroller.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      scroller.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [headings.length, raw]);

  if (headings.length < 3) return null;

  return (
    <nav aria-label="Headings on this page" className="mt-5">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
        On this page
      </p>
      <ul className="space-y-px">
        {headings.map((heading, i) => (
          <li key={`${heading.text}-${i}`}>
            <button
              type="button"
              onClick={() => onJump(heading.text)}
              style={{ paddingLeft: `${(heading.depth - 1) * 9 + 6}px` }}
              className={cn(
                "block w-full truncate rounded-md py-1 pr-1.5 text-left text-[12px] transition-colors",
                active === heading.text
                  ? "bg-[var(--lore-surface-raised)] font-medium text-[var(--lore-text-primary)]"
                  : "text-[var(--lore-text-tertiary)] hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]",
              )}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ----------------------------------------------------------------- right rail

type Related = { id: string; score: number };

/**
 * Deliberately does NOT position itself. It used to be `sticky top-9` with its
 * own max-height, which was correct while it was the only thing in the right
 * column and broke the moment it was not: a pinned element with an unpinned
 * sibling below it means the sibling scrolls up through the pinned one and the
 * two render on top of each other. The containing rail owns the sticky.
 */
export function ContextRail({
  page,
  index,
  onOpenPage,
}: {
  page: PageMeta | null;
  index: VaultIndex;
  onOpenPage: (pageId: string) => void;
}) {
  const [related, setRelated] = useState<Related[]>([]);
  const requested = useRef<string | null>(null);

  const backlinks = useMemo(
    () =>
      page
        ? (index.backlinks[page.id] ?? [])
            .map((id) => index.pages.find((p) => p.id === id))
            .filter((p): p is PageMeta => Boolean(p))
        : [],
    [page, index],
  );

  const outgoing = useMemo(
    () =>
      page
        ? page.links
            .map((id) => index.pages.find((p) => p.id === id))
            .filter((p): p is PageMeta => Boolean(p))
        : [],
    [page, index],
  );

  /* Related pages come from the embedding index, which may not exist. It is
     strictly additive: no index means this section simply is not shown, never
     an error, because the rail is context and must never become an obstacle. */
  useEffect(() => {
    if (!page || requested.current === page.id) return;
    requested.current = page.id;
    setRelated([]);
    fetch(`/api/semantic?related=${encodeURIComponent(page.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRelated((d?.results ?? []).slice(0, 5)))
      .catch(() => setRelated([]));
  }, [page]);

  if (!page) return null;

  const relatedPages = related
    .map((r) => index.pages.find((p) => p.id === r.id))
    .filter((p): p is PageMeta => Boolean(p))
    .filter((p) => p.id !== page.id);

  return (
    <aside aria-label="About this page">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
        This page
      </p>

      <dl className="space-y-1.5 text-[12px]">
        <Row label="Edited" value={relativeTime(page.mtime)} />
        <Row label="Words" value={page.words.toLocaleString()} />
        <Row label="Links in" value={String(backlinks.length)} />
        <Row label="Links out" value={String(outgoing.length)} />
      </dl>

      {page.tags.length > 0 ? (
        <Section icon={Hash} title="Tags">
          <div className="flex flex-wrap gap-1">
            {page.tags.slice(0, 10).map((tag) => (
              <span key={tag} className="lore-tag">
                {tag}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {backlinks.length > 0 ? (
        <Section icon={Link2} title={`Linked from (${backlinks.length})`}>
          <PageList pages={backlinks.slice(0, 8)} onOpenPage={onOpenPage} />
        </Section>
      ) : null}

      {outgoing.length > 0 ? (
        <Section icon={ArrowUpRight} title={`Links to (${outgoing.length})`}>
          <PageList pages={outgoing.slice(0, 8)} onOpenPage={onOpenPage} />
        </Section>
      ) : null}

      {relatedPages.length > 0 ? (
        <Section icon={Sparkles} title="Related">
          <PageList pages={relatedPages} onOpenPage={onOpenPage} />
          <p className="mt-1.5 text-[10.5px] leading-snug text-[var(--lore-text-tertiary)]">
            Found by meaning, not by links. Nothing here is a connection you made.
          </p>
        </Section>
      ) : null}

      {backlinks.length === 0 && outgoing.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--lore-border)] px-3 py-3 text-[11.5px] leading-relaxed text-[var(--lore-text-tertiary)]">
          Nothing links here and this links nowhere. An agent walking your wiki&apos;s links
          will never reach this page.
        </p>
      ) : null}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[var(--lore-text-tertiary)]">{label}</dt>
      <dd className="tabular-nums text-[var(--lore-text-secondary)]">{value}</dd>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Link2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--lore-text-tertiary)]">
        <Icon size={11} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function PageList({
  pages,
  onOpenPage,
}: {
  pages: PageMeta[];
  onOpenPage: (pageId: string) => void;
}) {
  return (
    <ul className="space-y-px">
      {pages.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onOpenPage(p.id)}
            className="block w-full truncate rounded-md px-1.5 py-1 text-left text-[12px] text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)]"
            title={p.relPath}
          >
            {p.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Must match the id scheme the document uses for its sections. */
export function cssId(relPath: string): string {
  return relPath.replace(/[^a-zA-Z0-9]/g, "-");
}
