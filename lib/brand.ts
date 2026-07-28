export const BRAND = "Lore";
export const BRAND_FILE = "lore.md";

export const TAGLINE = "The wiki for all your agents.";
export const META_TITLE = "Lore — The wiki for all your agents.";
export const DESCRIPTION =
  "Point Lore at the markdown wiki you already have. It maps every page, resolves every link, and hands your agents a readable index of everything you know — without moving a single file.";

export const APP_PORT = 4646;
export const GITHUB_URL = "https://github.com/markksantos/lore";

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
