/**
 * The Electron bridge, as seen from the renderer.
 *
 * `window.lore` exists only in the packaged desktop app. Declaring its shape
 * here rather than reaching for `any` at each call site means a change to the
 * preload contract fails the typecheck instead of failing at runtime on a
 * platform nobody happened to test.
 */
export type LoreDesktopBridge = {
  isDesktop: true;
  platform: NodeJS.Platform;
  /** Native folder picker. Resolves to an absolute path, or null if cancelled. */
  chooseVaultFolder: () => Promise<string | null>;
  /** Folder chosen from the native menu. Returns an unsubscribe function. */
  onVaultFolderChosen: (handler: (folder: string) => void) => () => void;
};

declare global {
  interface Window {
    lore?: LoreDesktopBridge;
  }
}

export function desktopBridge(): LoreDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.lore ?? null;
}

/**
 * Can this build open a real folder picker at all?
 *
 * Two independent mechanisms, and neither covers every case:
 *  - the Electron bridge works on all three desktop platforms
 *  - /api/pick shells out to osascript, so it is macOS-only
 *
 * A browser on Windows or Linux therefore has neither, and the UI has to say so
 * rather than offering a Browse button that returns 501.
 */
export function canPickFolder(): boolean {
  if (desktopBridge()) return true;
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");
}
