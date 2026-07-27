# Lore as a desktop app

Lore is a Node server app. Every route handler is `runtime: "nodejs"` and reads
request bodies and the user's filesystem, so there is no static bundle to load
into a window and no static export to make. The desktop build therefore does the
only thing that actually works: it runs the Next.js **standalone** server as a
child process on loopback and points a window at it.

That is also why this is Electron and not Tauri. Tauri has no Node runtime, so
it would mean either rewriting Lore's entire filesystem layer in Rust or
shipping a Node sidecar of roughly the same size Electron already includes.

## Build status — what has actually been produced

Everything below was run, not assumed. Host: macOS 27, Apple Silicon,
Node 22.22.3, electron 43.2.0, electron-builder 26.15.3.

| Target | Built here? | Artifact |
| --- | --- | --- |
| macOS dmg arm64 | yes | `dist-desktop/Lore-0.1.0-arm64.dmg` (137 MB) |
| macOS dmg x64 | yes | `dist-desktop/Lore-0.1.0-x64.dmg` (139 MB) |
| Linux deb arm64 | yes | `dist-desktop/Lore-0.1.0-arm64.deb` (108 MB) |
| Linux deb x64 | yes | `dist-desktop/Lore-0.1.0-amd64.deb` (114 MB) |
| Linux AppImage | **no — cannot be built on macOS**, see below | — |
| Windows nsis | not run here, needs Windows or Wine | — |

All four carry the app icon (`build/icon.png`); no build logs
`default Electron icon is used`.

The packaged macOS app was launched, its child server answered
`GET /api/vault` with `200`, and no server process survived quitting the app.

### AppImage cannot be assembled on macOS

`npx electron-builder --linux` packages the Linux payload fine — both
`dist-desktop/linux-unpacked` and `dist-desktop/linux-arm64-unpacked` are
produced — and then fails at the AppImage step with:

```
⨯ failed to build AppImage  error=spawn Unknown system error -86
    at buildLegacyFuse2AppImage (app-builder-lib/src/targets/appimage/appImageUtil.ts:112)
```

Error 86 is `EBADARCH`. electron-builder's AppImage target shells out to
`mksquashfs` from its `appimage-12.0.1` tool bundle, and that binary is a Linux
ELF:

```
~/Library/Caches/electron-builder/appimage-12.0.1/.../linux-arm64/mksquashfs:
  ELF 64-bit LSB executable, ARM aarch64, ... for GNU/Linux 3.7.0
```

macOS cannot exec it. There is no configuration fix — the AppImage target must
run on Linux, or in a Linux container:

```bash
docker run --rm -it -v "$PWD":/project -w /project \
  electronuserland/builder:latest \
  bash -c "npm ci && npm run build && npx electron-builder --linux --publish never"
```

The deb built on this machine shares the identical payload and the identical
generated `.desktop` entry, so the Linux configuration itself is verified; only
the AppImage *assembly step* is blocked by the host OS.

## What the shell does

- `electron/main.js` — spawns the standalone server, waits until it answers,
  then creates the window. Owns the native menu, the folder picker, and the
  child process's life.
- `electron/preload.js` — the whole renderer bridge: `window.lore`, four
  members, no generic IPC passthrough.
- `electron-builder.yml` — dmg (arm64 + x64), nsis (x64), AppImage and deb
  (x64 + arm64).

Details worth knowing:

**Mode.** The child process is spawned with `LORE_MODE=local`. This is not
cosmetic. `lib/mode.ts` infers *site* mode — which 404s every filesystem route
and redirects `/vault` to `/install` — from any of `VERCEL`, `NETLIFY`,
`RENDER`, `FLY_APP_NAME`, `RAILWAY_ENVIRONMENT`, `AWS_LAMBDA_FUNCTION_NAME`,
`K_SERVICE` in the environment, and the child inherits the user's environment.
`LORE_MODE=local` is checked before all of them. Verified both ways against the
packaged app with `VERCEL=1` deliberately injected:

```
with    LORE_MODE=local   GET /api/vault -> 200  {"vaults":[…]}
without LORE_MODE         GET /api/vault -> 404  {"error":"Not found."}
```

This only ever *disables* site mode for a process the user launched on their own
machine. It opens no hole: `proxy.ts` still requires a loopback `Host` header,
and the server is still bound to `127.0.0.1`.

**Port.** The shell prefers `4646`, because Lore's Connections screen prints an
MCP config that hardcodes that port. If `4646` is taken — usually by
`npm run dev` — it falls back to an OS-assigned free port. In that case the app
still works, but the MCP snippet the Connections screen shows will point at the
wrong port; agents need `LORE_URL=http://127.0.0.1:<actual port>` instead. The
actual port is in the window's URL. (The fallback is exercised, not theoretical:
the verification run above landed on 50097 because a dev server held 4646.)

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

