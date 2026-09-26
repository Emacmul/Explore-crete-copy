// "Real usable window" span calculations for the tour simulator's per-waypoint pace
// tests. Extracted from TourSimulator.jsx (2026-09-26) so that file stays under the
// platform's editable size limit — behaviour is unchanged; only trailPath/breakSet
// and the fallback cumulative distance are now passed in explicitly instead of
// being component closures. Coordinate system: cumulative driven distance along
// the trail, respecting trail_breaks cuts — the same one TourSimulator's own
// buildPath/posAtDistance use. Same precision level too: straight-line
// interpolation across short segments, no true geodesic/circle maths.

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

// Nearest trailPath index to a given lat/lng — the same "closest point on the route"
// search TourSimulator's cumDistForWaypoint does, factored out here so
// testSpanStartDist/testSpanEndDist (below) can walk a SPECIFIC forward stretch of
// the route between two waypoints, not just land on one point's own cumulative
// distance.
function nearestPathIndex(trailPath, point) {
  let nearestIdx = 0, minD = Infinity;
  trailPath.forEach((pt, i) => {
    const d = haversine(point.lat, point.lng, pt.lat, pt.lng);
    if (d < minD) { minD = d; nearestIdx = i; }
  });
  return nearestIdx;
}

// Cumulative distance (same coordinate system as TourSimulator's
// distRef/posAtDistance — respects trail_breaks cuts) from the very start of the
// path up to a given trailPath index.
function cumDistAtPathIndex(trailPath, breakSet, idx) {
  let cumDist = 0;
  for (let i = 1; i <= idx; i++) {
    if (breakSet.has(i - 1)) continue;
    cumDist += haversine(trailPath[i - 1].lat, trailPath[i - 1].lng, trailPath[i].lat, trailPath[i].lng);
  }
  return cumDist;
}

// Interpolates the cumulative distance where distance-to-target crosses `radius`,
// between trailPath index i-1 (dBefore) and i (dAfter) — a straight-line
// approximation across that one short segment, the same precision level the rest
// of the simulator's own geometry already uses. Works the same whether crossing
// INTO the radius (dBefore > radius > dAfter) or OUT of it (dBefore < radius <
// dAfter). Shared by testSpanStartDist and testSpanEndDist below — both are the
// same "where does distance-to-a-fixed-point cross a threshold" calculation, just
// applied to different waypoint pairs.
function interpolateCrossing(trailPath, breakSet, i, dBefore, dAfter, radius) {
  const segLen = haversine(trailPath[i - 1].lat, trailPath[i - 1].lng, trailPath[i].lat, trailPath[i].lng);
  if (segLen <= 0 || dBefore === dAfter) return cumDistAtPathIndex(trailPath, breakSet, i - 1);
  const t = Math.min(1, Math.max(0, (dBefore - radius) / (dBefore - dAfter)));
  return cumDistAtPathIndex(trailPath, breakSet, i - 1) + t * segLen;
}

