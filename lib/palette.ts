/**
 * The colour system.
 *
 * Every folder and every page owns a colour. Nothing here is user-configurable
 * and nothing is random: colour is assigned by stable index so a page is the
 * same colour on every load, and a wiki that gains a page doesn't reshuffle.
 *
 * Eight slots. Five are Creed's plate colours; three more come from the same
 * family so a folder with more than five pages doesn't immediately repeat.
 */
export const PALETTE_SIZE = 8;

/**
 * Inline style for slot `i`. Returned as CSS custom properties rather than
 * class names so one stylesheet rule (`.plate`, `.pal-rule`, `.pal-title`)
 * serves all eight slots instead of eight near-identical rules — and so
 * Tailwind never has to see a dynamically-built class it would purge.
 */
export type PaletteStyle = React.CSSProperties & {
  "--plate": string;
  "--plate-tint": string;
  "--plate-ink": string;
};

export function paletteVars(index: number): PaletteStyle {
  const slot = (((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE) + 1;
  return {
    "--plate": `var(--pal-${slot})`,
    "--plate-tint": `var(--pal-${slot}-tint)`,
    "--plate-ink": `var(--pal-${slot}-ink)`,
  };
}

/**
 * Stable slot for an arbitrary key. Used for pages, where position within a
 * folder can shift as pages are added or renamed — hashing the id keeps a page
 * the colour it has always been.
 */
export function slotForKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash) % PALETTE_SIZE;
}

export function colorForKey(key: string) {
  return paletteVars(slotForKey(key));
}

/**
 * Folders use position, not a hash: the sidebar reads top to bottom, so
 * consecutive folders should be visibly different rather than coincidentally
 * similar.
 */
export function colorForIndex(index: number) {
  return paletteVars(index);
}