There is no `dist:linux` script yet; use the raw command below, or add
`"dist:linux": "npm run build && electron-builder --linux"` to match the others.

## Build and run

Every command assumes `npm ci` has run.

### Any platform, unpackaged

```bash
npm run build              # produces .next/standalone
npm run electron           # runs the shell against that build
```

`npm run electron` needs a `npm run build` first — the shell runs the production
standalone server, not `next dev`. For UI work, keep using `npm run dev`.

### macOS (run on macOS)

```bash
npm run build
npx electron-builder --mac --publish never
# → dist-desktop/Lore-<version>-arm64.dmg
# → dist-desktop/Lore-<version>-x64.dmg
```

Cross-compiling the x64 dmg from Apple Silicon works and is done above; the x64
build is not signed or notarized either, so nothing about it needs a matching
host.

### Windows (run on Windows)

```bat
npm run build
npx electron-builder --win --publish never
REM  -> dist-desktop\Lore Setup <version>.exe
```

From macOS or Linux this requires Wine and is the least reliable path. Building
on Windows or in a Windows CI runner is the path of least resistance.

### Linux (run on Linux, or in a Linux container)

```bash
npm run build
npx electron-builder --linux --publish never
# → dist-desktop/Lore-<version>-x86_64.AppImage
# → dist-desktop/Lore-<version>-arm64.AppImage
# → dist-desktop/Lore-<version>-amd64.deb
# → dist-desktop/Lore-<version>-arm64.deb
```

The **deb** target alone does build on macOS, because fpm ships a Darwin binary:

```bash
npx electron-builder --linux deb --publish never
```

The AppImage target does not — see the top of this file.

The deb declares its runtime dependencies explicitly (`libgtk-3-0`,
`libnotify4`, `libnss3`, `libxss1`, `libxtst6`, `xdg-utils`,
`libatspi2.0-0`, `libsecret-1-0`). Node is deliberately not among them: the
server runs on Electron's bundled Node.

The generated desktop entry, taken from the built deb:

```
[Desktop Entry]
Name=Lore
Exec=/opt/Lore/lore %U
Terminal=false
Type=Application
Icon=lore
StartupWMClass=Lore
Keywords=markdown;wiki;notes;agent;mcp;
Comment=Lore is a local-first markdown wiki manager. …
Categories=Utility;TextEditor;Development;
```

`Categories` comes from `linux.category`, **not** from `linux.desktop.entry`.
electron-builder writes `Categories` from `linux.category` after merging
`desktop.entry`, so a `Categories` key placed in `desktop.entry` is silently
overwritten. The full semicolon-separated list therefore lives in `category`.

### What ends up in the package

The asar holds only `electron/main.js`, `electron/preload.js`, and
`package.json` — verified with `npx asar list`. Everything the server needs is
copied to `Resources/app-server`, unpacked, because Next reads its chunks and
traced `node_modules` from disk:

| From                        | To                        | Why |
| --------------------------- | ------------------------- | --- |
| `.next/standalone`          | `app-server`              | the server itself |
| `.next/standalone/node_modules` | `app-server/node_modules` | the traced dependencies — see the landmine below |
| `.next/static`              | `app-server/.next/static` | Next does not copy this itself |
| `public`                    | `app-server/public`       | same |
| `mcp`                       | `app-server/mcp`          | the Connections screen points agents at `<cwd>/mcp/server.mjs` |

**Landmine: `node_modules` needs its own extraResources entry.** electron-builder
applies one filter to every copy it performs, including `extraResources`, and
that filter contains a hard-coded rule
(`app-builder-lib/out/util/filter.js`):

```js
// filter the root node_modules, but not a subnode_modules
if (relative === "node_modules") {
  return false;
}
```

So `from: .next/standalone` drops `.next/standalone/node_modules` on the floor,
without a warning, and the packaged app dies at launch with:

```
Error: Cannot find module 'next'
Require stack:
- …/Lore.app/Contents/Resources/app-server/server.js
```

The fix is the second entry in the table: a matcher whose `from` starts *inside*
`node_modules`, so no path it sees is ever the bare string the filter rejects.
Do not collapse those two entries back into one.

**Landmine: the build will eat its own output if you let it.** Next's file
tracer copies the *entire project directory* into `.next/standalone` — `app/`,
`components/`, `docs/`, `README.md`, and, once it exists, `dist-desktop/`. So
the second `npm run build` folds the first build's artifacts into the standalone
bundle, electron-builder copies that into `app-server`, and the third build
folds *those* in again. Measured on this machine before the fix: 137 MB → 1.0 GB
in a single generation, with the dmg containing a copy of itself.

The `filter` on the `.next/standalone` entry excludes the output directory, and
that name must stay in step with `directories.output`. Verified: after a rebuild
with `dist-desktop` already present, `.next/standalone` is 951 MB but the
packaged `app-server` is 56 MB and contains no `dist-desktop`.

