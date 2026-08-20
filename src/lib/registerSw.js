/**
 * Service-worker registration — PRODUCTION ONLY.
 *
 * Why dev is excluded: Vite re-optimizes its dependency chunks on every HMR / config /
 * dep change, rewriting /node_modules/.vite/deps/*.js (and /src/*.jsx) in place under
 * STABLE filenames with CHANGING contents. A service worker that cache-serves those
 * paths hands a page two different copies of React at once — an old, cached one for one
 * chunk and a fresh, re-optimized one for another — which then crashes with
 * "Cannot read properties of null (reading 'useEffect')". So in dev we never register,
 * and we proactively tear down any worker (and caches) a previous prod build or an
 * earlier dev session left behind, so the browser always hits the network directly.
 *
 * Production builds don't use /src or /node_modules paths at all (everything is
 * content-hashed under /assets/), so registering there is safe and desirable for
 * offline support — see public/sw.js for the cache strategy.
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (import.meta.env.DEV) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* best-effort teardown */
    }
    return;
  }

  const doRegister = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  };

  if (document.readyState === 'complete') doRegister();
  else window.addEventListener('load', doRegister);

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SW_UPDATED') {
      window.dispatchEvent(new CustomEvent('explore-crete:update-available'));
    }
  });
}