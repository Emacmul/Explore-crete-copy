/**
 * Explore Crete — Service Worker
 *
 * Version bump (v3) to force-evict all caches from previous versions.
 * Uses network-first for navigations so users always get the latest UI.
 * Stale-while-revalidate for static assets (JS/CSS/images).
 */

const CACHE_VERSION = 'explore-crete-v4';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Install: activate immediately, don't wait for old SW to release
self.addEventListener('install', (event) => {
  self.skipWaiting();
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
