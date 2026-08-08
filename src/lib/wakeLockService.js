/**
 * Wake Lock Service — abstracts screen wake lock.
 *
 * Currently uses the Screen Wake Lock API (navigator.wakeLock).
 * In a native build, swap this module for a Capacitor KeepAwake plugin
 * wrapper — all consumers import from here, so no other code changes.
 */

let currentLock = null;
let releaseListeners = [];

function notifyReleased() {
  releaseListeners.forEach((cb) => cb());
}

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.wakeLock;
}

/**
 * Acquire a screen wake lock. Returns true on success.
 * @param {function} onReleased — called when the lock is released
 *   (either by the browser when the tab is hidden, or by release()).
 */
export async function acquire() {
  if (!isSupported()) return false;
  if (currentLock) return true;
  try {
    currentLock = await navigator.wakeLock.request('screen');
    currentLock.addEventListener('release', () => {
      currentLock = null;
      notifyReleased();
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the current wake lock.
 */
export async function release() {
  if (!currentLock) return;
  try {
    await currentLock.release();
  } catch {
    // ignore
  }
  currentLock = null;
}

/**
 * Whether a wake lock is currently held.
 */
export function isActive() {
  return currentLock !== null;
}

/**
 * Register a callback for when the wake lock is released.
 * Returns an unsubscribe function.
 */
export function onReleased(callback) {
  releaseListeners.push(callback);
  return () => {
    const idx = releaseListeners.indexOf(callback);
    if (idx >= 0) releaseListeners.splice(idx, 1);
  };
}

/**
 * Re-acquire the wake lock if the tab is visible and it was lost.
 * The browser automatically releases the lock when the tab is hidden;
 * this re-acquires it when the user returns.
 */
export async function reacquireIfVisible() {
  if (!isSupported()) return false;
  if (document.visibilityState !== 'visible') return false;
  if (currentLock) return true;
  return await acquire();
}