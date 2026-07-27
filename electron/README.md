# Lore as a desktop app

Lore is a Node server app. Every route handler is `runtime: "nodejs"` and reads
request bodies and the user's filesystem, so there is no static bundle to load
into a window and no static export to make. The desktop build therefore does the
only thing that actually works: it runs the Next.js **standalone** server as a
child process on localhost and points a window at it.

That is also why this is Electron and not Tauri. Tauri has no Node runtime, so
it would mean either rewriting Lore's entire filesystem layer in Rust or
shipping a Node sidecar of roughly the same size Electron already includes.

## What the shell does

- `electron/main.js` — spawns the standalone server, waits until it answers,
  then creates the window. Owns the native menu, the folder picker, and the
  child process's life.
- `electron/preload.js` — the whole renderer bridge: `window.lore`, four
  members, no generic IPC passthrough.
- `electron-builder.yml` — dmg (arm64 + x64) and nsis (x64).

Details worth knowing:

**Port.** The shell prefers `4646`, because Lore's Connections screen prints an
MCP config that hardcodes that port. If `4646` is taken — usually by
`npm run dev` — it falls back to an OS-assigned free port. In that case the app
still works, but the MCP snippet the Connections screen shows will point at the
wrong port; agents need `LORE_URL=http://127.0.0.1:<actual port>` instead. The
actual port is in the window's URL.

**Startup.** The window is not created until an HTTP request to the child comes
back. Showing a window against a server that is not listening yet renders a
connection error, which is the single most common way an Electron + Next app
looks broken on first launch.

**Shutdown.** The child is killed when the last window closes, on `before-quit`,
on the main process's `exit`, and on SIGINT/SIGTERM/SIGHUP. An orphaned Next
server holding the port is the second most common failure — the next launch
cannot bind and has no idea why.

On macOS the app stays alive with no windows open (platform convention), but the
server does not: closing the window stops it, and clicking the dock icon starts
it again before re-opening the window. Practically this means **agents cannot
reach Lore over MCP while the window is closed.** Quit or keep it open; there is
no background mode.

**Node.** The child is spawned as `process.execPath` with
`ELECTRON_RUN_AS_NODE=1`, i.e. Electron's own bundled Node. The packaged app
does not require Node to be installed.

**Security.** `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`. `http(s)` links open in the user's real browser.

## What this depends on outside `electron/`

Both of these are already in place; they are listed because breaking either one
breaks the desktop build in a way whose error message points here.

### 1. `next.config.ts` sets `output: "standalone"`

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["gray-matter"],
};
```

Without it, `.next/standalone/server.js` is never produced and the app exits
with a dialog saying exactly that.

### 2. `package.json` has `main`, the scripts, and the dev dependencies

```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron": "electron electron/main.js",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:win": "npm run build && electron-builder --win"
  },
  "devDependencies": {
    "electron": "43.2.0",
    "electron-builder": "26.15.3"
  }
}
```

`"main"` is what makes the packaged app load the shell instead of looking for
`index.js`. The two versions above are what this shell was verified against.

## Build and run

```bash
npm run build              # produces .next/standalone
npm run electron           # runs the shell against that build

npm run dist:mac           # dist-desktop/Lore-<version>-arm64.dmg and -x64.dmg
npm run dist:win           # dist-desktop/Lore Setup <version>.exe
```

`npm run electron` needs a `npm run build` first — the shell runs the production
standalone server, not `next dev`. For UI work, keep using `npm run dev`.

Cross-building the Windows installer from macOS requires Wine; building it on
Windows or in CI is the path of least resistance.

### What ends up in the package

The asar holds only `electron/main.js`, `electron/preload.js`, and
`package.json`. Everything the server needs is copied to `Resources/app-server`,
unpacked, because Next reads its chunks and traced `node_modules` from disk:

| From              | To                       | Why |
| ----------------- | ------------------------ | --- |
| `.next/standalone` | `app-server`            | the server and its traced dependencies |
| `.next/static`     | `app-server/.next/static` | Next does not copy this itself |
| `public`           | `app-server/public`      | same |
| `mcp`              | `app-server/mcp`         | the Connections screen points agents at `<cwd>/mcp/server.mjs` |

If Lore ever moves into a monorepo, `outputFileTracingRoot` changes and the
standalone output gains a nested project directory — the `from: .next/standalone`
path here would need to follow it.

### Icons

No app icon is configured, so builds use the default Electron icon. Drop
`build/icon.icns` and `build/icon.ico` at the project root and electron-builder
picks them up with no config change.

## Code signing is NOT configured

Be clear about what an unsigned build is and is not.

### macOS

`mac.identity` is set to `null`, which skips signing entirely. Two consequences,
stated precisely:

- **Distributing it.** The app is neither signed with a Developer ID nor
  notarized. A user who downloads the DMG will be blocked on first launch; they
  have to open **System Settings → Privacy & Security** and choose **Open
  Anyway** for that specific app. On macOS 15 and later the old Control-click →
  Open shortcut no longer bypasses this. Every user must do this once, manually.
- **Fixing it costs $99/yr.** A Developer ID certificate requires an Apple
  Developer Program membership. A free personal Apple developer account cannot
  create one — it issues local development certificates only, which cannot sign
  software for distribution. There is no free path to a Gatekeeper-clean macOS
  build.

Two adjacent options, neither of which is distribution:

- `mac.identity: "-"` requests an **ad-hoc** signature. It is useful for running
  a build on the machine that produced it; Gatekeeper does not trust it for
  distribution, so it does not help anyone else.
- With `identity: null` as configured, an unsigned build still runs on Apple
  Silicon locally, via the same System Settings approval.

Notarization (`notarize:`) is also not configured — it requires the same paid
membership plus an app-specific password or API key.

### Windows

The NSIS installer is unsigned. SmartScreen will show "Windows protected your
PC" and the user must click **More info → Run anyway**. A standard (OV) code
signing certificate quiets the publisher warning but SmartScreen reputation
still accrues over downloads, so early installs can be flagged anyway; an EV
certificate gets reputation immediately. Both are paid, per year, from a CA.

## Renderer integration (not wired up)

`window.lore` exists but nothing in `components/lore/` consumes it yet. Wiring
it is a one-file change in whichever component owns vault linking (today
`components/lore/onboarding.tsx` calls `POST /api/pick`, which shells out to
`osascript` and is macOS-only).

The API:

```ts
interface LoreDesktop {
  isDesktop: true;
  platform: NodeJS.Platform;
  /** Native folder picker. Resolves to an absolute path, or null if cancelled. */
  chooseVaultFolder(): Promise<string | null>;
  /** Fires when the folder came from the File menu. Returns an unsubscribe fn. */
  onVaultFolderChosen(handler: (folder: string) => void): () => void;
}

declare global {
  interface Window {
    lore?: LoreDesktop;
  }
}
```

Use `window.lore?.chooseVaultFolder()` in preference to `/api/pick` when it is
present — it is the same dialog on macOS and the only one that works on Windows.
Feed the returned path to the existing `POST /api/vault` with
`{ action: "link", path }`, exactly as the browse button already does.

`chooseVaultFolder()` returns the path and does not also emit
`onVaultFolderChosen`; the menu item emits and does not return. One folder
choice arrives exactly once, whichever way it was triggered.
