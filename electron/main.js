"use strict";

/**
 * Lore desktop shell.
 *
 * Lore is a Node server app — every route handler is `runtime: "nodejs"` and
 * reads the user's own filesystem — so there is no static bundle to load into a
 * window. This process therefore does one job: run Next's standalone server as
 * a child process on localhost and point a BrowserWindow at it.
 *
 * Two failures define the shape of everything below:
 *  1. Showing a window before the server answers. It renders a connection
 *     error and the app looks broken on first launch, so the window is not
 *     created until a request actually comes back.
 *  2. Leaving the child alive after the app is gone. An orphaned Next server
 *     holds the port, so the next launch cannot bind it. Every exit path —
 *     clean quit, crash, signal — kills the child.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";

/**
 * Kept in sync with APP_PORT in lib/brand.ts. Lore's Connections screen prints
 * an MCP config that hardcodes this port, so a stable port is what makes that
 * copy-paste config work. It is a preference, not a requirement — see
 * choosePort().
 */
const PREFERRED_PORT = 4646;

/** Cheap, always-200, no vault required — a pure "is it listening" probe. */
const READY_PATH = "/api/vault";
const READY_TIMEOUT_MS = 40_000;
const READY_POLL_MS = 150;

const CHOOSE_VAULT_CHANNEL = "lore:choose-vault-folder";
const VAULT_CHOSEN_CHANNEL = "lore:vault-folder-chosen";

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
/** @type {Promise<void> | null} */
let bootPromise = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let serverPort = 0;
let quitting = false;

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function resolveServerEntry() {
  // Packaged, the standalone build lives in Resources/app-server rather than
  // inside the asar archive: Next reads its own chunks and traced node_modules
  // from disk with plain fs paths, which an archive cannot serve reliably.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app-server", "server.js");
  }
  return path.join(__dirname, "..", ".next", "standalone", "server.js");
}

/**
 * Bind a port to prove it is free, then hand it straight to the child.
 *
 * There is a gap between closing the probe and the child binding, which is why
 * this is a probe and not a reservation — nothing in Node can reserve a port
 * for another process. In practice the only contender on this machine is a
 * `next dev` on 4646, which is exactly the case the fallback covers.
 *
 * @param {number} port 0 asks the OS for any free port.
 * @returns {Promise<number | null>}
 */
function probePort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.once("listening", () => {
      const address = probe.address();
      const bound = typeof address === "object" && address ? address.port : null;
      probe.close(() => resolve(bound));
    });
    probe.listen(port, HOST);
  });
}

async function choosePort() {
  const preferred = await probePort(PREFERRED_PORT);
  if (preferred) return preferred;
  return probePort(0);
}

/** Resolves true if the server answered at all — any status means it is up. */
function ping(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: HOST, port, path: READY_PATH, timeout: 1_000 },
      (response) => {
        response.resume();
        resolve(true);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // A child that already exited will never answer; failing now gives the user
    // the real reason instead of a forty-second wait ending in a timeout.
    if (!serverProcess || serverProcess.exitCode !== null) {
      throw new Error("Lore's local server exited before it finished starting.");
    }
    if (await ping(port)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `Lore's local server did not respond on ${HOST}:${port} within ${READY_TIMEOUT_MS / 1000}s.`,
  );
}

async function startServer() {
  const entry = resolveServerEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      `No server build found at ${entry}.\n\n` +
        `Set output: "standalone" in next.config.ts, run \`npm run build\`, then try again.`,
    );
  }

  const port = await choosePort();
  if (!port) throw new Error("Could not find a free port for Lore's local server.");
  serverPort = port;

  // Electron bundles Node, so the app spawns its own binary in Node mode.
  // Requiring a system Node install would make the packaged app fail on exactly
  // the machines it exists to serve.
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: HOST,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = child;

  // Next's own logs are the only diagnostic when a route throws in production,
  // so they are forwarded rather than swallowed.
  child.stdout.on("data", (chunk) => process.stdout.write(`[lore-server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[lore-server] ${chunk}`));

  child.on("exit", (code, signal) => {
    if (serverProcess !== child) return; // we asked for this one to stop
    serverProcess = null;
    bootPromise = null;
    if (quitting) return;
    fatal(
      new Error(
        `Lore's local server stopped unexpectedly (${signal ? `signal ${signal}` : `exit code ${code}`}).`,
      ),
    );
  });

  await waitForServer(port);
}

