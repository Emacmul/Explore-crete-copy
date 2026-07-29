/**
 * GPS Service — abstracts geolocation access.
 *
 * Currently uses the browser Geolocation API (navigator.geolocation).
 * In a native build, swap this module for a Capacitor Geolocation plugin
 * wrapper — all consumers import from here, so no other code changes.
 */

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

const DEFAULT_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 10000,
};

/**
 * Start watching position. Returns a watchId (or null if unsupported).
 * @param {function} onPosition — success callback (Position)
 * @param {function|null} onError — error callback (PositionError)
 * @param {object} options — geolocation options (merged over defaults)
 */
export function watchPosition(onPosition, onError, options) {
  if (!isSupported()) return null;
  return navigator.geolocation.watchPosition(
    onPosition,
    onError,
    { ...DEFAULT_OPTIONS, ...options }
  );
}

/**
 * Stop watching position by watchId.
 */
export function clearWatch(watchId) {
  if (watchId !== null && watchId !== undefined && isSupported()) {
    navigator.geolocation.clearWatch(watchId);
  }
}

/**
 * Get current position once. Returns a Promise.
 */
export function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      ...DEFAULT_OPTIONS,
      ...options,
    });
  });
}