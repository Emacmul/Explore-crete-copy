import React, { useState, useEffect } from 'react';
import { Navigation2 } from 'lucide-react';

// Haversine distance between two {lat,lng} points in km
function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Given a trail path array and a user position, return the cumulative distance
// up to the closest point on the trail (in km).
function progressAlongTrail(trail, breaks, userPos) {
  if (!trail || trail.length < 2) return 0;

  const breakSet = new Set((breaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trail.length - 1));

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < trail.length; i++) {
    const d = haversine(trail[i], userPos);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }

  // Sum cumulative distance up to the closest point, skipping cut segments
  let cumulative = 0;
  for (let i = 1; i <= bestIdx; i++) {
    if (breakSet.has(i - 1)) continue;
    cumulative += haversine(trail[i - 1], trail[i]);
  }
  return cumulative;
}

// Total trail length in km, excluding cut segments (a break at index b means
// the hiker does not walk the line between point b and b+1).
function trailLength(trail, breaks) {
  if (!trail || trail.length < 2) return 0;
  const breakSet = new Set((breaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trail.length - 1));
  let total = 0;
  for (let i = 1; i < trail.length; i++) {
    if (breakSet.has(i - 1)) continue;
    total += haversine(trail[i - 1], trail[i]);
  }
  return total;
}

export default function WalkProgressBar({ walk }) {
  const [progress, setProgress] = useState(null); // { walkedKm, totalKm, pct }
  const [gpsError, setGpsError] = useState(false);

  const totalKm = walk.distance_km ||
    (walk.trail_path?.length >= 2 ? trailLength(walk.trail_path, walk.trail_breaks) : null);

  useEffect(() => {
    if (!navigator.geolocation) { setGpsError(true); return; }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

        let walkedKm = 0;
        if (walk.trail_path?.length >= 2) {
          walkedKm = progressAlongTrail(walk.trail_path, walk.trail_breaks, userPos);
        } else if (walk.start_lat && walk.start_lng) {
          // Fallback: distance from start point
          walkedKm = haversine({ lat: walk.start_lat, lng: walk.start_lng }, userPos);
        }

        const total = totalKm || 1;
        const pct = Math.min(100, Math.round((walkedKm / total) * 100));
        setProgress({ walkedKm: Math.round(walkedKm * 100) / 100, totalKm: total, pct });
      },
      () => setGpsError(true),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [walk.id]);

  if (gpsError || !totalKm) return null;
  if (!progress) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Navigation2 className="w-3.5 h-3.5 animate-pulse" />
        <span>Getting GPS location…</span>
      </div>
    );
  }

  const { walkedKm, pct } = progress;
  const isComplete = pct >= 95;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-gray-700">
          <Navigation2 className="w-3.5 h-3.5 text-blue-500" />
          Your progress
        </span>
        <span className={`font-bold ${isComplete ? 'text-emerald-600' : 'text-blue-600'}`}>
          {walkedKm} / {totalKm} km · {pct}%
        </span>
      </div>
      <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
        <div
          className={`h-full rounded-full transition-all duration-700 ${isComplete ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isComplete && (
        <p className="text-xs text-emerald-600 font-medium text-center">🎉 Walk complete!</p>
      )}
    </div>
  );
}