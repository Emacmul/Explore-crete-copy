import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import OfflineTileLayer from '@/components/map/OfflineTileLayer';
import { Play, Pause, Square, Save, X, Loader2, Navigation } from 'lucide-react';
import * as gpsService from '@/lib/gpsService';

// Haversine distance between two coords in km
function haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function buildGpx(name, points) {
  const trkpts = points.map(p =>
    `    <trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.timestamp).toISOString()}</time></trkpt>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Magical Crete App">
  <trk><name>${name}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>`;
}

function formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Auto-pan map to current position
function MapFollower({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, map.getZoom());
  }, [center]);
  return null;
}

export default function WalkRecorder({ user, appUser, onSaved, onCancel }) {
  const [status, setStatus] = useState('idle'); // idle | recording | paused | saving
  const [path, setPath] = useState([]);
  const [distanceKm, setDistanceKm] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [walkName, setWalkName] = useState('');
  const [saving, setSaving] = useState(false);

  const watchIdRef = useRef(null);
  const timerRef = useRef(null);
  const lastPointRef = useRef(null);

  // Timer
  useEffect(() => {
    if (status === 'recording') {
      timerRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  // GPS
  useEffect(() => {
    if (status === 'recording') {
      watchIdRef.current = gpsService.watchPosition(
        (pos) => {
          const point = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            timestamp: Date.now(),
          };
          setPath(prev => {
            const last = prev[prev.length - 1];
            if (last) {
              const d = haversine(last, point);
              if (d < 0.005) return prev; // ignore jitter < 5m
              setDistanceKm(dk => dk + d);
            }
            lastPointRef.current = point;
            return [...prev, point];
          });
        },
        null,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    } else {
      if (watchIdRef.current !== null) {
        gpsService.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    }
    return () => {
      if (watchIdRef.current !== null) gpsService.clearWatch(watchIdRef.current);
    };
  }, [status]);

  const handleStart = () => setStatus('recording');
  const handlePause = () => setStatus('paused');
  const handleResume = () => setStatus('recording');
  const handleStop = () => setStatus('saving');

  const handleSave = async () => {
    if (!walkName.trim()) return;
    setSaving(true);
    const gpx = buildGpx(walkName, path);
    await base44.entities.RecordedWalk.create({
      owner_user_id: user.id,
      owner_email: user.email,
      owner_name: user.full_name || user.email,
      name: walkName.trim(),
      recorded_at: new Date().toISOString(),
      duration_seconds: elapsedSecs,
      distance_km: Math.round(distanceKm * 100) / 100,
      trail_path: path,
      gpx_data: gpx,
      is_shared: false,
    });
    setSaving(false);
    onSaved?.();
  };

  const handleDiscard = () => {
    setStatus('idle');
    setPath([]);
    setDistanceKm(0);
    setElapsedSecs(0);
    setWalkName('');
    onCancel?.();
  };

  const center = path.length > 0
    ? [path[path.length - 1].lat, path[path.length - 1].lng]
    : [35.2401, 24.8093]; // centre of Crete

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{formatDuration(elapsedSecs)}</p>
          <p className="text-xs text-gray-500 mt-1">Duration</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{distanceKm.toFixed(2)} km</p>
          <p className="text-xs text-gray-500 mt-1">Distance</p>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 rounded-xl overflow-hidden border shadow-sm min-h-[280px]">
        <MapContainer
          center={center}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
        >
          <OfflineTileLayer />
          {path.length > 1 && (
            <Polyline
              positions={path.map(p => [p.lat, p.lng])}
              color="#2563eb"
              weight={4}
              opacity={0.85}
            />
          )}
          {path.length > 0 && <MapFollower center={[path[path.length - 1].lat, path[path.length - 1].lng]} />}
        </MapContainer>
      </div>

      {/* Controls */}
      {status === 'idle' && (
        <Button onClick={handleStart} className="w-full bg-green-600 hover:bg-green-700 gap-2 h-12 text-base">
          <Play className="w-5 h-5" /> Start Recording
        </Button>
      )}

      {status === 'recording' && (
        <div className="flex gap-3">
          <Button onClick={handlePause} variant="outline" className="flex-1 gap-2 h-12 border-amber-400 text-amber-700 hover:bg-amber-50">
            <Pause className="w-5 h-5" /> Pause
          </Button>
          <Button onClick={handleStop} className="flex-1 gap-2 h-12 bg-red-600 hover:bg-red-700">
            <Square className="w-5 h-5" /> Stop
          </Button>
        </div>
      )}

      {status === 'paused' && (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-amber-600 text-sm font-medium bg-amber-50 rounded-lg py-2">
            <Pause className="w-4 h-4" /> Paused — enjoy your break!
          </div>
          <div className="flex gap-3">
            <Button onClick={handleResume} className="flex-1 gap-2 h-12 bg-green-600 hover:bg-green-700">
              <Play className="w-5 h-5" /> Resume
            </Button>
            <Button onClick={handleStop} className="flex-1 gap-2 h-12 bg-red-600 hover:bg-red-700">
              <Square className="w-5 h-5" /> Stop
            </Button>
          </div>
        </div>
      )}

      {status === 'saving' && (
        <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
          <div>
            <p className="font-semibold text-gray-900 mb-1">Name your walk</p>
            <p className="text-xs text-gray-500 mb-3">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {' · '}{formatDuration(elapsedSecs)} · {distanceKm.toFixed(2)} km
            </p>
            <Input
              value={walkName}
              onChange={e => setWalkName(e.target.value)}
              placeholder="e.g. Morning hike to the viewpoint"
              className="text-sm"
              autoFocus
            />
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleSave}
              disabled={!walkName.trim() || saving}
              className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Walk
            </Button>
            <Button onClick={handleDiscard} variant="outline" className="flex-1 gap-2 text-red-600 border-red-200 hover:bg-red-50">
              <X className="w-4 h-4" /> Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}