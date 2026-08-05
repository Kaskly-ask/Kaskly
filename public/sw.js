// Kaskly service worker. Strategy, honestly stated:
//   - App shell (routes, hashed assets, the wasm, icons): cached — fast
//     standalone launches and resilience to flaky connections.
//   - CHAIN AND MONEY STATE ARE NEVER CACHED: /api/* is never touched,
//     and cross-origin requests (Kaspa nodes, REST, KNS) pass straight
//     through. Stale money state must be impossible by construction.
const VERSION = "kaskly-sw-v1";
const SHELL = ["/", "/ask", "/inbox", "/sent", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // chain/REST/KNS: untouched
  if (url.pathname.startsWith("/api/")) return; // money state: always network

  // F27 — the WASM is NOT treated as immutable.
  //
  // It was served cache-first with no revalidation, under a VERSION
  // constant that never changed per deploy. That made a single poisoned
  // response PERMANENT: a corrected redeploy could not evict it (sw.js
  // byte-identical so the SW never updated, VERSION unchanged so the
  // activate purge never fired, URL unchanged so no fresh fetch occurred).
  // Only "clear site data" recovered — and the same mechanism meant a
  // legitimate SDK security patch never reached returning users.
  //
  // This binary generates private keys and signs transactions, so it gets
  // network-first with cache fallback: a corrected deploy replaces a bad
  // cached copy on the very next load, while offline use still works.
  // /_next/static/** stays cache-first because each deploy mints new
  // build-ID URLs, so those entries self-heal already.
  if (url.pathname === "/kaspa_bg.wasm") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        try {
          const res = await fetch(request, { cache: "no-cache" });
          if (res.ok) {
            cache.put(request, res.clone());
            return res;
          }
          const stale = await cache.match(request);
          return stale || res;
        } catch (err) {
          const stale = await cache.match(request);
          if (stale) return stale;
          throw err;
        }
      })()
    );
    return;
  }

  // Immutable assets: cache-first (build-ID URLs make these self-healing).
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Navigations/shell: network-first so deploys land immediately; cache
  // fallback keeps the app opening when the connection is bad.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && (request.mode === "navigate" || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
