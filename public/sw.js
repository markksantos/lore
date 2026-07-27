/*
 * Lore's service worker.
 *
 * WHAT THIS CACHES, AND WHY IT IS SO LITTLE.
 *
 * Lore reads a live filesystem. Caching API responses would show people stale
 * wiki content and they would not know. So this worker caches the app SHELL
 * only — CSS, JS chunks, icons — and uses network-only for everything under
 * /api/. Those requests are passed straight through, never read from a cache
 * and never written to one.
 *
 * The same reasoning rules out caching HTML documents. /vault is server
 * rendered and its markup contains the vault index itself, so a cached copy is
 * a cached copy of somebody's notes: stale on the next save, and still sitting
 * on disk after the vault is unlinked. Navigations therefore always go to the
 * network, and the only document in the cache is /offline, precached so there
 * is something to show when the local server is not running.
 *
 * Nothing here is an offline mode. Lore cannot work without its server — the
 * server is what reads your files. /offline says that rather than pretending.
 *
 * So the shell cache is not a speed-up either. The server is on loopback and
 * already faster than any cache lookup; the cache exists for one job, which is
 * letting /offline paint with its own stylesheet when the server is gone.
 * Every shell asset is therefore fetched from the network first and only read
 * from the cache when that fetch fails — which also means a dev build's
 * hot-reloaded chunks are never answered from a stale copy.
 */

const CACHE = "lore-shell-v1";
const OFFLINE_URL = "/offline";

/** Shell only: build output, icons, and the manifest. No route that reads disk. */
const SHELL_PREFIXES = ["/_next/static/", "/icons/"];
const SHELL_PATHS = ["/manifest.webmanifest"];

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one missing file cannot fail the whole install and
      // leave the worker permanently stuck in the previous version.
      .then((cache) =>
        Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** A response worth storing: same-origin, 200, and not the body of a redirect. */
function isCacheable(response) {
  return Boolean(response) && response.status === 200 && response.type === "basic" && !response.redirected;
}

/**
 * What to answer a failed navigation with: the precached /offline document,
 * served under whatever address was asked for.
 *
 * Not a redirect to /offline, which would keep the address bar honest but does
 * not work. A navigation request carries redirect mode "manual", and a
 * redirect status handed back from a service worker for such a request is
 * treated as a network error — the browser lands on the new URL showing its own
 * "this page can't load" screen, which is the exact dead tab this file exists
 * to prevent. Serving the document directly is the pattern that works.
 *
 * The offline page reads the same at any address: it names no route, and its
 * only links are absolute.
 */
function offlineFallback() {
  return caches.match(OFFLINE_URL).then((cached) => {
    if (cached) return cached;
    return new Response("Lore is not running on this machine.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-only. Every route that touches the user's disk lives here.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Never cached, in either direction: a document may carry vault contents.
    event.respondWith(fetch(request).catch(() => offlineFallback()));
    return;
  }

  const isShell =
    SHELL_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ||
    SHELL_PATHS.includes(url.pathname);
  if (!isShell) return;

  // Network-first, cache as the fallback. See the note at the top of the file:
  // the copy is kept so /offline can style itself, not to answer while the
  // server is up.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (isCacheable(response)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((cached) => cached ?? Response.error()),
      ),
  );
});