Note that the *source* bloat is unfixed and lives outside this directory: the
standalone bundle still ships `app/`, `components/`, `lib/`, `docs/`,
`package-lock.json`, and `tsconfig.tsbuildinfo` because the tracer put them
there. Trimming that means `outputFileTracingExcludes` in `next.config.ts`. The
disk cost of `.next/standalone` locally after a second build is also real —
`rm -rf .next dist-desktop` between packaging runs keeps it honest.

If Lore ever moves into a monorepo, `outputFileTracingRoot` changes and the
standalone output gains a nested project directory — both `.next/standalone`
paths above would need to follow it.

### Icons

`icon: build/icon.png` — a single 512×512 PNG at the project root is the whole
icon configuration, and every artifact above was built with it (no run logs
`default Electron icon is used`). electron-builder derives the per-platform
formats from it:

- **macOS** — a multi-resolution `icon.icns` in `Lore.app/Contents/Resources`.
  Verified in both dmgs.
- **Linux** — one file, `usr/share/icons/hicolor/512x512/apps/lore.png`.
  Verified by unpacking the deb. A single PNG source yields a single installed
  size; desktop environments downscale it. Pointing `icon` at a *directory* of
  sized PNGs (`16x16.png`, `32x32.png`, …) is what produces a full hicolor set,
  and is worth doing only if the downscale looks bad in a panel.
- **Windows** — a generated `.ico`, from the same file. Not built here.

A hand-tuned `build/icon.icns` or `build/icon.ico` placed beside it takes
precedence over the generated ones, with no config change.

## Code signing is NOT configured

Nothing produced by this config is signed on any platform. Be clear about what
that means per platform.

### macOS — unsigned, un-notarized

`mac.identity` is set to `null`, which skips signing entirely; the build log
says `skipped macOS code signing  reason=identity explicitly is set to null`.

- **Distributing it.** A user who downloads the DMG is blocked on first launch.
  They have to open **System Settings → Privacy & Security** and choose **Open
  Anyway** for that specific app. On macOS 15 and later the old Control-click →
  Open shortcut no longer bypasses this. Every user must do this once, manually.
- **Fixing it costs $99/yr.** A Developer ID certificate requires an Apple
  Developer Program membership. A free personal Apple developer account cannot
  create one — it issues local development certificates only, which cannot sign
  software for distribution. There is no free path to a Gatekeeper-clean macOS
  build.

Two adjacent options, neither of which is distribution:

- `mac.identity: "-"` requests an **ad-hoc** signature. Useful for running a
  build on the machine that produced it; Gatekeeper does not trust it for
  distribution, so it does not help anyone else.
- With `identity: null` as configured, an unsigned build still runs locally via
  the same System Settings approval.

Notarization (`notarize:`) is also not configured — it requires the same paid
membership plus an app-specific password or API key.

### Windows — unsigned

The NSIS installer is unsigned. SmartScreen shows "Windows protected your PC"
and the user must click **More info → Run anyway**. A standard (OV) code signing
certificate quiets the publisher warning, but SmartScreen reputation still
accrues over downloads, so early installs can be flagged anyway; an EV
certificate gets reputation immediately. Both are paid, per year, from a CA.

### Linux — unsigned, and mostly nobody checks

Neither the AppImage nor the deb is signed, and no repository is published.

- **AppImage.** Nothing verifies it. The user must `chmod +x` it before it will
  run, and on many distributions an AppImage built with the legacy runtime needs
  FUSE 2 (`libfuse2` / `fuse2`) installed; without it the file exits with
  `dlopen(): error loading libfuse.so.2`. Running it with `--appimage-extract-and-run`
  is the workaround.
- **deb.** `dpkg -i Lore-<version>-<arch>.deb` installs it and prints no signing
  complaint; only `apt` against a signed *repository* checks signatures, and
  there is no repository here. `apt install ./Lore-<version>-<arch>.deb` pulls
  the dependencies listed above.
- There is no equivalent of Gatekeeper or SmartScreen to appease, so unlike
  macOS and Windows the unsigned Linux artifacts have no user-facing warning to
  work around. Signing them would mean publishing a GPG-signed apt repo, which
  is a distribution decision, not a build one.

## Renderer integration (not wired up)

`window.lore` exists but nothing in `components/lore/` consumes it yet. Wiring
it is a one-file change in whichever component owns vault linking (today
`components/lore/onboarding.tsx` calls `POST /api/pick`, which shells out to
`osascript` and is macOS-only — so on Windows and Linux the browse button does
nothing until this is wired).

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
present — it is the same dialog on macOS and the only one that works on Windows
and Linux. Feed the returned path to the existing `POST /api/vault` with
`{ action: "link", path }`, exactly as the browse button already does.

`chooseVaultFolder()` returns the path and does not also emit
`onVaultFolderChosen`; the menu item emits and does not return. One folder
choice arrives exactly once, whichever way it was triggered.
