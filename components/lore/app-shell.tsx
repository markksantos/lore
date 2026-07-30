"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Menu, Monitor, Search } from "lucide-react";
import { cn, count } from "@/lib/utils";

/**
 * The responsive frame around the vault.
 *
 * At `md` and above this is exactly what it always was: a fixed sidebar column
 * beside a scrolling main region. Below `md` the same sidebar tree becomes an
 * off-canvas drawer over a compact top bar, because a 248px column on a 390px
 * phone leaves the document 142px wide.
 *
 * The sidebar is mounted once and repositioned by CSS rather than rendered
 * twice. Two instances would mean two copies of the expanded-folder set and the
 * folder filter, and a resize would silently swap you onto the stale one.
 */

/** Tailwind's `md`, written as a number in the one place that needs it in JS:
 *  `inert` and focus restoration cannot be expressed in a media query. */
const DESKTOP_QUERY = "(min-width: 768px)";

function subscribeToBreakpoint(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True at `md` and above.
 *
 * The server has no viewport, so it answers "desktop" and the first client
 * render corrects it. useSyncExternalStore is what makes that correction a
 * legal re-render rather than a hydration mismatch.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToBreakpoint,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

type ShellState = {
  isDesktop: boolean;
  drawerOpen: boolean;
  closeDrawer: () => void;
};

/* The default describes the desktop shape. Anything rendered outside an
   AppShell — a sidebar in a harness, a future second surface — then behaves
   exactly as it did before the drawer existed instead of throwing. */
const ShellContext = createContext<ShellState>({
  isDesktop: true,
  drawerOpen: false,
  closeDrawer: () => {},
});

/** Read by the sidebar so that choosing anything inside the drawer closes it. */
export function useShell(): ShellState {
  return useContext(ShellContext);
}

export function AppShell({
  title,
  titleHint,
  needsReview,
  sidebar,
  mainScrolls = true,
  onSearchShortcut,
  children,
}: {
  /** Shown in the mobile top bar — the folder you are reading, or the view. */
  title: string;
  /** Full path behind a truncated folder name, for the native tooltip. */
  titleHint?: string;
  /** Surfaced as a dot on the menu button, since the sidebar badge is hidden
   *  behind the drawer on a phone. */
  needsReview: number;
  sidebar: ReactNode;
  /** False for views that manage their own height (the Explore lenses). */
  mainScrolls?: boolean;
  /** Called before the search field is focused, so the shortcut can switch to
   *  the view the search field belongs to. */
  onSearchShortcut: () => void;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  /** Whatever had focus when the drawer opened, to hand it back on close. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openDrawer = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const closeDrawer = useCallback(() => setOpen(false), []);

  /* A resize past the breakpoint leaves an open drawer as a phantom overlay
     column, so the drawer state does not survive the crossing. */
  useEffect(() => {
    if (isDesktop && open) setOpen(false);
  }, [isDesktop, open]);

  useEffect(() => {
    if (open) {
      /* Move focus into the drawer, but never fight a caller that already put
         it somewhere better — the search button focuses the search field one
         frame later, and the two orderings are not guaranteed. */
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && drawerRef.current?.contains(active);
      if (!inside) drawerRef.current?.focus();
      return;
    }
    const trigger = returnFocusRef.current;
    returnFocusRef.current = null;
    /* offsetParent is null once the top bar is display:none, which is what a
       rotation to desktop does. Focusing a hidden button drops focus to <body>
       and strands the keyboard at the top of the page. */
    if (trigger?.isConnected && trigger.offsetParent !== null) trigger.focus();
  }, [open]);

  const focusSearch = useCallback(() => {
    onSearchShortcut();
    if (!isDesktop) openDrawer();
    /* The search field lives in the sidebar, which on a phone is inert until
       the drawer has rendered open — so the focus call waits for the frame
       after that render rather than firing into a dead subtree. */
    requestAnimationFrame(() => document.getElementById("lore-search")?.focus());
  }, [isDesktop, onSearchShortcut, openDrawer]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key === "Escape" && open) closeDrawer();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch, open, closeDrawer]);

  const drawerHidden = !isDesktop && !open;

  return (
    <ShellContext.Provider value={{ isDesktop, drawerOpen: open, closeDrawer }}>
      <div className="flex h-svh overflow-hidden bg-[var(--lore-background)]">
        <div
          id="lore-sidebar"
          ref={drawerRef}
          tabIndex={-1}
          inert={drawerHidden}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[17.5rem] max-w-[85vw] shrink-0 outline-none",
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            open ? "translate-x-0" : "-translate-x-full",
            "md:static md:z-auto md:w-[15.5rem] md:max-w-none md:translate-x-0 md:transition-none",
          )}
          style={{ paddingLeft: "env(safe-area-inset-left)" }}
        >
          {sidebar}
        </div>

        {/* Tapping away closes the drawer. Deliberately a non-focusable div
            rather than a button: a full-screen control in the tab order sits
            between the drawer and the page and announces itself with no useful
            name. Escape is the keyboard path, and it is wired above. */}
        {!isDesktop && open ? (
          <div
            aria-hidden
            onClick={closeDrawer}
            className="fixed inset-0 z-40 backdrop-blur-[2px] md:hidden"
            style={{
              background: "color-mix(in srgb, var(--lore-background) 62%, transparent)",
            }}
          />
        ) : null}

        {/* Everything behind the drawer goes inert while it is open. Without
            this the page stays tabbable underneath, which is the difference
            between a drawer and a decoration for anyone not using a mouse. */}
        <div className="flex min-w-0 flex-1 flex-col" inert={!isDesktop && open}>
          <header
            className="flex shrink-0 items-center gap-1 border-b border-[var(--lore-border)] bg-[var(--lore-surface)] md:hidden"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingLeft: "max(0.25rem, env(safe-area-inset-left))",
              paddingRight: "max(0.25rem, env(safe-area-inset-right))",
            }}
          >
            <button
              type="button"
              onClick={openDrawer}
              aria-label={
                needsReview > 0
                  ? `Open menu — ${count(needsReview, "page")} changed recently`
                  : "Open menu"
              }
              aria-expanded={open}
              aria-controls="lore-sidebar"
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--lore-text-secondary)] transition-colors active:bg-[var(--lore-surface-raised)]"
            >
              <Menu size={19} />
              {needsReview > 0 ? (
                <span
                  aria-hidden
                  className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--lore-accent)]"
                />
              ) : null}
            </button>

            <span
              title={titleHint ?? title}
              className="min-w-0 flex-1 truncate text-center text-[14px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]"
            >
              {title}
            </span>

            <button
              type="button"
              onClick={focusSearch}
              aria-label="Search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--lore-text-secondary)] transition-colors active:bg-[var(--lore-surface-raised)]"
            >
              <Search size={18} />
            </button>
          </header>

          <main
            className={cn(
              "min-w-0 flex-1",
              mainScrolls ? "lore-scrollbar overflow-y-auto" : "overflow-hidden",
            )}
            style={{
              paddingLeft: "env(safe-area-inset-left)",
              paddingRight: "env(safe-area-inset-right)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {children}
          </main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

/**
 * What a genuinely desktop-only view shows on a phone.
 *
 * Some lenses — a force-directed graph on a canvas, a side-by-side diff — have
 * no honest small-screen form. Shrinking them produces something that renders
 * but cannot be read or used, so they say what they need instead of pretending.
 */
export function DesktopOnlyNotice({ feature }: { feature: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <Monitor size={22} className="text-[var(--lore-text-tertiary)]" />
      <p className="text-[15px] font-medium text-[var(--lore-text-secondary)]">
        {feature} needs a wider screen
      </p>
      <p className="t-body max-w-xs text-[var(--lore-text-tertiary)]">
        It is built for a large canvas and a pointer. Open this vault on a desktop to use it —
        there is no phone version of this view.
      </p>
    </div>
  );
}
