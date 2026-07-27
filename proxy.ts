import { NextResponse, type NextRequest } from "next/server";
import { isSiteMode } from "@/lib/mode";
import { isRateLimited, noteAuthFailure, verifyToken } from "@/lib/remote";

/**
 * The security boundary for the whole application.
 *
 * Lore reads and writes arbitrary folders on the machine it runs on. That is
 * the entire point locally, and a remote file disclosure vulnerability
 * anywhere else. A single unguarded `POST /api/vault {action:"link",path:"/"}`
 * from a stranger would hand them the filesystem.
 *
 * Two deployment shapes therefore exist, and they must never be confused:
 *
 *   LOCAL  — the real application. Binds to loopback, serves one person, has
 *            full filesystem access.
 *   SITE   — the public marketing page only. Every filesystem route is dead,
 *            and /vault redirects to install instructions. This is what gets
 *            deployed to a host.
 *
 * Guarding here rather than in each route is deliberate: there are sixteen
 * filesystem-touching endpoints, and a guard that must be remembered sixteen
 * times is a guard that will eventually be forgotten once.
 */


/**
 * Loopback check on the Host header.
 *
 * Binding the server to 127.0.0.1 is the real protection — a remote packet
 * cannot arrive at all. This is the second layer, for the cases that bypass
 * that: someone starting it with `-H 0.0.0.0`, a container publishing the
 * port, or a reverse proxy in front. Header values can be forged, but a forged
 * Host does not help an attacker who cannot open the socket, and it does stop
 * the accident where the app is quietly listening on a LAN address.
 *
 * Read that limitation exactly as written: this is a hint, not a peer check.
 * Anyone who can open the socket can send `Host: localhost` and land in the
 * loopback branch below, and there is nothing here that can tell them apart —
 * Next fills `x-forwarded-for` with the socket address only when the client did
 * not send one (`??=`), so that header is attacker-controlled too. The loopback
 * *bind* is therefore load-bearing, not belt-and-braces. Anything that opens
 * this port to a network needs a peer address proven below Next before it can
 * rely on any check in this file. See lib/remote.ts.
 */
function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "::1" ||
    name === "0.0.0.0" ||
    name.endsWith(".localhost")
  );
}

/** Everything that reads or writes the user's disk. */
const FILESYSTEM_ROUTES = [
  "/api/vault",
  "/api/pages",
  "/api/page",
  "/api/folder",
  "/api/search",
  "/api/health",
  "/api/agent",
  "/api/review",
  "/api/usage",
  "/api/budget",
  "/api/semantic",
  "/api/ai",
  "/api/harness",
  "/api/pick",
  "/api/mcp-event",
  // Reads and writes ~/.lore/remote.json, and its status payload lists this
  // machine's network addresses. On a public host that is a free map of the
  // deployment's internal network, so it dies with the rest of them.
  "/api/remote",
];

/**
 * Pages that render the wiki itself. They touch no disk in the middleware's
 * sense, but a paired phone starts here, so a non-loopback caller has to prove
 * the token before the shell is served rather than after — otherwise the phone
 * loads the app and then hits a wall of 403s, and an unpaired scanner learns
 * the app exists.
 *
 * The matcher does not cover /_next, so bundle chunks stay reachable to anyone
 * who can open the port. That is application code rather than wiki content, and
 * it is a decision rather than an oversight.
 */
function isVaultPage(pathname: string): boolean {
  return pathname === "/vault" || pathname.startsWith("/vault/");
}

/**
 * Where a remote request may carry its token. The query parameter is the one
 * the pairing link and QR code use — its name is duplicated in
 * components/lore/remote-view.tsx, which builds that link and cannot import
 * this file (it is a client component; lib/remote.ts is node-only). Keep the
 * two in step.
 */
const TOKEN_QUERY = "lore_token";
const TOKEN_COOKIE = "lore_remote";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const siteMode = isSiteMode();
  const touchesDisk = FILESYSTEM_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (siteMode) {
    // On a public host the app half does not exist. 404 rather than 403 so a
    // scanner learns nothing about what would have been there.
    if (touchesDisk) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (pathname === "/vault" || pathname.startsWith("/vault/")) {
      return NextResponse.redirect(new URL("/install", request.url));
    }
    return NextResponse.next();
  }

  const guarded = touchesDisk || isVaultPage(pathname);

  if (guarded && !isLoopbackHost(request.headers.get("host"))) {
    // The one sanctioned way past the loopback boundary: paired remote access,
    // which the user has to switch on deliberately. Everything about it is
    // decided here rather than in the sixteen routes, so there is still exactly
    // one place where a non-local request can be admitted.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many failed attempts. Try again later." },
        { status: 429 },
      );
    }

    const fromQuery = request.nextUrl.searchParams.get(TOKEN_QUERY);
    const supplied =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      request.headers.get("x-lore-token") ??
      request.cookies.get(TOKEN_COOKIE)?.value ??
      fromQuery;

    if (!verifyToken(supplied)) {
      // Counted even when no token was supplied at all: an unauthenticated
      // sweep of the port is exactly the thing the limiter exists to slow down.
      noteAuthFailure(ip);
      return NextResponse.json(
        {
          error:
            "Lore only serves the machine it runs on, unless remote access is enabled and this request carries its token.",
        },
        { status: 403 },
      );
    }

    // A valid token arrived in the URL, which is where the QR code has to put
    // it and the worst place for it to stay: the address bar, the history, and
    // every Referer the page sends. Move it into a cookie once and redirect to
    // the clean URL. Only pages redirect — a fetch cannot follow one usefully,
    // and every fetch the phone makes after this carries the cookie anyway.
    if (fromQuery && isVaultPage(pathname)) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete(TOKEN_QUERY);
      const response = NextResponse.redirect(clean);
      response.cookies.set(TOKEN_COOKIE, fromQuery, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Not `secure`: this is plain HTTP by design (see lib/remote.ts), and a
        // secure cookie would simply never be stored. A week bounds a pairing
        // the user forgot about; rotating or disabling revokes it immediately
        // regardless, because verifyToken reads the live secret every call.
        maxAge: 7 * 24 * 60 * 60,
      });
      return response;
    }
  }

  return NextResponse.next();
}

/* No runtime hint: in Next 16 a proxy file always runs on Node, and declaring
   it is rejected at build time. That is what lets the token check read a 0600
   file and use crypto.timingSafeEqual here, instead of re-implementing the
   boundary in each of the sixteen routes that touch the disk. */
export const config = {
  matcher: ["/vault/:path*", "/api/:path*"],
};
