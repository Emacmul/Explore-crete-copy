Deno.serve(async (req) => {
  const { points } = await req.json();
  if (!points || !points.length) return Response.json({ elevations: [] });

  // Sample down to OpenTopoData's 100-location request limit. ceil (not floor) so
  // trails with 101–199 points don't accidentally exceed the cap.
  const step = Math.max(1, Math.ceil(points.length / 100));
  const sampled = points.filter((_, i) => i % step === 0);
  const locations = sampled.map((p) => `${p.lat},${p.lng}`).join("|");
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${encodeURIComponent(locations)}`;

  // Elevation is non-sensitive reference data, so there is no auth gate here. The
  // app's admins authenticate through the custom WordPress login, not Base44
  // platform auth — gating on base44.auth.me() made this endpoint always return
  // 401 for them, which is why elevation "could not be reached" at save time.
  //
  // OpenTopoData's free endpoint also rate-limits (429) and occasionally times out,
  // so retry with backoff before giving up so a transient blip doesn't force the
  // admin to keep the stale figure.
  const MAX_ATTEMPTS = 3;
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "OK") {
          return Response.json({ elevations: data.results.map((r) => r.elevation) });
        }
        // API-level error from OpenTopoData (e.g. point outside dataset) — not a
        // transient transport failure, so don't keep retrying.
        return Response.json(
          { error: data.error || "OpenTopoData API error" },
          { status: 502 },
        );
      }
      if (res.status === 429) {
        lastError = "rate-limited (429)";
      } else {
        // Other 4xx are not retryable.
        return Response.json(
          { error: `OpenTopoData error: ${res.status}` },
          { status: 502 },
        );
      }
    } catch (err) {
      lastError = err?.message || "network error";
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 800 * attempt)); // 0.8s, then 1.6s
    }
  }

  return Response.json(
    { error: `Elevation service unavailable after retries: ${lastError}` },
    { status: 502 },
  );
});