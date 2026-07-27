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
| Linux AppImage arm64 | yes — **but not with the default toolset**, see below | `dist-desktop/Lore-0.1.0-arm64.AppImage` (133 MB) |
| Linux AppImage x64 | yes — same caveat | `dist-desktop/Lore-0.1.0-x86_64.AppImage` (134 MB) |
| Windows nsis | not run here, needs Windows or Wine | — |

All six carry the app icon (`build/icon.png`); no build run logged
`default Electron icon is used`.

The packaged arm64 server was spawned exactly the way `main.js` does
(`Lore.app/Contents/MacOS/Lore` with `ELECTRON_RUN_AS_NODE=1`,
`HOSTNAME=127.0.0.1`, `LORE_MODE=local`, and `VERCEL=1` injected to prove the
mode override):

```
/api/vault                      -> 200  {"vaults":[…]}
/vault                          -> 200
/                               -> 200
/api/vault  Host: evil.example.com -> 403      (loopback boundary intact)
lsof                            -> TCP 127.0.0.1:<port> (LISTEN)   — loopback only
after kill                      -> 0 listeners
```

### The AppImage target needs a non-default toolset on macOS

`npx electron-builder --linux` with the config exactly as it stands packages the
Linux payload fine — both `dist-desktop/linux-unpacked` and
`dist-desktop/linux-arm64-unpacked` are produced — and then fails at the
AppImage step with:

```
⨯ failed to build AppImage  error=spawn Unknown system error -86
    at buildLegacyFuse2AppImage (app-builder-lib/src/targets/appimage/appImageUtil.ts:112)
```

Errno 86 on macOS is `EBADARCH`, "Bad CPU type in executable". The cause is not
the target platform — it is the *host* binary electron-builder picks. In
`app-builder-lib/out/toolsets/linux.js`, `getAppImageTools()` falls into
`getFuse2Paths()` for the default toolset version, and that helper chooses the
tool directory by host platform:

```js
const toolRoot = process.platform === "linux" ? `linux-${hostArch}` : "darwin"
```

So on macOS it runs `appimage-12.0.1/…/darwin/mksquashfs`, and that binary is
`Mach-O 64-bit executable x86_64` — Intel only. On an Apple Silicon machine
without Rosetta 2 installed, exec'ing it fails with EBADARCH. Running it by hand
gives the same thing:

```
$ …/appimage-12.0.1/…/darwin/mksquashfs -version
bad CPU type in executable
```

There is a configuration fix. `toolsets.appimage` selects the AppImage toolset;
its default is `0.0.0` (the legacy FUSE 2 toolset, the one above), and versions
`1.0.2` / `1.0.3` use a newer static runtime whose `mksquashfs` is a wrapper
script that dispatches to a `darwin/arm64` binary. Both AppImages in the table
were built on this machine with:

```bash
npx electron-builder --linux AppImage --arm64 --x64 --publish never \
  -c.toolsets.appimage=1.0.3
```

`electron-builder`'s own schema marks `1.0.2` and `1.0.3` as betas, which is why
they are passed on the command line here rather than pinned into
`electron-builder.yml`. Installing Rosetta 2 would presumably also let the
legacy toolset run; that was not tested.

A Linux container avoids the question entirely and is still the honest path for
a release build, since the host binaries are then the native ones:

```bash
docker run --rm -it -v "$PWD":/project -w /project \
  electronuserland/builder:latest \
  bash -c "npm ci && npm run build && npx electron-builder --linux --publish never"
```

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
                          GET /vault     -> 307 → /install
