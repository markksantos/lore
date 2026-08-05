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

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  shell,
  systemPreferences,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
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
const NAVIGATE_CHANNEL = "lore:navigate";

/** Where the shell records what only it can know. See lib/capabilities.ts. */
const DESKTOP_FACTS = path.join(os.homedir(), ".lore", "desktop.json");

/** How often Prophet is asked whether it has anything worth interrupting for. */
const PROPHET_POLL_MS = 60_000;

/** @type {Tray | null} */
let tray = null;
/** @type {NodeJS.Timeout | null} */
let prophetTimer = null;

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
      // The desktop app is always the local half of the product. Without this,
      // isSiteMode() falls through to inferring from the inherited environment,
      // and a stray VERCEL/RENDER/K_SERVICE variable in the user's shell would
      // 404 every filesystem route in an app whose only job is the filesystem.
      // Explicit "local" is checked before any of those, so the inference can
      // never fire here.
      LORE_MODE: "local",
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
  // A dying child fires its own 'exit' handler *and* trips waitForServer's
  // "already exited" check, so without this guard one failure shows two error
  // boxes. First reason wins; it is the accurate one.
  if (quitting) return;
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
// What only the shell knows
// ---------------------------------------------------------------------------

/**
 * Tell the server what it cannot find out for itself.
 *
 * Screen-recording permission is answerable only through
 * `systemPreferences.getMediaAccessStatus`, which exists in this process and
 * not in the Next server running as a child. Rather than build an IPC channel
 * across two process boundaries for two strings, the shell writes them to a
 * file that lib/capabilities.ts reads.
 *
 * Rewritten on every launch, and treated as stale after a day — otherwise a
 * desktop session three weeks ago would convince a browser session today that
 * it has global hotkeys.
 */
