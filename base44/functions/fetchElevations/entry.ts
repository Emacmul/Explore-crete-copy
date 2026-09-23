import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url, ms, init) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Provider 1 — Open-Meteo (fast, no key), GET with comma-separated coords.
async function fromOpenMeteo(sampled) {
  const lats = sampled.map(p => p.lat).join(',');
  const lons = sampled.map(p => p.lng).join(',');
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.elevation)) throw new Error('Open-Meteo bad shape');
  return data.elevation;
}

// Provider 2 — Open-Elevation (POST), used as a fallback when Open-Meteo rate-limits.
async function fromOpenElevation(sampled) {
  const body = { locations: sampled.map(p => ({ latitude: p.lat, longitude: p.lng })) };
  const res = await fetchWithTimeout('https://api.open-elevation.com/api/v1/lookup', 12000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Open-Elevation ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.results)) throw new Error('Open-Elevation bad shape');
  return data.results.map(r => r.elevation);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    // Admin, or narrator via email+narrToken — the same dual-path check routeWaypoints and
    // every other editor function uses (audit N1, 2026-09-23). This gate used to require
    // base44.auth.me(), but the Admin page and Narr Studio both sign in through narrLogin
    // and normally hold no Base44 session at all — so for exactly the staff who use the
    // editor, elevation lookup returned 401 and silently disrupted route editing. The
    // editor already sends email+narrToken with every call (WalkEditor.jsx fetchElevations
    // helper), it just wasn't being read here.
    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { points } = body;
    if (!points || !points.length) return Response.json({ elevations: [] });

    // Sample down to max 100 points — keeps the request fast and within provider limits.
    const step = Math.max(1, Math.floor(points.length / 100));
    const sampled = points.filter((_, i) => i % step === 0);

    const attempts = [
      { fn: () => fromOpenMeteo(sampled), wait: 1500 },
      { fn: () => fromOpenElevation(sampled), wait: 2000 },
      { fn: () => fromOpenMeteo(sampled), wait: 0 },
    ];

    let lastErr = 'unknown';
    for (const a of attempts) {
      try {
        const elevations = await a.fn();
        return Response.json({ elevations });
      } catch (e) {
        lastErr = e.message;
        if (a.wait) await sleep(a.wait);
      }
    }
    return Response.json({ error: `Elevation services unavailable: ${lastErr}` }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});