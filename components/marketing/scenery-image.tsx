"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A landing backdrop image. Uses a native <img> rather than next/image on
 * purpose: these are hand-made static skies, and a native element gives
 * reliable onError plus naturalWidth, which is what the missing-file fallback
 * below depends on.
 *
 * If the file 404s it renders a labelled placeholder naming the exact path to
 * drop the art into, so a half-finished fork never ships a silent blank band.
 */
export function SceneryImage({
  src,
  fileName,
  label,
  priority,
  position = "center",
  className,
}: {
  src: string;
  fileName: string;
  label?: string;
  priority?: boolean;
  /** Which part of the art survives the crop. The closing band uses "bottom"
      so the same scene shows its foliage rather than its empty middle. */
  position?: "center" | "bottom";
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // A 404 can finish before React attaches onError during hydration, so the
  // event is missed entirely. Re-check the natural size once mounted.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setErrored(true);
  }, []);

  if (errored) {
    // `className` carries a display utility (e.g. `dark:block`), so the root
    // must not also set `flex` — tailwind-merge would drop one of them.
    return (
      <div className={cn("absolute inset-0 bg-[var(--lore-surface-raised)]", className)}>
        <div className="absolute left-1/2 top-1/2 max-w-[16rem] -translate-x-1/2 -translate-y-1/2 px-6 text-center">
          <div className="text-[13px] font-medium text-[var(--lore-text-secondary)]">
            {label ?? "Image"} — add this file
          </div>
          <div
            className="mt-2 rounded-md bg-[var(--lore-surface)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--lore-text-tertiary)]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            public/assets/landing/scenery/
            <br />
            {fileName}
          </div>
        </div>
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt=""
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      onError={() => setErrored(true)}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth === 0) setErrored(true);
      }}
      className={cn(
        "absolute inset-0 h-full w-full object-cover",
        position === "bottom" ? "object-bottom" : "object-center",
        className,
      )}
    />
  );
}