```

This only ever *disables* site mode for a process the user launched on their own
machine. It opens no hole: `proxy.ts` still requires a loopback `Host` header,
and the server is still bound to `127.0.0.1`.

**Port.** The shell prefers `4646`, because Lore's Connections screen prints an
MCP config that hardcodes that port (`APP_PORT` in `lib/brand.ts`, and
`env: { LORE_URL: "http://127.0.0.1:4646" }` in `lib/harness.ts`). If `4646` is
taken — usually by `npm run dev` — `choosePort()` falls back to an OS-assigned
free port. In that case the app still works, but the MCP snippet the Connections
screen shows will point at the wrong port; agents need
`LORE_URL=http://127.0.0.1:<actual port>` instead. The actual port is in the
window's URL.

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
    "dist:mac": "npm run build && electron-builder --mac --arm64 --x64",
    "dist:win": "npm run build && electron-builder --win --x64",
    "dist:linux": "npm run build && electron-builder --linux --x64 --arm64"
  },
  "devDependencies": {
    "electron": "43.2.0",
    "electron-builder": "26.15.3"
  }
}
```

`"main"` is what makes the packaged app load the shell instead of looking for
`index.js`. The two versions above are what this shell was verified against.

`dist:linux` passes no toolset override, so on macOS it stops at the AppImage
step — see above. It builds both debs first, and those are kept.

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
npm run dist:mac
# or: npm run build && npx electron-builder --mac --publish never
# → dist-desktop/Lore-<version>-arm64.dmg
# → dist-desktop/Lore-<version>-x64.dmg
```

The `mac.target` block already lists both arches, so a bare `--mac` builds both.
Cross-compiling the x64 dmg from Apple Silicon works and is done above; the x64
build is not signed or notarized either, so nothing about it needs a matching
host.

### Windows (run on Windows)

```bat
npm run dist:win
REM  -> dist-desktop\Lore Setup <version>.exe
```

Not built here. From macOS or Linux this requires Wine and is the least reliable
path. Building on Windows or in a Windows CI runner is the path of least
resistance.

### Linux (run on Linux, or in a Linux container)

```bash
npm run build
npx electron-builder --linux --publish never
# → dist-desktop/Lore-<version>-x86_64.AppImage
# → dist-desktop/Lore-<version>-arm64.AppImage
# → dist-desktop/Lore-<version>-amd64.deb
# → dist-desktop/Lore-<version>-arm64.deb
```

On macOS the same command needs `-c.toolsets.appimage=1.0.3` to get past the
AppImage step; the **deb** target alone builds unmodified, because the fpm
electron-builder downloads for a Darwin host is a `darwin-arm64` build:

```bash
npx electron-builder --linux deb --publish never
```

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
// filter the root node_modules, but not a subnode_modules (like /appDir/others/foo/node_modules/blah)
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
folds *those* in again — the dmg ends up containing a copy of itself, and it
compounds with every generation.

The `filter` on the `.next/standalone` entry excludes the output directory, and
that name must stay in step with `directories.output`. Measured on this machine
after several packaging runs: `.next/standalone` is 1.7 GB, of which
`.next/standalone/dist-desktop` alone is 1.6 GB — while the packaged
`app-server` is 52 MB (macOS arm64) and contains no `dist-desktop`.

Note that the *source* bloat is unfixed and lives outside this directory: the
standalone bundle still ships `app/`, `components/`, `lib/`, `docs/`,
`package-lock.json`, and `tsconfig.tsbuildinfo` because the tracer put them
there. Trimming that means `outputFileTracingExcludes` in `next.config.ts`. The
disk cost of `.next/standalone` locally is also real — `rm -rf .next
dist-desktop` between packaging runs keeps it honest.

If Lore ever moves into a monorepo, `outputFileTracingRoot` changes and the
standalone output gains a nested project directory — both `.next/standalone`
paths above would need to follow it.

### Icons

`icon: build/icon.png` — a single 512×512 RGBA PNG in `build/` is the whole icon
configuration, and every artifact above was built with it (no run logged
`default Electron icon is used`). electron-builder derives the per-platform
formats from it:

- **macOS** — a multi-resolution `icon.icns` in `Lore.app/Contents/Resources`,
  carrying nine entries from `icp4` up to `ic13`. Verified inside both mounted
  dmgs.
- **Linux** — one file, `usr/share/icons/hicolor/512x512/apps/lore.png`.
  Verified by unpacking the deb. A single PNG source yields a single installed
  size; desktop environments downscale it. Pointing `icon` at a *directory* of
  sized PNGs (`16x16.png`, `32x32.png`, …) is what produces a full hicolor set,
  and is worth doing only if the downscale looks bad in a panel.
- **Windows** — a generated `.ico`, from the same file. Not built here.

