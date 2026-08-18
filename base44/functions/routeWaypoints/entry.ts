// Road-following routing between ordered waypoints, used when a GPX import has no
// recorded track/route line (a bare waypoint collection from a GPS device). Calls the
// public OSRM driving router and returns a dense {lat,lng} polyline that follows real
// roads. Mirrors fetchElevations (auth + external API + batched calls).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

const OSRM_BASE = 'https://router.project-osrm.org';
const BATCH = 25; // max waypoints per OSRM /route request (kept low for URL length + reliability)

async function routeChunk(coords, profile, attempt = 0) {
  const coordStr = coords.map(c => `${c.lng},${c.lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  // Retry transient failures (rate limit / server error) with exponential backoff.
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      return routeChunk(coords, profile, attempt + 1);
    }
    throw new Error(`OSRM returned ${res.status}`);
  }
  if (!res.ok) throw new Error(`OSRM returned ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
    throw new Error(`OSRM could not route: ${data.code || 'NoRoute'}`);
  }
  // OSRM geojson coordinates are [lng, lat] pairs.
  return data.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json();
  // Admin, or narrator via email+narrToken — same dual-path check used everywhere else
  // in this app. Without this, anyone on the internet could call this function directly
  // and repeatedly, running up usage against the routing service with no restriction —
  // an earlier version of this file left it open specifically because narrators sign in
  // via WordPress rather than Base44, but resolveActor's narrator-token path exists
  // precisely to solve that, so that's no longer a real reason to leave this open.
  const actor = await resolveActor(base44, body);
  if (!actor) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { points, profile } = body;
  if (!points || points.length < 2) return Response.json({ trail: [] });

  const p = profile === 'foot' ? 'foot' : 'driving';

  try {
    if (points.length <= BATCH) {
      const trail = await routeChunk(points, p);
      return Response.json({ trail, pointCount: trail.length });
    }

    // Chunk with a 1-point overlap so consecutive segments connect smoothly. A small pause
    // between successive chunks — not just the existing retry backoff within one chunk —
    // since firing several requests back-to-back in quick succession is exactly the pattern
    // that trips this free public server's own rate limiting; this tour needed 5 separate
    // chunk calls and hit it twice in a row.
    const trail = [];
    let first = true;
    for (let i = 0; i < points.length; i += BATCH - 1) {
      const chunk = points.slice(i, i + BATCH);
      if (chunk.length < 2) break;
      if (!first) await new Promise(r => setTimeout(r, 400));
      const seg = await routeChunk(chunk, p);
      trail.push(...(first ? seg : seg.slice(1)));
      first = false;
    }
    return Response.json({ trail, pointCount: trail.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
});