/**
 * Gentle speed hint — decides WHEN (rarely) to tell a driver they are clearly faster than a
 * tour leg was timed for, so the narration would fall behind the road.
 *
 * Per Enda (2026-09-20): this must NEVER become a nag and must never feel like Big Brother.
 * So, by design:
 *  - It only compares the driver to the TOUR's own timing (the leg's recommended speed). It has
 *    nothing to do with legal speed limits and never says anything about them.
 *  - Everything happens on the phone. Speeds are never stored, logged, sent anywhere or shown.
 *  - It needs a CLEAR, SUSTAINED overshoot (well above the timed speed, for a full stretch of
 *    consecutive good GPS fixes), so brief bursts, overtaking and GPS jitter are ignored.
 *  - Quiet at the start of a drive, quiet while anything else is being said, and never again
 *    soon: at most MAX_HINTS per tour, at least MIN_GAP_MS apart. After that it stays silent
 *    for the rest of the tour, even if the driver keeps going fast.
 *  - The driver can switch it off at any time (see isEnabled/setEnabled), remembered on the device.
 *
 * Pure logic with no browser dependencies except an optional localStorage for the switch.
 */

export const SPEED_HINT_SETTINGS = {
  // "Clearly faster": at least 25% AND at least 12 km/h above the leg's timed speed.
  RATIO: 1.25,
  MIN_EXCESS_KMH: 12,
  // Every good fix in this window must be over the line before a hint is even considered.
  SUSTAIN_MS: 30000,
  MIN_SAMPLES: 5,
  // Nothing at all in the first minutes of a drive.
  WARMUP_MS: 3 * 60 * 1000,
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

export function warnLineKmh(targetKmh, s = SPEED_HINT_SETTINGS) {
  return Math.max(targetKmh * s.RATIO, targetKmh + s.MIN_EXCESS_KMH);
}

/**
 * @param {object} [settings] overrides for tests
 * @returns {{ reset(now:number):void, sample(o):boolean }}
 *   sample({ nowMs, speedKmh, accuracyM, targetKmh, quiet }) returns true exactly when a hint
 *   should be spoken NOW. `quiet` must be true whenever anything else is being said or played
 *   as an alert, or the tour is not actively running.
 */
export function createSpeedHintMonitor(settings = {}) {
  const s = { ...SPEED_HINT_SETTINGS, ...settings };
  let startedAt = null;
  let lastHintAt = null;
  let hints = 0;
  let window = [];

  return {
    reset(nowMs) {
      startedAt = nowMs;
      lastHintAt = null;
      hints = 0;
      window = [];
    },
    sample({ nowMs, speedKmh, accuracyM, targetKmh, quiet }) {
      if (startedAt === null) startedAt = nowMs;
      if (hints >= s.MAX_HINTS) return false;
      // Anything that makes the reading unreliable or the moment inappropriate clears the
      // evidence completely - a hint needs an unbroken run of good, over-the-line fixes.
      const usable =
        !quiet &&
        Number.isFinite(speedKmh) && speedKmh >= 0 && speedKmh <= s.MAX_PLAUSIBLE_KMH &&
        Number.isFinite(targetKmh) && targetKmh > 0 &&
        (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= s.MAX_ACCURACY_M);
      if (!usable) { window = []; return false; }
      if (speedKmh <= warnLineKmh(targetKmh, s)) { window = []; return false; }
      window.push(nowMs);
      window = window.filter((t) => nowMs - t <= s.SUSTAIN_MS);
      if (nowMs - startedAt < s.WARMUP_MS) return false;
      if (lastHintAt !== null && nowMs - lastHintAt < s.MIN_GAP_MS) return false;
      const spanOk = window.length >= s.MIN_SAMPLES && nowMs - window[0] >= s.SUSTAIN_MS * 0.8;
      if (!spanOk) return false;
      hints += 1;
      lastHintAt = nowMs;
      window = [];
      return true;
    },
  };
}
