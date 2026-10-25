/**
 * Speed warning — tells a driver to slow down when they drive over 50 km/h.
 *
 * Per Enda (2026-10-25): the earlier "compare to the tour leg's own timing" design never
 * fired on a real drive (90 km/h for a full 20 minutes) — whenever the current leg had
 * no recorded speed, there was no line to cross at all. The rule is now ABSOLUTE:
 * more than 50 km/h, sustained for 10 seconds of good GPS fixes → one spoken warning
 * to slow down.
 *
 * Still by design:
 *  - Everything happens on the phone. Speeds are never stored, logged, sent anywhere or shown.
 *  - Brief bursts and GPS jitter are ignored (needs an unbroken run of good fixes).
 *  - Quiet while anything else is being said as an alert, or the tour isn't running.
 *  - Never nags: at most MAX_HINTS per tour, at least MIN_GAP_MS apart.
 *  - The driver can switch it off at any time (see isEnabled/setEnabled), remembered on the device.
 *
 * Pure logic with no browser dependencies except an optional localStorage for the switch.
 */

export const SPEED_HINT_SETTINGS = {
  // Warn above this speed — absolute, nothing to do with the leg's own timing.
  WARN_ABOVE_KMH: 50,
  // Every good fix in this window must be over the line before a warning fires.
  SUSTAIN_MS: 10000,
  MIN_SAMPLES: 3,
  MAX_HINTS: 2,
  MIN_GAP_MS: 12 * 60 * 1000,
  // Fixes worse than this are ignored (a poor fix says nothing reliable about speed).
  MAX_ACCURACY_M: 40,
  // Nothing above this is believable as a car (GPS glitch) — ignored, not warned about.
  MAX_PLAUSIBLE_KMH: 200,
};

const STORAGE_KEY = 'mc_speed_hints_enabled';

export function isEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setEnabled(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* private mode etc. - the switch just won't be remembered */
  }
}

/**
 * @param {object} [settings] overrides for tests
 * @returns {{ reset(now:number):void, sample(o):boolean }}
 *   sample({ nowMs, speedKmh, accuracyM, quiet }) returns true exactly when a warning
 *   should be spoken NOW. `quiet` must be true whenever anything else is being said or played
 *   as an alert, or the tour is not actively running.
 */
export function createSpeedHintMonitor(settings = {}) {
  const s = { ...SPEED_HINT_SETTINGS, ...settings };
  let lastHintAt = null;
  let hints = 0;
  let window = [];

  return {
    reset(nowMs) {
      lastHintAt = null;
      hints = 0;
      window = [];
    },
    sample({ nowMs, speedKmh, accuracyM, quiet }) {
      if (hints >= s.MAX_HINTS) return false;
      // Anything that makes the reading unreliable or the moment inappropriate clears the
      // evidence completely - a warning needs an unbroken run of good, over-the-line fixes.
      const usable =
        !quiet &&
        Number.isFinite(speedKmh) && speedKmh > s.WARN_ABOVE_KMH && speedKmh <= s.MAX_PLAUSIBLE_KMH &&
        (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= s.MAX_ACCURACY_M);
      if (!usable) { window = []; return false; }
      window.push(nowMs);
      window = window.filter((t) => nowMs - t <= s.SUSTAIN_MS);
      if (lastHintAt !== null && nowMs - lastHintAt < s.MIN_GAP_MS) return false;
      if (window.length < s.MIN_SAMPLES || nowMs - window[0] < s.SUSTAIN_MS * 0.8) return false;
      hints += 1;
      lastHintAt = nowMs;
      window = [];
      return true;
    },
  };
}