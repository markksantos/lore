# Deploying Lore

Lore is one codebase serving two shapes. Getting this distinction wrong is the
only way to turn it into a security problem, so it is worth being precise.

| | Local app | Public site |
| --- | --- | --- |
| What it is | The real product | The marketing page |
| Filesystem access | Full — that is the point | None. Every route 404s |
| `/vault` | The app | Redirects to `/install` |
| Binds to | `127.0.0.1` only | Whatever the host provides |
| Run with | `npm run dev` / `npm start` | `LORE_MODE=site` |

## Why the app cannot be hosted

Lore reads and writes a folder you choose. Hosted, that folder would be the
*server's* filesystem, and `POST /api/vault {action:"link", path:"/"}` from a
stranger would hand them everything on the box. There is no version of this
that is safe to expose, so the hosted build does not include it.

## Deploying the public site

```bash
vercel --prod
```

`vercel.json` sets `LORE_MODE=site`, and `proxy.ts` enforces it. Any other host
works the same way — set `LORE_MODE=site` and the app half switches off.

Site mode is also **inferred**: `VERCEL`, `NETLIFY`, `RENDER`, `FLY_APP_NAME`,
`RAILWAY_ENVIRONMENT`, `AWS_LAMBDA_FUNCTION_NAME` and `K_SERVICE` each flip it
on automatically. Deploying this repo somewhere without reading this file
therefore fails safe. Exposing a filesystem takes a deliberate
`LORE_MODE=local`, never a forgotten step.

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
2. **Desktop build** — `npm run dist:mac` or `npm run dist:win`. Unsigned; macOS
   asks for approval in System Settings, Windows SmartScreen warns. Signing needs
   an Apple Developer membership ($99/yr — a free personal team cannot issue a
   Developer ID) and a Windows certificate. Neither is configured.
3. **Signed, notarised builds** — not done. This is the remaining work before a
   general audience can install without being told to click past a warning.

## Local security posture

- `npm run dev` and `npm start` bind `127.0.0.1`. The default Next.js bind is
  `0.0.0.0`, which put the vault on the LAN — that was a real defect, not a
  theoretical one.
- `proxy.ts` additionally rejects any filesystem request whose `Host` is not
  loopback, covering the cases that bypass the bind: a manual `-H 0.0.0.0`, a
  container publishing the port, or a reverse proxy in front.
- Path traversal is blocked in `resolveInVault()`; every read and write resolves
  against the vault root and is rejected if it escapes.
- Nothing leaves the machine. No telemetry, no account, no network calls except
  to a local Ollama if you have one and to Hugging Face once, to download the
  embedding model.