function writeDesktopFacts() {
  let screenAccess = "unknown";
  let accessibility = false;
  try {
    if (process.platform === "darwin") {
      screenAccess = systemPreferences.getMediaAccessStatus("screen");
      // `false` as the argument means "do not show the prompt". Asking on every
      // launch would put a system dialog in front of someone who only wanted to
      // read their wiki.
      accessibility = systemPreferences.isTrustedAccessibilityClient(false);
    }
  } catch {
    // An unsupported platform or a future rename. Unknown is the honest answer.
  }

  try {
    fs.mkdirSync(path.dirname(DESKTOP_FACTS), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      DESKTOP_FACTS,
      JSON.stringify(
        {
          version: app.getVersion(),
          platform: process.platform,
          screenAccess,
          accessibility,
          writtenAt: Date.now(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // The server falls back to probing. Nothing here is worth failing a launch.
  }
}

/** Remove the file on quit, so a stale one cannot outlive the app. */
function clearDesktopFacts() {
  try {
    fs.rmSync(DESKTOP_FACTS, { force: true });
  } catch {
    // Nothing to do; the timestamp check covers it.
  }
}

// ---------------------------------------------------------------------------
// Talking to the local server
// ---------------------------------------------------------------------------

/**
 * A small JSON request to Lore's own server.
 *
 * The shell needs this for exactly one thing — asking Prophet whether it has
 * anything to say — and a dependency-free forty lines beats adding an HTTP
 * client to a process that otherwise has none.
 *
 * @param {string} pathname
 * @param {unknown} [body] POST when present, GET when not.
 * @returns {Promise<any | null>}
 */
function askServer(pathname, body) {
  return new Promise((resolve) => {
    if (!serverPort) {
      resolve(null);
      return;
    }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request(
      {
        host: HOST,
        port: serverPort,
        path: pathname,
        method: payload ? "POST" : "GET",
        timeout: 10_000,
        headers: payload
          ? { "content-type": "application/json", "content-length": payload.length }
          : {},
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
    if (payload) request.write(payload);
    request.end();
  });
}

// ---------------------------------------------------------------------------
// Showing a screen
// ---------------------------------------------------------------------------

/**
 * Every screen a hotkey, tray item or notification may open.
 *
 * An allowlist rather than a free string: this value crosses into the renderer
 * and becomes a view name, and "the shell can only ask for one of these seven"
 * is a much easier property to hold than "nothing malformed ever reaches the
 * router".
 */
const NAVIGABLE = [
  "brief",
  "ask",
  "wiki",
  "prophet",
  "ghost",
  "ledger",
  "oracle",
  "chorus",
  "understudy",
  "twin",
  "settings",
];

/**
 * Bring the window forward and show one screen.
 *
 * Creates the window if the last one was closed — on macOS the app outlives its
 * windows, and a hotkey that silently does nothing because you closed the
 * window is a hotkey people stop trusting.
 */
async function showView(view) {
  if (!NAVIGABLE.includes(view)) return;
  try {
    await ensureServer();
  } catch (error) {
    fatal(error);
    return;
  }
  let window = mainWindow;
  if (!window || window.isDestroyed()) window = createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  app.focus({ steal: true });
  /* Sent on every call, including the one that just created the window: the
     renderer buffers nothing, so a message sent before the page has attached
     its listener is lost. `did-finish-load` is the only moment it is certainly
     listening. */
  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", () => {
      window.webContents.send(NAVIGATE_CHANNEL, view);
    });
  } else {
    window.webContents.send(NAVIGATE_CHANNEL, view);
  }
}

// ---------------------------------------------------------------------------
// Global hotkeys
// ---------------------------------------------------------------------------

/**
 * Two shortcuts, chosen to be reachable and unclaimed.
 *
 * Ghost and Understudy are the two features whose entire value is that they are
 * available while you are inside another application — "what was that error"
 * and "draft this the way I would" are both asked with something else in front.
 * Everything else in Lore is a place you go.
 *
 * Registration is checked, not assumed: `register` returns false when another
 * application already owns the combination, and a shortcut that silently failed
 * to bind is indistinguishable from a broken feature.
 */
const SHORTCUTS = [
  { accelerator: "CommandOrControl+Shift+G", view: "ghost", label: "Ask Ghost" },
  { accelerator: "CommandOrControl+Shift+D", view: "understudy", label: "Draft in my voice" },
];

function registerShortcuts() {
  for (const shortcut of SHORTCUTS) {
    try {
      const ok = globalShortcut.register(shortcut.accelerator, () => {
        void showView(shortcut.view);
      });
      shortcut.registered = ok;
      if (!ok) {
        console.warn(`[lore] ${shortcut.accelerator} is already taken; ${shortcut.label} has no hotkey.`);
      }
    } catch {
      shortcut.registered = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Menu bar item
// ---------------------------------------------------------------------------

/**
 * The pause switch, one click from anywhere.
 *
 * Six features can be watching this machine, and the moment you need them to
 * stop — a screen share, a client's password on screen, a call you would rather
 * not have described — is the moment you cannot spend finding a settings
 * screen. So it lives in the menu bar, it stops everything at once, and the
 * icon says which state it is in.
 */
function trayIcon(paused) {
  /*
   * Drawn here rather than shipped as an asset. A template image on macOS is
   * pure alpha — the system recolours it for light and dark menu bars — so this
   * is a 16×16 circle: filled when observing, hollow when paused. Two files
   * saved, and no chance of the packaged build missing them.
   */
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4, 0);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - centre, y - centre);
      const inside = distance <= 6.2;
      const onRing = inside && distance >= 4.4;
      const lit = paused ? onRing : inside;
      if (!lit) continue;
      const offset = (y * size + x) * 4;
      /* Electron's BGRA order. Fully opaque black; macOS inverts a template
         image for dark menu bars, so the colour here is only its silhouette. */
      buffer[offset + 3] = 255;
    }
  }
  const image = nativeImage.createFromBuffer(buffer, { width: size, height: size });
  image.setTemplateImage(true);
  return image;
}

async function pauseObservers(minutes) {
  await askServer("/api/observers", { action: "pause", minutes });
  await refreshTray();
}

async function refreshTray() {
  if (!tray) return;
  const state = await askServer("/api/observers");
  const observers = state && Array.isArray(state.observers) ? state.observers : [];
  const on = observers.filter((observer) => observer.enabled);
  const pausedUntil = state ? state.pausedUntil : null;
  const paused = Boolean(pausedUntil && pausedUntil > Date.now());

  tray.setImage(trayIcon(paused));
  tray.setToolTip(
    paused
      ? "Lore — everything paused"
      : on.length
        ? `Lore — ${on.length} observer${on.length === 1 ? "" : "s"} running`
        : "Lore",
  );

  const items = [
    {
      label: paused
        ? `Paused until ${new Date(pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : on.length
          ? `Watching: ${on.map((observer) => observer.label).join(", ")}`
          : "Nothing is watching",
      enabled: false,
    },
    { type: "separator" },
  ];

  if (paused) {
    items.push({ label: "Resume everything", click: () => void pauseObservers(0) });
  } else {
    items.push(
      { label: "Pause for 15 minutes", click: () => void pauseObservers(15) },
      { label: "Pause for an hour", click: () => void pauseObservers(60) },
      { label: "Pause until tomorrow", click: () => void pauseObservers(12 * 60) },
    );
  }

  items.push(
    { type: "separator" },
    { label: "Ask Ghost", accelerator: "CommandOrControl+Shift+G", click: () => void showView("ghost") },
    { label: "Draft in my voice", accelerator: "CommandOrControl+Shift+D", click: () => void showView("understudy") },
    { label: "What Prophet has", click: () => void showView("prophet") },
    { type: "separator" },
    { label: "Open Lore", click: () => void showView("brief") },
    { label: "Quit Lore", click: () => app.quit() },
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(trayIcon(false));
    tray.on("click", () => void refreshTray());
    void refreshTray();
  } catch {
    /* A platform with no tray. The app is fully usable without it. */
  }
}

// ---------------------------------------------------------------------------
// Prophet notifications
// ---------------------------------------------------------------------------

/**
 * Ask Prophet whether anything is worth interrupting for.
 *
 * The threshold lives on the server (Prophet's own `notifyAbove`), so this
 * process makes no judgement about what is important — it posts what it is
 * handed and immediately tells the server it was posted, so the same card can
 * never be announced twice.
 */
async function checkProphet() {
  if (!Notification.isSupported()) return;
  const result = await askServer("/api/prophet?view=notifications");
  const cards = result && Array.isArray(result.cards) ? result.cards : [];
  if (!cards.length) return;

  const announced = [];
  for (const card of cards.slice(0, 2)) {
    try {
      const notification = new Notification({
        title: card.title,
        body: card.body || "",
        silent: false,
      });
      notification.on("click", () => void showView("prophet"));
      notification.show();
      announced.push(card.id);
    } catch {
      /* A failed notification must not stop the others, or the polling. */
    }
  }
  if (announced.length) {
    await askServer("/api/prophet", { action: "notified", ids: announced });
  }
  await refreshTray();
}

function startProphetPolling() {
  if (prophetTimer) return;
  prophetTimer = setInterval(() => void checkProphet(), PROPHET_POLL_MS);
  prophetTimer.unref?.();
}

function stopProphetPolling() {
  if (prophetTimer) clearInterval(prophetTimer);
  prophetTimer = null;
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
    {
      label: "Go",
      submenu: [
        { label: "Brief", click: () => void showView("brief") },
        { label: "Ask the wiki", click: () => void showView("ask") },
        { type: "separator" },
        {
          label: "Ask Ghost",
          accelerator: "CommandOrControl+Shift+G",
          click: () => void showView("ghost"),
        },
        {
          label: "Draft in my voice",
          accelerator: "CommandOrControl+Shift+D",
          click: () => void showView("understudy"),
        },
        { label: "Prophet", click: () => void showView("prophet") },
        { label: "Ledger", click: () => void showView("ledger") },
        { label: "Oracle", click: () => void showView("oracle") },
        { label: "Chorus", click: () => void showView("chorus") },
        { label: "Twin", click: () => void showView("twin") },
      ],
    },
    {
      label: "Privacy",
      submenu: [
        { label: "Pause everything for 15 minutes", click: () => void pauseObservers(15) },
        { label: "Pause everything for an hour", click: () => void pauseObservers(60) },
        { label: "Resume everything", click: () => void pauseObservers(0) },
        { type: "separator" },
        { label: "What is watching…", click: () => void showView("settings") },
      ],
    },
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
    /* Written before the server starts, because the server reads it during its
       own boot — a warm-up that runs first would see no file and conclude this
       is a browser session with no screen-recording permission. */
    writeDesktopFacts();
    Menu.setApplicationMenu(buildMenu());
    try {
      await ensureServer();
    } catch (error) {
      fatal(error);
      return;
    }
    createWindow();
    registerShortcuts();
    createTray();
    startProphetPolling();
  });

  app.on("window-all-closed", () => {
    /*
     * On macOS the app stays alive with no windows, and that is what makes the
     * hotkeys and the menu-bar pause switch worth having — closing the window
     * should not stop Ghost mid-afternoon. So the server keeps running there.
     *
     * Everywhere else there is no equivalent affordance: the last window
     * closing means the app is finished, so the child dies with it rather than
     * sitting on the port with nothing able to reach it.
     */
    if (process.platform !== "darwin") {
      stopServer();
      app.quit();
    }
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
    stopProphetPolling();
    globalShortcut.unregisterAll();
    /* The facts file says "a desktop shell is running and here is what it can
       do". Leaving it behind would make a later browser session believe it has
       global hotkeys it does not have. */
    clearDesktopFacts();
    stopServer();
  });

  // Last resort. If the main process is killed or throws its way out, no
  // Electron event fires — but these do, and an orphan holding 4646 is the
  // failure the next launch would inherit.
  process.on("exit", () => {
    clearDesktopFacts();
    stopServer({ immediate: true });
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      quitting = true;
      clearDesktopFacts();
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
