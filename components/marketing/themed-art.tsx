import { cn } from "@/lib/utils";

/**
 * A marketing illustration with a light and a dark cut.
 *
 * These are rendered scenes with their background baked in, which means one
 * file cannot serve both themes — a laptop on warm off-white sitting in the
 * middle of a dark page is the single most obvious tell that a site was built
 * for light mode and had dark bolted on. So there are two files and CSS picks,
 * the same arrangement the hero scenery already uses.
 *
 * A native <img> rather than next/image: these are fixed-size static assets
 * already sized for their slot, and the desktop build serves them from a
 * packaged filesystem where the optimiser is not running.
 */
export function ThemedArt({
  src,
  alt,
  width,
  height,
  className,
  priority,
}: {
  /** Path without the extension or the -dark suffix, e.g. /marketing/stays-local */
  src: string;
  /**
   * Empty when the picture repeats what the words beside it already say.
   * Every one of these sits next to a heading that carries the meaning, so an
   * alt text here would make a screen reader read the same sentence twice.
   */
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}) {
  /*
   * The edges are faded out rather than cropped.
   *
   * These are rendered scenes with their own background baked in, and however
   * carefully that background is matched to the page it lands as a visible
   * rectangle — one flat tone against another, plus the render's own vignette.
   * A radial mask dissolves the boundary, so the illustration reads as part of
   * the page instead of as a picture pasted onto it.
   */
  const common = "h-auto w-full";
  const fade = {
    maskImage:
      "radial-gradient(ellipse 62% 62% at 50% 48%, #000 0%, rgba(0,0,0,0.92) 45%, rgba(0,0,0,0.45) 76%, transparent 100%)",
    WebkitMaskImage:
      "radial-gradient(ellipse 62% 62% at 50% 48%, #000 0%, rgba(0,0,0,0.92) 45%, rgba(0,0,0,0.45) 76%, transparent 100%)",
  } as const;
  return (
    <span className={cn("block", className)}>
      <img
        src={`${src}.jpg`}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        style={fade}
        className={cn(common, "dark:hidden")}
      />
      <img
        src={`${src}-dark.jpg`}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        style={fade}
        className={cn(common, "hidden dark:block")}
      />
    </span>
  );
}
