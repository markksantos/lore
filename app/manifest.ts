import type { MetadataRoute } from "next";
import { BRAND, DESCRIPTION } from "@/lib/brand";

/**
 * The web app manifest, so Lore can be added to a phone home screen or a Linux
 * desktop without an app store.
 *
 * `start_url` is /vault rather than / because an installed window should open
 * the application, not the marketing page. On a public host proxy.ts redirects
 * /vault to /install, so an install made from the website lands on the
 * instructions instead of pretending to be the app.
 *
 * Colours are the light canvas from globals.css (`--lore-background`) and are
 * hard-coded because a manifest is served as JSON and cannot read a stylesheet.
 * The manifest allows one value, not a light/dark pair, so the light canvas is
 * used for both: it is the theme a first launch shows before the no-flash
 * script in layout.tsx can consult localStorage.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND,
    short_name: BRAND,
    description: DESCRIPTION,
    start_url: "/vault",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f9f9f8",
    theme_color: "#f9f9f8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
