// Cut (trail_breaks) re-indexing + nearest-insertion helpers.
//
// trail_breaks stores the indices of the segments that are "cut" (no line drawn
// between point b and b+1). Because these are array indices, any time the
// trail_path gains or loses a point the stored indices must be shifted to stay
// glued to the same physical segment — otherwise a cut silently drifts onto a
// neighbouring segment or vanishes.
//
// This module is shared by the map editor (TrailPathMapEditor) and the
// list-style editor (TrailPathEditor) so both keep cuts aligned no matter
// which one mutates the path.

export function reindexAfterInsert(breaks, idx) {
  return (breaks || [])
    .map(b => b >= idx ? b + 1 : b)
    .filter(b => Number.isInteger(b) && b >= 0);
}

export function reindexAfterDeleteOne(breaks, deletedIdx) {
  return (breaks || [])
    .filter(b => b !== deletedIdx - 1 && b !== deletedIdx)   // the two segments touching the deleted point collapse
    .map(b => b > deletedIdx ? b - 1 : b)
    .filter(b => Number.isInteger(b) && b >= 0);
}

export function reindexAfterDeleteMany(breaks, deletedSet) {
  return (breaks || [])
    .filter(b => !deletedSet.has(b) && !deletedSet.has(b + 1)) // segment gone if either endpoint was deleted
    .map(b => {
      let shift = 0;
      deletedSet.forEach(d => { if (d < b) shift++; });
      return b - shift;
    })
    .filter(b => Number.isInteger(b) && b >= 0);
}

// --- Geometric helpers for deciding where a coordinate should slot in -----

function haversineM(a, b) {
  const R = 6371e3, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Distance from point p to segment a-b (metres).
export function distToSegmentM(p, a, b) {
  const R = 6371e3;
  const lat0 = (a.lat + b.lat) / 2 * Math.PI / 180;
  const px = (p.lng - a.lng) * Math.cos(lat0);
  const py = (p.lat - a.lat);
  const bx = (b.lng - a.lng) * Math.cos(lat0);
  const by = (b.lat - a.lat);
  const len2 = bx * bx + by * by;
  if (len2 === 0) return haversineM(p, a);
  let t = (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = { lat: a.lat + t * by, lng: a.lng + t * bx };
  return haversineM(p, proj);
}

// Best insertion index for a new point so it lands at the nearest spot along the
// existing path (rather than always at the end). Used by both the click-to-add
// map editor and the typed-coordinate list editor.
export function nearestInsertIndex(path, latlng) {
  if (path.length === 0) return 0;
  if (path.length === 1) return 1;
  let best = { dist: Infinity, idx: path.length };
  for (let i = 0; i < path.length - 1; i++) {
    const d = distToSegmentM(latlng, path[i], path[i + 1]);
    if (d < best.dist) best = { dist: d, idx: i + 1 };
  }
  // Compare with appending after the last point.
  const dEnd = haversineM(latlng, path[path.length - 1]);
  if (dEnd < best.dist) return path.length;
  return best.idx;
}