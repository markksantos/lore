"use strict";

/**
 * The entire bridge between the desktop shell and Lore's UI.
 *
 * It exposes four members and no generic `ipcRenderer` passthrough: a page that
 * can send arbitrary IPC is a page that can drive the main process, which is
 * the whole reason contextIsolation and sandbox are on.
 *
 * Everything else Lore needs from the OS it already gets from its own Node
 * server (it reads and writes the vault directly), so there is nothing else to
 * put here.
 */

const { contextBridge, ipcRenderer } = require("electron");

const CHOOSE_VAULT_CHANNEL = "lore:choose-vault-folder";
const VAULT_CHOSEN_CHANNEL = "lore:vault-folder-chosen";

contextBridge.exposeInMainWorld("lore", {
  /** Present only in the desktop build; the web build has no `window.lore`. */
  isDesktop: true,

  platform: process.platform,

  /**
   * Open the native folder picker and resolve to the chosen absolute path, or
   * null if the user cancelled. Unlike /api/pick (osascript, macOS only) this
   * works on Windows too.
   *
   * @returns {Promise<string | null>}
   */
  chooseVaultFolder: () => ipcRenderer.invoke(CHOOSE_VAULT_CHANNEL),

  /**
   * Fires when the folder was chosen from the native File menu rather than from
   * the UI. Returns an unsubscribe function — call it on unmount, or a
   * re-rendered listener leaks and the path is handled twice.
   *
   * @param {(folder: string) => void} handler
   * @returns {() => void}
   */
  onVaultFolderChosen: (handler) => {
    const listener = (_event, folder) => handler(folder);
    ipcRenderer.on(VAULT_CHOSEN_CHANNEL, listener);
    return () => {
      ipcRenderer.off(VAULT_CHOSEN_CHANNEL, listener);
    };
  },
});
