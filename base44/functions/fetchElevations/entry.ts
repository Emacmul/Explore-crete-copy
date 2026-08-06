import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { points } = await req.json();
  if (!points || !points.length) return Response.json({ elevations: [] });

  // Sample down to max 100 points
  const step = Math.max(1, Math.floor(points.length / 100));
  const sampled = points.filter((_, i) => i % step === 0);
  const locations = sampled.map(p => `${p.lat},${p.lng}`).join('|');

  const res = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${encodeURIComponent(locations)}`);
  if (!res.ok) return Response.json({ error: `OpenTopoData error: ${res.status}` }, { status: 502 });

  const data = await res.json();
  if (data.status !== 'OK') return Response.json({ error: data.error || 'API error' }, { status: 502 });

  return Response.json({ elevations: data.results.map(r => r.elevation) });
});