// Per Enda's report while testing BOR1: "Test this subsegment" used to start the car
// parked exactly ON the first waypoint being tested's own pin — not a real approach at
// all, so it never actually showed whether this waypoint's own trigger point was
// right. It now starts from where the route genuinely ENTERS curWp's own trigger
// radius, coming from the PREVIOUS waypoint (prevWp, the one right before whichever
// waypoint the test actually starts at) — UNLESS prevWp's own trigger radius overlaps
// into curWp's (the two circles overlap along the route), in which case it starts
// where prevWp's own radius ends instead: a real customer is still "inside" prevWp's
// own zone up to that moment, so curWp's own audio wouldn't realistically be the one
// under test yet before that.
//
// Per Enda's later correction: this is NOT limited to single-waypoint tests. For
// "Test 2/3 in a row", curWp here is the FIRST waypoint of whichever 1/2/3 are being
// tested (see TourSimulator's onTestSubsegment) — the whole point of testing several
// in a row is hearing the real drive through them, so the very first one's own
// approach needs to be just as real as a single-waypoint test's.
//
// Falls back to the caller's fallbackDist (the waypoint's own exact position —
// today's original behaviour) whenever the geometry can't be trusted: no previous
// waypoint, either waypoint missing lat/lng, the two waypoints are out of order
// along the route (a data problem, not something to paper over here), or the route
// never actually comes within curWp's own configured trigger radius at all between
// the two waypoints (a sign the radius/position may be worth checking, not
// something to silently search further afield for).
export function testSpanStartDist(trailPath, breakSet, prevWp, curWp, fallbackDist) {
  if (!prevWp?.lat || !prevWp?.lng || !curWp?.lat || !curWp?.lng) return fallbackDist;

  const prevIdx = nearestPathIndex(trailPath, prevWp);
  const curIdx = nearestPathIndex(trailPath, curWp);
  if (curIdx <= prevIdx) return fallbackDist;

  const curRadius = Number(curWp.trigger_radius_m) || 30;
  const prevRadius = Number(prevWp.trigger_radius_m) || 30;

  let dCurLast = haversine(trailPath[prevIdx].lat, trailPath[prevIdx].lng, curWp.lat, curWp.lng);
  let dPrevLast = haversine(trailPath[prevIdx].lat, trailPath[prevIdx].lng, prevWp.lat, prevWp.lng);
  let entryDist = dCurLast <= curRadius ? cumDistAtPathIndex(trailPath, breakSet, prevIdx) : null;
  let wasInsidePrev = dPrevLast <= prevRadius;
  let prevExitDist = null;

  // Walks forward from prevIdx. Must NOT stop exactly at curIdx (curWp's own pin) —
  // prevWp's radius can still be overlapping curWp's radius PAST curWp's own pin
  // position (e.g. prevWp radius 60m reaches further than curWp's pin is from prevWp),
  // and that exit point is still a valid, in-radius start point per Enda's report as
  // long as it's within curWp's own radius. So keep walking until we're both at/past
  // curIdx AND outside curWp's own radius — i.e. curWp's own radius has been fully
  // covered — before stopping.
  for (let i = prevIdx + 1; i < trailPath.length; i++) {
    const dCur = haversine(trailPath[i].lat, trailPath[i].lng, curWp.lat, curWp.lng);
    const dPrev = haversine(trailPath[i].lat, trailPath[i].lng, prevWp.lat, prevWp.lng);
    const isInsidePrev = dPrev <= prevRadius;

    if (entryDist === null && dCur <= curRadius) {
      entryDist = interpolateCrossing(trailPath, breakSet, i, dCurLast, dCur, curRadius);
    }
    if (wasInsidePrev && !isInsidePrev) {
      // Just crossed OUT of the previous waypoint's own radius — its exit point.
      // Keeps overwriting on every such crossing, so a winding road that re-enters
      // and exits more than once still ends up with the LAST genuine exit.
      prevExitDist = interpolateCrossing(trailPath, breakSet, i, dPrevLast, dPrev, prevRadius);
    } else if (isInsidePrev) {
      // Re-entered (or never left) — no exit has actually happened yet.
      prevExitDist = null;
    }

    dCurLast = dCur;
    dPrevLast = dPrev;
    wasInsidePrev = isInsidePrev;

    if (i >= curIdx && dCur > curRadius) break;
  }

  if (entryDist === null) return fallbackDist;
  // Overlap case: the route enters curWp's own radius while still inside prevWp's —
  // start at prevWp's own exit point instead (it's further along than entryDist).
  if (prevExitDist !== null && prevExitDist > entryDist) return prevExitDist;
  return entryDist;
}

// Per Anoushka (relayed by Enda): the STOP point needs the same real-world grounding
// as the start point already got. It used to drive all the way to the boundary
// waypoint's own exact pin before pausing — but a real customer's audio for curWp
// actually stops mattering the moment the car enters the NEXT waypoint's own trigger
// radius, since that's when the next point's own audio could fire. That gap — from
// where curWp's audio starts, to where nextWp's radius begins — is the real usable
// "space" for curWp's speech, and testing all the way to nextWp's pin was giving a
// falsely generous window.
//
// Per Enda's later correction: this is NOT limited to single-waypoint tests. For
// "Test 2/3 in a row", curWp here is the LAST waypoint of whichever 1/2/3 are being
// tested, and nextWp is the very next one after that whole run (see TourSimulator's
// onTestSubsegment) — obviously so, per Enda: otherwise the multi-waypoint test
// wouldn't reflect the real usable space either.
//
// Falls back to the caller's fallbackDist (the next waypoint's own exact position —
// today's original behaviour) whenever the geometry can't be trusted: either
// waypoint missing lat/lng, the two waypoints out of order along the route, or the
// route never actually comes within nextWp's own configured trigger radius between
// the two — same fallback philosophy as testSpanStartDist above.
export function testSpanEndDist(trailPath, breakSet, curWp, nextWp, fallbackDist) {
  if (!curWp?.lat || !curWp?.lng || !nextWp?.lat || !nextWp?.lng) return fallbackDist;

  const curIdx = nearestPathIndex(trailPath, curWp);
  const nextIdx = nearestPathIndex(trailPath, nextWp);
  if (nextIdx <= curIdx) return fallbackDist;

  const nextRadius = Number(nextWp.trigger_radius_m) || 30;

  let dNextLast = haversine(trailPath[curIdx].lat, trailPath[curIdx].lng, nextWp.lat, nextWp.lng);
  let endDist = dNextLast <= nextRadius ? cumDistAtPathIndex(trailPath, breakSet, curIdx) : null;

  // Entry into nextWp's own radius must happen by nextIdx at the latest (distance to
  // nextWp is exactly 0 there), so — unlike the start-side search above — there's no
  // need to walk any further than that.
  for (let i = curIdx + 1; i <= nextIdx; i++) {
    const dNext = haversine(trailPath[i].lat, trailPath[i].lng, nextWp.lat, nextWp.lng);
    if (endDist === null && dNext <= nextRadius) {
      endDist = interpolateCrossing(trailPath, breakSet, i, dNextLast, dNext, nextRadius);
    }
    dNextLast = dNext;
  }

  if (endDist === null) return fallbackDist;
  return endDist;
}