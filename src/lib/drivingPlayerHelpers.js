/**
 * Pure, stateless helpers for DrivingTourPlayer — extracted from the component file
 * (2026-10-24) so that file stays under the platform's editable-size limit. Everything
 * here has no React dependency; the full history of each rule lives in the comments
 * carried over verbatim from the component.
 */

const R_EARTH = 6371000;

export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// The same stable per-waypoint key used everywhere.
//
// FIXED 2026-09-20 (Enda's BOR3 road test): this used to be `wp.segment_id || wp.name`. But a
// segment_id belongs to a whole SEGMENT ("BOR3" is shared by BOR3a-PS, BOR3b, BOR3c ... BOR3f - every
// real tour stores it that way), so every stop of a segment got the SAME key. The moment the first
// stop of a segment played, all the others counted as "already played" and never fired; the first two
// stops made the whole of BOR1 "manual only"; and the tour counted as finished as soon as the first
// stop of the last segment ended (which then stopped everything). Now each stop's key is its own:
// segment + name + position.
export function wpKeyFor(wp) {
  return `${wp.segment_id || ''}|${wp.name || ''}|${wp.lat},${wp.lng}`;
}

// "Last known position" tracking — per Enda: while driving, the app should quietly
// remember the most recent secondary waypoint (a point along the route, not the segment
// start/stop markers) the driver has actually reached, so that if the phone loses signal,
// gets closed by accident, or overheats and switches itself off, reopening the tour still
// shows where they got to and offers to pick back up from there — without ever showing
// the driver a list of every point, just that one. Saved to this device so it survives
// closing the app. If it's more than 18 hours old, treat it as stale (a different day's
// drive) and start fresh, the same rule already used for the walk/hike "you were last
// here" feature.
export const LAST_POSITION_STALE_MS = 18 * 60 * 60 * 1000;

export function lastPositionStorageKey(walkId) {
  return `explore_crete_driving_last_position__${walkId}`;
}

// Per Enda (2026-09-20): visitors use the same phone as a camera, and a phone can reload a
// page while another app (the camera) is in front. The set of stops that have ALREADY PLAYED
// used to live only in memory, so a reload forgot it and stops could play a second time. It is
// now also kept on this device, per tour, and dropped after the same 18 hours as the last known
// position. Stored: only stop identifiers. Never speeds or positions.
export function playedStorageKey(walkId) {
  return `explore_crete_driving_played__${walkId}`;
}

export function loadPlayedKeys(walkId) {
  if (!walkId) return [];
  try {
    const raw = localStorage.getItem(playedStorageKey(walkId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.keys) || Date.now() - (parsed.updatedAt || 0) > LAST_POSITION_STALE_MS) {
      localStorage.removeItem(playedStorageKey(walkId));
      return [];
    }
    return parsed.keys.filter((k) => typeof k === 'string');
  } catch {
    return [];
  }
}

export function savePlayedKeys(walkId, keysSet) {
  if (!walkId) return;
  try {
    if (!keysSet || keysSet.size === 0) localStorage.removeItem(playedStorageKey(walkId));
    else localStorage.setItem(playedStorageKey(walkId), JSON.stringify({ keys: Array.from(keysSet), updatedAt: Date.now() }));
  } catch {
    /* storage unavailable - repeat protection then only lasts until the page reloads */
  }
}

// Per audit finding U-08 (2026-09-09 code review): a GPS fix's accuracy needs to be at
// least as good as the trigger radius it's being judged against, or the fix can't be
// trusted to resolve at that distance. Crete's mountains are notorious for weak signal —
// a plain distance check can't tell a precise fix from a rough one that just happens to
// land "inside" the radius by chance. GPS_ACCURACY_HARD_CAP_M additionally rejects any
// fix so imprecise it shouldn't be trusted for ANY waypoint, however large that
// waypoint's own radius is. Applied to both audio triggers and "last known position".
export const GPS_ACCURACY_HARD_CAP_M = 100;

// Late play (Enda, 2026-09-20): a stop held back by the walking guard (e.g. crawling behind a herd of
// goats through its whole circle) still plays once the car is clearly driving again, as long as it is
// still within this distance of that stop. A walker never reaches driving speed, so never triggers it.
export const LATE_PLAY_MAX_DISTANCE_M = 300;

// How quiet the narration goes while a spoken alert talks over it (0 = silent, 1 = full).
export const NARRATION_DUCK_VOLUME = 0.2;

export function fixIsTrustworthy(accuracy, radius) {
  // No accuracy reported at all (not standard, but not every device/browser is
  // guaranteed to supply it) — behave as before rather than silently blocking every
  // trigger on an unrelated device quirk.
  if (accuracy == null || !Number.isFinite(accuracy)) return true;
  return accuracy <= Math.min(radius, GPS_ACCURACY_HARD_CAP_M);
}

// Per audit finding U-07: a single dropped GPS fix (a tunnel, a tall building, a brief
// timeout) is normal in Crete's mountains and driving through them shouldn't alarm the
// driver — but a RUN of consecutive failures means signal is genuinely gone, and that
// needs to be visible, not just logged. A denied location permission never recovers on
// its own, so that one is treated as sustained immediately rather than counted.
export const GPS_ERROR_STREAK_THRESHOLD = 2;

