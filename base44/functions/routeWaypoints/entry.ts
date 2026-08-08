import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Road-following routing between ordered waypoints, used when a GPX import has no
// recorded track/route line (a bare waypoint collection from a GPS device). Calls the
// public OSRM driving router and returns a dense {lat,lng} polyline that follows real
// roads. Mirrors fetchElevations (auth + external API + batched calls).

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
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { points, profile } = await req.json();
  if (!points || points.length < 2) return Response.json({ trail: [] });

  const p = profile === 'foot' ? 'foot' : 'driving';

  try {
    if (points.length <= BATCH) {
      const trail = await routeChunk(points, p);
      return Response.json({ trail, pointCount: trail.length });
    }

    // Chunk with a 1-point overlap so consecutive segments connect smoothly.
    const trail = [];
    let first = true;
    for (let i = 0; i < points.length; i += BATCH - 1) {
      const chunk = points.slice(i, i + BATCH);
      if (chunk.length < 2) break;
      const seg = await routeChunk(chunk, p);
      trail.push(...(first ? seg : seg.slice(1)));
      first = false;
    }
    return Response.json({ trail, pointCount: trail.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
});