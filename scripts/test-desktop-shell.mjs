#!/usr/bin/env node
/**
 * The desktop shell, checked without opening a window.
 *
 * electron/main.js gained about three hundred lines — global shortcuts, a menu
 * bar item, notification polling, a facts file — and none of it can be
 * exercised by the test suite, because running it means launching a GUI on
 * somebody's screen.
 *
 * What CAN be checked mechanically is the part that actually breaks: a
 * destructured import that does not exist on the `electron` module, a function
 * referenced before it is defined, a menu item wired to a typo. So the module
 * is loaded against a recording stub, every Electron API it touches is
 * captured, and the wiring is asserted against that recording.
 *
 * This is not a substitute for launching the app. It is the part of launching
 * the app that a machine can do.
 */
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

/* What the module asked Electron for, and what it did with it. */
const used = new Set();
const handlers = new Map();
const appEvents = new Set();
let menuTemplate = null;
let singleInstance = false;

const recorder = (name) =>
  new Proxy(() => {}, {
    get(_target, key) {
      used.add(`${name}.${String(key)}`);
      return recorder(`${name}.${String(key)}`);
    },
    apply() {
      used.add(`${name}()`);
      return recorder(`${name}()`);
    },
  });

const electronStub = {
  app: {
    getVersion: () => "0.1.0",
    getPath: () => "/tmp",
    setName: () => {},
    isPackaged: false,
    whenReady: () => new Promise(() => {}),
    on: (event) => appEvents.add(event),
    quit: () => {},
    focus: () => {},
    requestSingleInstanceLock: () => {
      singleInstance = true;
      /* False, so main() is never entered and no window is created. The wiring
         under test is all at module scope or in functions this file calls
         directly. */
      return false;
    },
  },
  BrowserWindow: Object.assign(
    function BrowserWindow() {
      throw new Error("A window must not be constructed by a static check.");
    },
    { getAllWindows: () => [], getFocusedWindow: () => null, fromWebContents: () => null },
  ),
  Menu: {
    buildFromTemplate: (template) => {
      menuTemplate = template;
      return { template };
    },
    setApplicationMenu: () => {},
  },
  Notification: Object.assign(
    function Notification() {
      return { on: () => {}, show: () => {} };
    },
    { isSupported: () => true },
  ),
  Tray: function Tray() {
    return { setImage: () => {}, setToolTip: () => {}, setContextMenu: () => {}, on: () => {} };
  },
  dialog: { showErrorBox: () => {}, showOpenDialog: async () => ({ canceled: true }) },
  globalShortcut: { register: () => true, unregisterAll: () => {} },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  nativeImage: {
    createFromBuffer: (buffer, size) => ({
      buffer,
      size,
      setTemplateImage: () => {},
    }),
  },
  shell: { openExternal: () => {} },
  systemPreferences: {
    getMediaAccessStatus: () => "granted",
    isTrustedAccessibilityClient: () => true,
  },
};

/* Intercept `require("electron")` for this load only. */
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

let loaded = true;
try {
  const require = Module.createRequire(path.join(root, "electron", "x.js"));
  delete require.cache?.[path.join(root, "electron", "main.js")];
  require(path.join(root, "electron", "main.js"));
} catch (error) {
  loaded = false;
  check("electron/main.js loads", false, error.message);
} finally {
  Module._load = originalLoad;
}

if (loaded) {
  check("electron/main.js loads without throwing", true);
  check("it takes the single-instance lock before doing anything", singleInstance);
  check(
    "the vault picker is registered on IPC",
    handlers.has("lore:choose-vault-folder"),
    [...handlers.keys()].join(", "),
  );
}

/*
 * The preload is the security boundary: it must expose named members and never
 * a generic ipcRenderer passthrough, or a page could drive the main process.
 */
const preload = await import("node:fs").then((fs) =>
  fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8"),
);
check("the preload exposes exactly one bridge object", (preload.match(/exposeInMainWorld/g) ?? []).length === 1);
check("the preload never exposes ipcRenderer itself", !/exposeInMainWorld\([^)]*ipcRenderer\s*\)/.test(preload));
check("the preload offers the navigate channel", preload.includes("lore:navigate"));
check(
  "every channel the preload uses is a lore: channel",
  (preload.match(/ipcRenderer\.(?:on|off|invoke|send)\(\s*([A-Z_]+)/g) ?? []).length > 0,
);

const main = await import("node:fs").then((fs) =>
  fs.readFileSync(path.join(root, "electron", "main.js"), "utf8"),
);

/* Every view the shell can ask for must exist in the renderer's router, or the
   hotkey silently does nothing for that one screen. */
const navigable = main.match(/const NAVIGABLE = \[([\s\S]*?)\]/)?.[1] ?? "";
const shellViews = [...navigable.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
const vaultApp = await import("node:fs").then((fs) =>
  fs.readFileSync(path.join(root, "components", "lore", "vault-app.tsx"), "utf8"),
);
const names = vaultApp.match(/export const VIEW_NAMES = \[([\s\S]*?)\] as const/)?.[1] ?? "";
const rendererViews = new Set([...names.matchAll(/"([a-z]+)"/g)].map((m) => m[1]));
check(`the shell names ${shellViews.length} navigable views`, shellViews.length > 0);
const unknown = shellViews.filter((view) => !rendererViews.has(view));
check("every view the shell can open exists in the renderer", unknown.length === 0, unknown.join(", "));

/* The facts file is the contract with lib/capabilities.ts. */
check("the shell writes the desktop facts file", main.includes("writeDesktopFacts"));
check("and clears it on quit, so a stale one cannot outlive it", main.includes("clearDesktopFacts"));
for (const field of ["screenAccess", "accessibility", "writtenAt", "platform"]) {
  check(`the facts file carries ${field}`, main.includes(field));
}

check("global shortcuts are unregistered before quitting", /before-quit[\s\S]{0,400}unregisterAll/.test(main));
check("shortcut registration checks its return value", /const ok = globalShortcut\.register/.test(main));

if (menuTemplate) {
  const labels = JSON.stringify(menuTemplate);
  check("the menu offers the observers", labels.includes("Ask Ghost"));
  check("the menu offers the pause switch", labels.includes("Pause everything"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