// Off-route detection — per Anoushka/Enda (follow-up 156): a driver can genuinely take a
// wrong turn (missed a turnoff, inattention) and end up nowhere near the recorded route at
// all, which is a different problem from GPS being unreliable. This is deliberately a
// bigger distance than any single waypoint's trigger radius (default 150m) or the GPS
// accuracy hard cap above (100m), so ordinary road-following/GPS noise near the route
// never trips it — only being genuinely, sustainedly far from the whole route does.
// ON_ROUTE_RECOVER_M is smaller than OFF_ROUTE_DISTANCE_M on purpose (hysteresis): once
// warned, a fix has to come back clearly inside the route, not just barely under the
// warning line, before the warning clears — otherwise a position sitting right at the
// boundary could flicker the warning on and off with every fix. A fix landing between the
// two thresholds doesn't move the state either way.
export const OFF_ROUTE_DISTANCE_M = 400;
export const ON_ROUTE_RECOVER_M = 200;
// Same reasoning as GPS_ERROR_STREAK_THRESHOLD — one stray fix shouldn't declare a driver
// lost, only a run of consecutive ones. Set a little higher than that threshold since
// "you've gone the wrong way" is a bigger claim to make than "signal is weak".
export const OFF_ROUTE_STREAK_THRESHOLD = 3;

// Shortest distance (metres) from a live position to the nearest point ON the recorded
// route LINE — not just to the nearest recorded dot. Follow-up 157 fix: an earlier version
// of this measured distance to the nearest trail_path VERTEX only, which over-estimates
// how far off the route someone is if they're between two recorded points (worst case:
// standing exactly at the midpoint of a long straight gap, up to half that gap's length
// away from the nearest single vertex, even though they're right on the line). Checked
// against real tour data (see the follow-up 156 changelog entry) and the biggest gap on
// either real driving tour today is under 170m, so this wasn't actually misfiring — but a
// future tour with sparser geometry (e.g. a long straight road, or a plain GPX import
// rather than a dense OSRM-routed line) could hit it, so this measures it properly rather
// than relying on today's data staying dense enough.
//
// Follow-up 158 correction: the follow-up 157 comment here was WRONG about trail_breaks —
// per Walk.jsonc's own field description and every other consumer of this data
// (WalkDetailMap.jsx, routeExport.js's splitTrailRuns, WalkProgressBar.jsx's
// progressAlongTrail/trailLength), a break at index b means there is genuinely no road
// connecting point b to point b+1 — two separate sections of the route, not just a
// rendering choice. Treating that gap as a valid line segment invents a fictitious "route"
// straight across it, which could wrongly judge a driver as on-route while they're really
// well away from either real section. Fixed: a broken segment is never treated as a line —
// only the two real recorded points either side of the break are considered (as isolated
// points, not connected to each other), same as every other consumer of trail_breaks
// already does.
export function distanceToSegmentM(lat, lng, aLat, aLng, bLat, bLng) {
  // Flat-earth (equirectangular) projection around point A — accurate to well under a
  // metre of error for segments this short (real route segments measure tens of metres;
  // even a very sparse future import would realistically be low hundreds of metres), so a
  // full spherical cross-track-distance calculation isn't needed here.
  const latRad = (aLat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  const px = (lng - aLng) * mPerDegLng;
  const py = (lat - aLat) * mPerDegLat;
  const bx = (bLng - aLng) * mPerDegLng;
  const by = (bLat - aLat) * mPerDegLat;

  const segLenSq = bx * bx + by * by;
  // t is how far along the A→B segment the projection of the live position falls, clamped
  // to [0,1] so the closest point is never outside the actual recorded segment — a
  // degenerate zero-length segment (two identical consecutive points) is handled by the
  // t=0 clamp below (distance to A).
  let t = segLenSq > 0 ? (px * bx + py * by) / segLenSq : 0;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function nearestTrailDistanceM(lat, lng, trailPath, trailBreaks) {
  // Same break-index validation/shape as splitTrailRuns (routeExport.js) and
  // WalkProgressBar.jsx's trailLength/progressAlongTrail — a value in this set is the
  // START index of a segment with no real line, i.e. no road between point i and i+1.
  const breakSet = new Set(
    (trailBreaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1)
  );
  let best = Infinity;
  for (let i = 0; i < trailPath.length - 1; i++) {
    const a = trailPath[i];
    const b = trailPath[i + 1];
    if (!a || a.lat == null || a.lng == null || !b || b.lat == null || b.lng == null) continue;
    if (breakSet.has(i)) {
      // No real road between these two recorded points — measure distance to each one as
      // an isolated point instead of inventing a line across the gap.
      const dA = haversine(lat, lng, a.lat, a.lng);
      const dB = haversine(lat, lng, b.lat, b.lng);
      if (dA < best) best = dA;
      if (dB < best) best = dB;
      continue;
    }
    const d = distanceToSegmentM(lat, lng, a.lat, a.lng, b.lat, b.lng);
    if (d < best) best = d;
  }
  return best;
}

export function loadPassedSecondaryIds(walkId) {
  if (!walkId) return new Set();
  try {
    const raw = localStorage.getItem(lastPositionStorageKey(walkId));
    if (!raw) return new Set();
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.ids)) return new Set();
    const age = Date.now() - (saved.updatedAt || 0);
    if (age > LAST_POSITION_STALE_MS) {
      localStorage.removeItem(lastPositionStorageKey(walkId));
      return new Set();
    }
    return new Set(saved.ids);
  } catch {
    return new Set();
  }
}