/**
 * The sky rotation.
 *
 * Six scenes, each a light/dark pair of the same composition at two times of
 * day. One is chosen per request, so the page greets you differently every time
 * you arrive without ever looking like a different product.
 *
 * The closing band reuses whichever scene the hero drew, anchored to the foot of
 * the image instead of its centre — so the top and the bottom of the page are
 * always the same world, and there is no second set of assets to keep in sync.
 */

export type Scene = {
  id: number;
  /** Shown in the alt-less `<img>`'s placeholder if the file is ever missing. */
  label: string;
  light: string;
  dark: string;
};

export const SCENES: Scene[] = [1, 2, 3, 4, 5, 6].map((id) => ({
  id,
  label: `Hero ${id}`,
  light: `/assets/landing/scenery/hero-${id}.png`,
  dark: `/assets/landing/scenery/hero-${id}-dark.png`,
}));

/**
 * Pick a scene. Called on the server per request; the result is passed down as
 * a prop rather than rolled in the browser, because a client-side roll would
 * either mismatch the server's HTML during hydration or leave the hero blank
 * until after first paint.
 */
export function pickScene(): Scene {
  return SCENES[Math.floor(Math.random() * SCENES.length)];
}
