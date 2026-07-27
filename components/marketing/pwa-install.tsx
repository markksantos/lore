"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The `beforeinstallprompt` event. Chromium-only, and absent from lib.dom
 * because it is not a standard, so it is declared here rather than reached for
 * through a cast.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

/**
 * What the component is allowed to offer right now.
 *
 * `hidden` is the default and the common case. An install button that does
 * nothing is worse than no button, so nothing renders until the browser has
 * actually handed over a prompt — or until we know we are on iOS, where the
 * prompt does not exist and the honest answer is instructions.
 */
type Offer = "hidden" | "prompt" | "ios";

/**
 * True on iPhone and iPad. iPadOS reports itself as a Macintosh, so the touch
 * count is what separates an iPad from a desktop Safari that will never show a
 * Share > Add to Home Screen item.
 */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/** Already launched from a home screen or a desktop launcher. */
function isInstalled(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // Safari's own pre-standard flag, still the only signal it gives on iOS.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Registers the service worker and offers installation where installation is
 * real.
 *
 * On a public host there is nothing worth installing — proxy.ts sends /vault
 * to /install there, so an installed window would be a shortcut to a page of
 * instructions. `siteMode` switches the whole component off rather than
 * shipping an install button that installs a brochure.
 */
export function PwaInstall({
  siteMode = false,
  className,
}: {
  siteMode?: boolean;
  className?: string;
}) {
  const [offer, setOffer] = useState<Offer>("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (siteMode || !("serviceWorker" in navigator)) return;
    // After hydration, not on load: registration competes with the first paint
    // and with the vault index request, and neither should wait for it.
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration costs nothing here — the worker only caches the
      // shell — so it is not worth telling the user about.
    });
  }, [siteMode]);

  useEffect(() => {
    if (siteMode || isInstalled()) return;

    if (isIOS()) {
      setOffer("ios");
      return;
    }

    const onPrompt = (event: Event) => {
      // Chromium shows its own mini-infobar unless this is suppressed; we want
      // the button below to be the only way in.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setOffer("prompt");
    };
    const onInstalled = () => {
      setDeferred(null);
      setOffer("hidden");
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [siteMode]);

  if (offer === "hidden") return null;

  const shell =
    "flex flex-wrap items-center gap-3 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-4 py-3.5";

  if (offer === "ios") {
    return (
      <div className={cn(shell, className)}>
        <p className="t-body flex-1 text-[var(--lore-text-secondary)]">
          <span className="font-medium text-[var(--lore-text-primary)]">
            Add Lore to your Home Screen.
          </span>{" "}
          Safari on iPhone and iPad has no install button, so it is two taps by hand: open{" "}
          <Share size={14} className="mb-0.5 inline align-middle" aria-hidden="true" />{" "}
          <strong className="font-medium">Share</strong>, then{" "}
          <SquarePlus size={14} className="mb-0.5 inline align-middle" aria-hidden="true" />{" "}
          <strong className="font-medium">Add to Home Screen</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(shell, className)}>
      <p className="t-body flex-1 text-[var(--lore-text-secondary)]">
        Install Lore as an app — its own window and launcher icon, same local server.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (!deferred) return;
          setPending(true);
          try {
            await deferred.prompt();
            await deferred.userChoice;
          } finally {
            // The event is single use whatever the answer was, so the button
            // goes with it rather than staying on screen unable to do anything.
            // Chromium fires a fresh event when it is willing to ask again.
            setDeferred(null);
            setOffer("hidden");
            setPending(false);
          }
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[var(--lore-accent-hover)] disabled:opacity-60"
      >
        <Download size={14} aria-hidden="true" />
        Install
      </button>
    </div>
  );
}
