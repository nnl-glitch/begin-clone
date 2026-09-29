/* Begin — offline app shell service worker.
   Strategy:
   - HTML / navigation requests → network-first (falls back to cache offline).
     This is critical so a fresh deploy actually reaches the user; a purely
     cache-first HTML strategy would trap writers on an old bundle forever.
   - Static assets (JS / CSS / icons / fonts) → stale-while-revalidate: fast
     from cache, updated in the background for next visit.
   - API requests (/api/*) → never intercepted; the app must know when it's
     offline so it can lean on localStorage.
   Bump VERSION on any material change to force `activate` to purge old
   caches — this is the standard SW invalidation lever.
*/

const VERSION = "begin-v3";
const SHELL = [
  "/",
  "/write",
  "/manifest.webmanifest",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isHTMLRequest = (req) => {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept API — writers must know when they're offline.
  if (url.pathname.startsWith("/api/")) return;

  // Only handle same-origin or Google Fonts / gstatic.
  const isSameOrigin = url.origin === self.location.origin;
  const isFonts = url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com");
  if (!isSameOrigin && !isFonts) return;

  // Network-first for HTML so redeploys reach the user immediately.
  if (isHTMLRequest(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchAndCache = fetch(req)
        .then((res) => {
          if (res && (res.status === 200 || res.type === "opaque")) {
            const clone = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchAndCache;
    })
  );
});
