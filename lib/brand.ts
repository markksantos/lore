export const BRAND = "Lore";
export const BRAND_FILE = "lore.md";

/*
 * The three strings the whole site is titled and shared by.
 *
 * They used to describe one screen — "the wiki for all your agents" — which was
 * accurate when the product was a reader for a markdown folder and stopped
 * being the whole truth the moment seven observers shipped that never touch the
 * wiki at all. A tagline that undersells by two thirds costs the same to fix as
 * one that oversells, and is read by search engines, the app manifest, the
 * footer and every link anybody pastes into a chat.
 */
export const TAGLINE = "Ask your own machine anything. Locally, and free.";
export const META_TITLE = "Lore — Ask your own machine anything";
export const DESCRIPTION =
  "Lore indexes the markdown your AI agents write, the files, mail and messages on your disk, and every Claude Code, Codex and Cursor session you have had — then answers from all of it. Runs on your machine. Free, open source, and nothing is uploaded.";

export const APP_PORT = 4646;
export const GITHUB_URL = "https://github.com/markksantos/lore";

/**
 * Where the public site lives.
 *
 * Only used to make share-card URLs absolute, which every social scraper
 * requires. The deployed origin overrides it, so a self-hosted copy pointing at
 * the canonical site is the right default rather than a bug.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lore.md";

export const VERSION = "0.1.0";

export const ORG = "NoSleepLab";
export const ORG_URL = "https://nosleeplab.vercel.app";

/**
 * Where prebuilt installers live.
 *
 * Every download surface checks this. A button that 404s is worse than no
 * button — it spends the one moment someone decided to try the thing — so this
 * stays null until a release actually exists with assets on it.
 */
export const RELEASES_URL: string | null = `${GITHUB_URL}/releases`;

/** The tag whose assets the download buttons point at. */
export const RELEASE_TAG = `v${VERSION}`;

export type Download = {
  os: "macOS" | "Windows" | "Linux";
  label: string;
  /** The filename electron-builder produces, so it can be matched on a release. */
  asset: string;
  /** Set when this artifact cannot currently be produced at all. */
  blocked?: string;
};

/**
 * What `npm run dist:*` produces. Kept beside VERSION rather than in the page
 * because these filenames embed it, and a version bump that missed them would
 * break every download link silently.
 */
export const DOWNLOADS: Download[] = [
  { os: "macOS", label: "Apple silicon", asset: `Lore-${VERSION}-arm64.dmg` },
  { os: "macOS", label: "Intel", asset: `Lore-${VERSION}-x64.dmg` },
  { os: "Windows", label: "x64 installer", asset: `Lore-Setup-${VERSION}.exe` },
  { os: "Linux", label: "AppImage · x64", asset: `Lore-${VERSION}-x86_64.AppImage` },
  { os: "Linux", label: "AppImage · arm64", asset: `Lore-${VERSION}-arm64.AppImage` },
  { os: "Linux", label: "Debian · x64", asset: `Lore-${VERSION}-amd64.deb` },
  { os: "Linux", label: "Debian · arm64", asset: `Lore-${VERSION}-arm64.deb` },
];
