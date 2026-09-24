import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

// The public pages of the site build. The app routes behind them read a folder
// on the visitor's own machine and have nothing to index.
const PAGES = ["", "/demo", "/web", "/download", "/pricing", "/changelog", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((path) => ({ url: `${SITE_URL}${path}` }));
}
