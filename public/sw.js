/**
 * Explore Crete — Service Worker
 *
 * Version bump (v3) to force-evict all caches from previous versions.
 * Uses network-first for navigations so users always get the latest UI.
 * Stale-while-revalidate for static assets (JS/CSS/images).
 *
 * IMPORTANT — read this before every deploy: the browser only detects a new service
 * worker by comparing this file's raw bytes to what it already has cached. Someone who
 * opens the app fresh (closed-then-reopened) always gets the latest code regardless —
 * navigation requests are network-first below, and Vite content-hashes every JS/CSS
 * filename, so a stale cache can't serve old code on a real reload. But UpdateAvailable-
 * Toast.jsx (the "a new version is available" banner shown to anyone who leaves the app
 * open) only fires when THIS file's bytes actually change. Bump CACHE_VERSION below on
 * any deploy that should show that banner to already-open sessions — if this file is
 * untouched, the deploy still reaches everyone on their next open, just without the banner
 * for people already using it.
 */

const CACHE_VERSION = 'explore-crete-v10';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Install: cache the app shell FIRST, then activate immediately.
//
// Was: install did nothing but skipWaiting() — every asset only ever got cached
// reactively, as the fetch handler below happened to see it go by AFTER this worker had
// already taken control. That leaves a real gap for a brand-new visitor: the very first
// page load's own HTML/JS/CSS is fetched by the browser directly, before any service
// worker exists to see those requests — so none of it lands in this cache. If that same
// visitor goes offline before ever reloading the page again, relaunching the app finds
// nothing cached to fall back on (audit re-check, 2026-09-09 — finding U-03).
//
// Fix: fetch '/' during install and read the actual <script>/<link> tags out of it to find
// this build's JS/CSS bundle filenames. Nothing is hardcoded — Vite content-hashes those
// filenames on every deploy, so they're discovered fresh from whatever HTML was just
// served, not guessed at. This is best-effort: if it fails (e.g. installing while already
// offline), the worker still installs and falls back to exactly the old cache-as-you-go
// behaviour — nothing about this fix can make the app WORSE than it already was.
async function precacheAppShell() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const shellResponse = await fetch('/', { cache: 'no-store' });
    if (!shellResponse.ok) return;
    const html = await shellResponse.clone().text();
    await cache.put('/', shellResponse);

    const assetUrls = new Set();
    const re = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g;
    let match;
    while ((match = re.exec(html))) assetUrls.add(match[1]);

    await Promise.all(
      [...assetUrls].map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (res.ok) await cache.put(url, res);
        } catch {
          // One missing asset doesn't block the rest — it'll still get cached the normal
          // way the first time this worker sees a request for it go by.
        }
      })
    );
  } catch {
    // Best-effort precache only — installing while offline, or any other failure here,
    // still leaves the worker installing normally with the prior cache-as-you-go behaviour.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precacheAppShell();
      await self.skipWaiting();
    })()
  );
});

// Activate: purge ALL old caches and take control of all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();

      // Tell all open tabs to reload so they pick up the fresh UI
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
    })()
  );
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Network-first for navigation (HTML page loads) — ensures fresh UI
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch (err) {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          throw err;
        }
      })()
    );
    return;
  }

  // Never cache-serve Vite dev artifacts. In dev these paths are rewritten in place on
  // every HMR / re-optimization (stable filenames, changing contents), so a cached copy
  // is stale by construction — serving it ships two copies of React (old + new) in one
  // page and crashes with "Cannot read properties of null (reading 'useEffect')". Let the
  // browser hit the network directly. Prod builds don't use these paths at all
  // (everything is content-hashed under /assets/), so this only ever short-circuits dev.
  const isDevArtifact =
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@react-refresh');
  if (isDevArtifact) return;

  // Stale-while-revalidate for same-origin static assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cachedResponse = await cache.match(request);
        const networkResponsePromise = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);
        return cachedResponse || (await networkResponsePromise);
      })()
    );
  }
});