function ensureServer() {
  if (!bootPromise) {
    bootPromise = startServer().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

/**
 * @param {{ immediate?: boolean }} [options] `immediate` skips the grace period
 * for exit paths where no timer will ever fire (process 'exit', signals).
 */
function stopServer(options) {
  const immediate = Boolean(options && options.immediate);
  const child = serverProcess;
  serverProcess = null;
  bootPromise = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  child.kill(immediate ? "SIGKILL" : "SIGTERM");
  if (immediate) return;

  // SIGTERM is enough for a healthy Next server. The timer is the guarantee
  // that a wedged one still cannot outlive the app and keep holding the port.
  const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
  force.unref();
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    // No backgroundColor: Lore renders light or dark from the OS theme, and any
    // fixed colour here is a flash of the wrong one. Nothing is shown until the
    // first paint, so there is nothing to cover.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  // Links to docs and agent vendors belong in the user's browser; a second
  // Electron window has no chrome to get back out of.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // /vault is the app; it renders onboarding itself when no vault is linked.
  window.loadURL(`http://${HOST}:${serverPort}/vault`);
  mainWindow = window;
  return window;
}

function fatal(error) {
  quitting = true;
  stopServer();
  dialog.showErrorBox("Lore could not start", error instanceof Error ? error.message : String(error));
  app.quit();
}

// ---------------------------------------------------------------------------
// Vault picker
// ---------------------------------------------------------------------------

/**
 * @param {BrowserWindow | null} parent
 * @returns {Promise<string | null>}
 */
async function pickVaultFolder(parent) {
  const options = {
    title: "Choose vault folder",
    message: "Pick the folder your markdown wiki already lives in.",
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

// Invoked from the renderer: the path comes back as the return value, so this
// deliberately does not also broadcast on VAULT_CHOSEN_CHANNEL — one folder
// choice must not arrive twice.
ipcMain.handle(CHOOSE_VAULT_CHANNEL, async (event) => {
  return pickVaultFolder(BrowserWindow.fromWebContents(event.sender));
});

async function chooseVaultFromMenu() {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const folder = await pickVaultFolder(target);
  if (folder && target && !target.isDestroyed()) {
    target.webContents.send(VAULT_CHOSEN_CHANNEL, folder);
  }
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === "darwin";

  // Every clipboard and window item is a role. Electron ships no menu of its
  // own on macOS, and without these roles Cmd-C / Cmd-V / Cmd-A silently do
  // nothing in every text field in the app.
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Choose vault folder…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            void chooseVaultFromMenu();
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  return Menu.buildFromTemplate(template);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function main() {
  // In dev the app menu and about panel read "Electron" without this; packaged
  // builds take the name from electron-builder's productName.
  app.setName("Lore");

  app.on("second-instance", () => {
    const window = mainWindow;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    try {
      await ensureServer();
    } catch (error) {
      fatal(error);
      return;
    }
    createWindow();
  });

  app.on("window-all-closed", () => {
    // Nothing is left to serve, so the child dies with the last window instead
    // of sitting on the port. On macOS the app itself stays alive and 'activate'
    // boots the server again before re-opening the window.
    stopServer();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    try {
      await ensureServer();
    } catch (error) {
      fatal(error);
      return;
    }
    createWindow();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });

  // Last resort. If the main process is killed or throws its way out, no
  // Electron event fires — but these do, and an orphan holding 4646 is the
  // failure the next launch would inherit.
  process.on("exit", () => stopServer({ immediate: true }));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      quitting = true;
      stopServer({ immediate: true });
      process.exit(0);
    });
  }
}

// A second copy would fight the first for the port and put two filesystem
// watchers on the same vault.
if (app.requestSingleInstanceLock()) {
  main();
} else {
  app.quit();
}
