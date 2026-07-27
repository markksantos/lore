# Deploying Lore

Lore is one codebase serving two shapes. Getting this distinction wrong is the
only way to turn it into a security problem, so it is worth being precise.

| | Local app | Public site |
| --- | --- | --- |
| What it is | The real product | The marketing page |
| Filesystem access | Full — that is the point | None. Every filesystem route 404s |
| `/vault` | The app | Redirects to `/install` |
| Binds to | `127.0.0.1` only | Whatever the host sets — `site:start` takes the Next default |
| Run with | `npm run dev` / `npm start` | `LORE_MODE=site` (`npm run site:build` / `npm run site:start`) |

## Why the app cannot be hosted

Lore reads and writes a folder you choose. Hosted, that folder would be the
*server's* filesystem, and `POST /api/vault {action:"link", path:"/"}` from a
stranger would hand them everything on the box. There is no version of this
that is safe to expose, so in site mode `proxy.ts` intercepts every
filesystem-touching route before it runs and returns 404. The route code still
ships in the bundle; it is dead at the boundary, which is why the boundary is
the only thing that has to be right.

## Deploying the public site

```bash
vercel --prod
```

`vercel.json` sets `LORE_MODE=site` for both the build and the runtime, and
`proxy.ts` enforces it. Any other host works the same way — set
`LORE_MODE=site` and the app half switches off. `npm run site:build` and
`npm run site:start` set it for you locally.

Site mode is also **inferred** by `lib/mode.ts`: `VERCEL`, `NETLIFY`, `RENDER`,
`FLY_APP_NAME`, `RAILWAY_ENVIRONMENT`, `AWS_LAMBDA_FUNCTION_NAME` and
`K_SERVICE` each flip it on automatically, and an explicit `LORE_MODE=local`
overrides all of them.

Read the limit of that exactly: inference covers those seven variables and
nothing else. On a plain VPS, a Docker host, or any PaaS that sets none of
them, `isSiteMode()` returns false and the app half is live — started with no
`LORE_MODE` set, `GET /api/vault` answers 200. Deploying this repo anywhere
outside that list does **not** fail safe. Set `LORE_MODE=site` yourself, and
prove it with the curls below before the URL is reachable by anyone.

## Verifying a deployment

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-SITE/api/vault    # expect 404
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-SITE/vault        # expect 307 -> /install
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-SITE/install      # expect 200
```

If the first one returns anything but 404, stop and fix it before sharing the
URL.

## Distributing the app

Three routes, in increasing order of polish:

1. **From source** — clone, `npm install`, `npm run dev`. Documented on `/install`.
2. **Desktop build** — `npm run dist:mac`, `npm run dist:win`, `npm run dist:linux`.
   Each runs `next build` first, then `electron-builder`; artifacts land in
   `dist-desktop`. Targets, from `electron-builder.yml`: dmg (arm64 + x64), NSIS
   installer (x64), AppImage and deb (both x64 + arm64). Unsigned; macOS asks for
   approval in System Settings, Windows SmartScreen warns. `identity: null` and
   `hardenedRuntime: false` are set deliberately so electron-builder cannot pick
   up an unrelated keychain identity. Signing needs an Apple Developer membership
   ($99/yr — a free personal team cannot issue a Developer ID) and a Windows
   certificate. Neither is configured.
3. **Signed, notarised builds** — not done. This is the remaining work before a
   general audience can install without being told to click past a warning.

## Local security posture

- `npm run dev` and `npm start` bind `127.0.0.1` (`-H 127.0.0.1 -p 4646`), and
  `electron/main.js` spawns the packaged server with `HOSTNAME=127.0.0.1`. The
  default Next.js bind is `0.0.0.0`, which put the vault on the LAN — that was a
  real defect, not a theoretical one. The bind is the load-bearing protection.
- `proxy.ts` additionally rejects any filesystem request whose `Host` is not
  loopback, covering the cases that bypass the bind: a manual `-H 0.0.0.0`, a
  container publishing the port, or a reverse proxy in front. It is a hint, not
  a peer check, and `proxy.ts` says so in its own comments: anyone who can open
  the socket can send `Host: localhost` and land in the loopback branch. Started
  on `-H 0.0.0.0`, a request from a LAN address with a forged
  `Host: localhost` returns 200 on `/api/vault` — measured, not assumed. Do not
  open the port and expect this check to hold.
- Paired remote access is the one sanctioned way past that boundary: off until
  the user enables it, 32 random bytes stored `0600` in `~/.lore/remote.json`,
  constant-time comparison, rate-limited failures. It is also currently
  unreachable by design — nothing in the repo binds anything but loopback, so a
  phone cannot open the socket even after pairing. Closing that gap needs a peer
  address established below Next, not a `0.0.0.0` bind. It is plain HTTP with no
  TLS, so anyone reading packets on the network can lift the token.
- Path traversal is blocked in `resolveInVault()` (`lib/wiki.ts`); every read and
  write resolves against the vault root and throws "Path escapes the vault." if
  it escapes.
- Nothing leaves the machine at runtime. No telemetry, no account, no cloud
  model. The only outbound calls are to a local Ollama at
  `http://127.0.0.1:11434` if you have one, and to Hugging Face the first time
  semantic search runs, to pull `Xenova/all-MiniLM-L6-v2` into `~/.lore`. The
  MCP server's usage events post to the local app, not anywhere else.
  Building is the exception: `app/layout.tsx` uses `next/font/google`, so
  compiling fetches the Geist font files once and then self-hosts them.
