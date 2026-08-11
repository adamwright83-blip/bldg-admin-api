/**
 * Minimal offline shell for the installed Goldline PWA. Deliberately no
 * PWA framework/library — this is hand-written to stay inside the
 * ~150KB gzip runtime budget.
 *
 * Strategy, by request type:
 *  - /api/* (tRPC, everything authoritative): NEVER cached, network-only.
 *    A failed API request surfaces as a real network error to the app's
 *    own useNetworkStatus/SIGNAL LOST handling — this worker never serves
 *    stale business data or synthesizes a business result while offline.
 *  - Hashed static assets (/assets/*, Vite's content-hashed JS/CSS): cache
 *    first. Safe because a new deploy produces new filenames — a stale
 *    cache entry can never be served for a URL that no longer exists in
 *    the new deploy, so players are never trapped on old code mixed with
 *    new code.
 *  - Navigation requests (the HTML shell): network-first with a cached
 *    fallback, so a fresh deploy is picked up immediately when online, and
 *    the app can still boot to its offline shell when it can't.
 *
 * CACHE_VERSION bump on any change to this file's caching behavior —
 * activate() deletes every cache that doesn't match, so an old install
 * never keeps serving an outdated shell.
 */
const CACHE_VERSION = "goldline-shell-v1";
const OFFLINE_URL = "/driver";

const PRECACHE_URLS = [
  "/goldline.webmanifest",
  "/assets/goldline/pwa/icon-192.png",
  "/assets/goldline/pwa/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // Authoritative data — network-only, never cached, never faked offline.
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return cached ?? Response.error();
        }
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(OFFLINE_URL)) ?? (await cache.match("/")) ?? Response.error();
      })
    );
  }
});