A hand-tuned `build/icon.icns` or `build/icon.ico` placed beside it takes
precedence over the generated ones, with no config change.

## Code signing is NOT configured

Nothing produced by this config carries a signature anyone trusts. Be clear
about what that means per platform.

### macOS — no Developer ID, un-notarized

`mac.identity` is set to `null`, which skips electron-builder's signing step
entirely; the build log says
`skipped macOS code signing  reason=identity explicitly is set to null`.

What is actually in the bundles, per `codesign -dv`:

- arm64: `Signature=adhoc`, `flags=0x20002(adhoc,linker-signed)` — the ad-hoc
  signature the linker applies because arm64 macOS refuses to execute a
  completely unsigned Mach-O. It carries no identity and no team ID.
- x64: `code object is not signed at all`.

Neither is a distributable signature.

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

- `mac.identity: "-"` requests an **ad-hoc** signature explicitly. Useful for
  running a build on the machine that produced it; Gatekeeper does not trust it
  for distribution, so it does not help anyone else.
- With `identity: null` as configured, the build still runs locally via the same
  System Settings approval.

Notarization (`notarize:`) is also not configured — it requires the same paid
membership plus an app-specific password or API key
(`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, or the
`APPLE_API_KEY` trio).

### Windows — unsigned

The NSIS installer is unsigned. SmartScreen shows "Windows protected your PC"
and the user must click **More info → Run anyway**. A standard (OV) code signing
certificate quiets the publisher warning, but SmartScreen reputation still
accrues over downloads, so early installs can be flagged anyway; an EV
certificate gets reputation immediately. Both are paid, per year, from a CA.

### Linux — unsigned, and mostly nobody checks

Neither the AppImage nor the deb is signed, and no repository is published.

- **AppImage.** Nothing verifies it. The user must `chmod +x` it before it will
  run. The runtime embedded by the `1.0.3` toolset statically links libfuse and
  squashfuse, so no `libfuse2` package is needed — but it still mounts itself,
  so it needs `/dev/fuse` and a `fusermount` on `$PATH`. Its own error strings
  are `Cannot mount AppImage, please check your FUSE setup.` and
  `Error: No suitable fusermount binary found on the $PATH`. In a container or
  on a host without FUSE, run it with `--appimage-extract-and-run`.
- **deb.** `dpkg -i Lore-<version>-<arch>.deb` installs it and prints no signing
  complaint; only `apt` against a signed *repository* checks signatures, and
  there is no repository here. `apt install ./Lore-<version>-<arch>.deb` pulls
  the dependencies listed above.
- There is no equivalent of Gatekeeper or SmartScreen to appease, so unlike
  macOS and Windows the unsigned Linux artifacts have no user-facing warning to
  work around. Signing them would mean publishing a GPG-signed apt repo, which
  is a distribution decision, not a build one.

## Renderer integration

`window.lore` is consumed. `lib/desktop.ts` wraps it and
`components/lore/onboarding.tsx` uses both members: `chooseVaultFolder()` behind
the Browse button, and `onVaultFolderChosen()` so a folder picked from the
native File menu is handled as if Browse had been clicked.

The contract lives in `lib/desktop.ts` and must stay in step with
`electron/preload.js`:

```ts
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
```

Two helpers go with it:

- `desktopBridge()` returns `window.lore` or `null`, SSR-safe.
- `canPickFolder()` answers whether *any* real picker exists. The Electron
  bridge works on all three desktop platforms; the browser fallback,
  `POST /api/pick`, shells out to `osascript` and returns 501 off macOS. So a
  browser on Windows or Linux has neither, and onboarding hides the Browse
  button rather than offering one that cannot work. There is still no folder
  picker for a Windows or Linux user running Lore in a browser instead of the
  desktop app — only the path text field.

New code that needs a folder should prefer `desktopBridge()?.chooseVaultFolder()`
over `/api/pick`, and feed the returned path to `POST /api/vault` with
`{ action: "link", path }`, exactly as onboarding does.

`chooseVaultFolder()` returns the path and does not also emit
`onVaultFolderChosen`; the menu item emits and does not return. One folder
choice arrives exactly once, whichever way it was triggered.
