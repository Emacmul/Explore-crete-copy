/**
 * Walking guard - keeps a tour from advancing while the visitor is on foot.
 *
 * Per Enda (2026-09-20): people use the phone they listen on as a camera, walk around a village
 * and can wander into the circle of a stop that has already played, or of a later stop. Rules:
 *  - "Walking pace" is 5 km/h or slower (a herd of sheep can also make a car crawl that slowly,
 *    and old villages force 5-10 km/h, so 5 km/h is the line: anything faster counts as driving).
 *  - Holding starts only after 20 s of unbroken walking-pace fixes (a brief stop at a junction or
 *    a queue does not count), and ends after 4 consecutive fixes faster than 5 km/h.
 *  - While holding, NO stop starts automatically. The moment the car really moves again a stop
 *    whose circle you are still inside starts as normal.
 *  - Fixes with poor accuracy or no speed reading change nothing. Neither does standing still
 *    (under 1 km/h): a parked car is not a walker.
 * Pure logic, no browser dependencies.
 */
export const WALKING_GUARD_SETTINGS = {
  WALK_MAX_KMH: 5,
  // Below this the phone is simply standing still (a parked car, waiting at the start of a
  // leg). Standing still is NOT walking: it must never switch the guard on, or a driver
  // sitting at a stop's start point would hear nothing until they drove off (Enda's BOR3
  // road test, 2026-09-20). A stop that is already holding stays held while standing still.
  STOPPED_KMH: 1,
  ENTER_MS: 20000,
  MIN_SAMPLES: 3,
  RELEASE_FIXES: 4,
  MAX_ACCURACY_M: 50,
};

export function createWalkingGuard(settings = {}) {
  const s = { ...WALKING_GUARD_SETTINGS, ...settings };
  let win = []; // recent { t, slow } fixes within ENTER_MS
  let fastStreak = 0;
  let holding = false;
  let everMeasured = false;

  return {
    reset() {
      win = []; fastStreak = 0; holding = false; everMeasured = false;
    },
    sample({ nowMs, speedKmh, accuracyM }) {
      const good = Number.isFinite(speedKmh) && speedKmh >= 0
        && (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= s.MAX_ACCURACY_M);
      if (!good) return;
      everMeasured = true;
      // Standing still says nothing about walking or driving - leave everything as it is.
      if (speedKmh < s.STOPPED_KMH) return;
      const slow = speedKmh <= s.WALK_MAX_KMH;
      win.push({ t: nowMs, slow });
      win = win.filter((w) => nowMs - w.t <= s.ENTER_MS);
      if (slow) {
        fastStreak = 0;
        // Enter holding when at least 80% of a full window of fixes are at walking pace - one
        // stray GPS spike while walking must not switch the guard off.
        const slowShare = win.filter((w) => w.slow).length / win.length;
        if (!holding && win.length >= s.MIN_SAMPLES && nowMs - win[0].t >= s.ENTER_MS * 0.8 && slowShare >= 0.8) holding = true;
      } else {
        fastStreak += 1;
        if (fastStreak >= s.RELEASE_FIXES) { holding = false; win = win.filter((w) => !w.slow ? true : false); }
      }
    },
    isHolding() { return holding; },
    // True when it is safe to start a stop that is NOT the next unplayed one (a genuine
    // skip-ahead, e.g. after a stop was missed): the visitor is clearly driving, or this device
    // gives no speed at all (then behave exactly as before this guard existed).
    canSkipAhead() { return !everMeasured || (fastStreak >= s.RELEASE_FIXES && !holding); },
  };
}
