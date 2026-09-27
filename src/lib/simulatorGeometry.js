// Pure geometry/formatting helpers for TourSimulator.jsx, extracted (2026-09-27) into
// their own module the same way simulatorSpans.js already was — TourSimulator.jsx grew
// past the platform's per-file editable-size limit, so every purely-functional helper
// that file doesn't strictly need inline lives here instead. No behaviour change: the
// bodies below are byte-for-byte the ones that used to sit at the top of that file.

// Mean Earth radius in metres — used by haversine below.
const R_EARTH = 6371000;

// One simulator tick in milliseconds — the drive loop runs this often (10x/second),
// scaled by the user's speed multiplier. Exported because TourSimulator's own drive
// loop (simTime accounting, distance stepping, the setInterval cadence) needs it.
export const TICK_MS = 100;

// Great-circle distance in metres between two lat/lng points.
export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// Turns a trail polyline into a driven-distance model: consecutive point pairs become
// segments with cumulative start distances, so a simulated position can be looked up by
// metres-driven instead of by array index.
export function buildPath(path, breakSet) {
  const breaks = breakSet || new Set();
  const segments = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    // A cut at index i means no path between point i and i+1 — the simulated
    // vehicle jumps across the gap, so that segment adds no driven distance.
    if (breaks.has(i)) continue;
    const dist = haversine(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng);
    segments.push({ start: path[i], end: path[i + 1], dist, cumStart: total });
    total += dist;
  }
  return { segments, total };
}

// The lat/lng position exactly `dist` metres along the built path.
export function posAtDistance(segments, total, dist) {
  if (dist <= 0) return segments[0]?.start || null;
  if (dist >= total) return segments[segments.length - 1]?.end || null;
  for (const seg of segments) {
    if (dist <= seg.cumStart + seg.dist) {
      const r = seg.dist > 0 ? (dist - seg.cumStart) / seg.dist : 0;
      return {
        lat: seg.start.lat + (seg.end.lat - seg.start.lat) * r,
        lng: seg.start.lng + (seg.end.lng - seg.start.lng) * r,
      };
    }
  }
  return segments[segments.length - 1]?.end || null;
}

// Metres → readable "830 m" / "4.25 km" for the stats readout.
export function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

// Milliseconds → "m:ss" for the sim-time readout.
export function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}