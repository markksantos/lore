import { NextResponse, type NextRequest } from "next/server";
import { isSiteMode } from "@/lib/mode";

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
  "/api/proposals",
  "/api/mcp-event",
];

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

  if (touchesDisk && !isLoopbackHost(request.headers.get("host"))) {
    return NextResponse.json(
      {
        error:
          "Lore only serves the machine it runs on. This request came from a non-loopback host.",
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/vault/:path*", "/api/:path*"],
};
