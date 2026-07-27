"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, ArrowRight, Loader2, FolderSearch } from "lucide-react";
import { SceneryImage } from "@/components/marketing/scenery-image";
import { BrandMark } from "@/components/marketing/brand-mark";
import { formatCount } from "@/lib/utils";
import type { Scene } from "@/lib/scenery";
import { canPickFolder, desktopBridge } from "@/lib/desktop";

/**
 * First run. Exactly one decision: which folder is your wiki.
 *
 * There is no account step, no import, no "choose a template", and no empty
 * default vault — every one of those asks the user to commit before they've
 * seen anything. If they already have a wiki, this screen is over in one click.
 */
export function Onboarding({
  suggestions,
  scene,
}: {
  suggestions: { root: string; files: number }[];
  scene: Scene;
}) {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Resolved after mount: window.lore and navigator only exist in the browser,
     and reading either during render would not match the server's HTML. */
  const [canBrowse, setCanBrowse] = useState(false);

  useEffect(() => {
    setCanBrowse(canPickFolder());
    // The native File menu can also choose a folder, and the renderer has to
    // react to that as if the user had clicked Browse.
    const bridge = desktopBridge();
    return bridge?.onVaultFolderChosen((folder) => link(folder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ask the OS for a folder.
   *
   * Two routes, tried in order of capability. The Electron bridge works on
   * macOS, Windows and Linux, so the packaged app always gets a real dialog.
   * A browser falls back to /api/pick, which shells out to osascript and is
   * therefore macOS-only — which is why the button hides itself entirely on a
   * browser elsewhere rather than offering something that returns 501.
   */
  async function browse() {
    setPicking(true);
    setError(null);

    const bridge = desktopBridge();
    if (bridge) {
      const chosen = await bridge.chooseVaultFolder().catch(() => null);
      setPicking(false);
      if (chosen) link(chosen);
      return;
    }

    const response = await fetch("/api/pick", { method: "POST" }).catch(() => null);
    setPicking(false);
    if (!response?.ok) return;
    const data = await response.json();
    if (data.path) link(data.path);
  }

  async function link(target: string) {
    if (!target.trim() || busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "link", path: target }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not link that folder.");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-[var(--lore-background)]">
      {/* The same sky that opens the landing page, cropped to a shallow band so
          the app's first screen is recognisably the same product. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42svh] overflow-hidden">
        <SceneryImage
          src={scene.light}
          fileName={`hero-${scene.id}.png`}
          label={scene.label}
          priority
          className="dark:hidden"
        />
        <SceneryImage
          src={scene.dark}
          fileName={`hero-${scene.id}-dark.png`}
          label={`${scene.label} (dark)`}
          className="hidden dark:block"
        />
        <div
          className="absolute inset-x-0 bottom-0 h-full"
          style={{ backgroundImage: "var(--scenery-fade-down)" }}
        />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-5 py-16">
        <div className="lore-fade-up w-full max-w-[30rem]">
          <div className="mb-7 flex items-center justify-center gap-2 text-white drop-shadow-sm">
            <BrandMark size={22} />
            <span className="text-[18px] font-semibold tracking-[-0.03em]">Lore</span>
          </div>

          <div className="rounded-2xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-7 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)]">
              Link your wiki
            </h1>
            <p className="t-body mt-2 text-[var(--lore-text-secondary)]">
              Point Lore at the folder your markdown already lives in. Nothing moves, nothing
              gets rewritten, and nothing is uploaded.
            </p>

            <label className="mt-6 block">
              <span className="t-meta font-medium text-[var(--lore-text-secondary)]">
                Folder path
              </span>
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") link(path);
                }}
                placeholder="~/Documents/wiki"
                spellCheck={false}
                autoFocus
                className="mt-1.5 w-full rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5 text-[14px] text-[var(--lore-text-primary)] outline-none transition-colors placeholder:text-[var(--lore-text-tertiary)] focus:border-[var(--lore-accent)]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              />
            </label>

            {error ? (
              <p className="t-meta mt-2.5 text-[var(--lore-danger)]">{error}</p>
            ) : null}

            {canBrowse ? (
            <button
              type="button"
              onClick={browse}
              disabled={busy || picking}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--lore-border)] text-[14px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-50"
            >
              {picking ? <Loader2 size={15} className="animate-spin" /> : <FolderSearch size={15} />}
              {picking ? "Waiting for the picker…" : "Browse…"}
            </button>
            ) : null}

            <button
              type="button"
              onClick={() => link(path)}
              disabled={!path.trim() || busy}
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--lore-accent)] text-[14px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {busy ? "Linking…" : "Link folder"}
              {busy ? null : <ArrowRight size={15} />}
            </button>

            {suggestions.length > 0 ? (
              <div className="mt-7 border-t border-[var(--lore-border)] pt-5">
                <p className="t-meta font-medium text-[var(--lore-text-secondary)]">
                  Found on this Mac
                </p>
                <div className="mt-2.5 space-y-1.5">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.root}
                      type="button"
                      onClick={() => link(suggestion.root)}
                      disabled={busy}
                      className="group flex w-full items-center gap-2.5 rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-2.5 text-left transition-colors hover:border-[var(--lore-border-strong)] hover:bg-[var(--lore-surface-raised)] disabled:opacity-50"
                    >
                      <FolderOpen
                        size={15}
                        className="shrink-0 text-[var(--lore-text-tertiary)] group-hover:text-[var(--lore-accent)]"
                      />
                      <span
                        className="flex-1 truncate text-[12.5px] text-[var(--lore-text-primary)]"
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        {suggestion.root.replace(/^\/Users\/[^/]+/, "~")}
                      </span>
                      <span className="t-meta shrink-0 text-[var(--lore-text-tertiary)]">
                        {formatCount(suggestion.files)} pages
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <p className="t-meta mt-5 text-center text-[var(--lore-text-tertiary)]">
            Lore stores only the folder path, in <code>~/.lore/config.json</code>.
          </p>
        </div>
      </div>
    </main>
  );
}
