import React, { useEffect, useRef } from 'react';
import { MapContainer, Marker, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OfflineTileLayer from '@/components/map/OfflineTileLayer';
import { splitTrailRuns } from '@/lib/routeExport';

// Blue position dot — the same visual language as WalkDetailMap's LiveGpsMarker, so the
// "you are here" meaning is identical everywhere in the app.
const positionIcon = L.divIcon({
  className: '',
  html: `<div style="
    width: 18px; height: 18px;
    background: #2563eb;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgba(37,99,235,0.3);
  "></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// If the map opened before the first live fix arrived (GPS still settling), re-centre
// once on that first position; after that the driver pans/zooms freely and the map
// never fights them by re-centring on every subsequent fix.
function CenterOnFirstFix({ position }) {
  const map = useMap();
  const centeredRef = useRef(false);
  useEffect(() => {
    if (!position || centeredRef.current) return;
    centeredRef.current = true;
    map.setView([position[0], position[1]], Math.max(map.getZoom(), 16));
  }, [position, map]);
  return null;
}

/**
 * Full-screen "Show map" overlay for DrivingTourPlayer (Enda, 2026-10-24): a driver who
 * loses their bearings opens this straight from the player's control row. The parent
 * pauses the tour the moment this opens (exactly like the Pause button — narration stops
 * instantly), so there is no narration talking over the map. Closing it does NOT resume:
 * the driver lands back in the app and presses Resume themselves once oriented.
 *
 * Uses OfflineTileLayer (not a plain network TileLayer) so the map keeps working from the
 * same offline tile cache the downloaded tour already uses — a driver checking their
 * bearings is exactly the low-signal moment a network-only map would fail. The tour's
 * route line is drawn too (same styling as WalkDetailMap) so "where am I relative to the
 * route" is answerable at a glance, plus a live position marker with its accuracy circle.
 * currentPos/gpsAccuracy arrive as props from the player's own GPS watch (which stays
 * running while paused), so no second watcher is spawned here.
 */
export default function DrivingPlayerMapModal({ walk, currentPos, gpsAccuracy, onClose, t }) {
  const trailPath = walk?.trail_path || [];
  const center = currentPos
    || (trailPath.length > 0
      ? [trailPath[0].lat, trailPath[0].lng]
      : [Number(walk?.start_lat) || 35.24, Number(walk?.start_lng) || 24.81]);

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col">
      {/* Header — Close is a solid, high-contrast, bold button (the driver-controls
          house style) so it's findable at a glance and hard to miss-tap. */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{t('player.mapTitle')}</p>
          {walk?.name && <p className="text-xs text-slate-400 truncate">{walk.name}</p>}
        </div>
        <Button
          type="button"
          onClick={onClose}
          className="shrink-0 gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-base px-6 h-11 shadow-lg shadow-blue-900/40"
        >
          <X className="w-5 h-5" /> {t('player.closeMap')}
        </Button>
      </div>

      {/* The map itself. Leaflet's own zoom controls (+/-, top-left) adjust the zoom
          level, and pinch/scroll zoom work too; the driver pans freely. */}
      <div className="flex-1 min-h-0">
        <MapContainer center={center} zoom={16} className="w-full h-full">
          <OfflineTileLayer
            url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <CenterOnFirstFix position={currentPos} />

          {splitTrailRuns(trailPath, walk?.trail_breaks).map((run, ri) => run.length > 1 && (
            <Polyline
              key={`run-${ri}`}
              positions={run}
              pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.85, dashArray: '10, 5' }}
            />
          ))}

          {currentPos && (
            <>
              <Circle
                center={currentPos}
                radius={gpsAccuracy || 20}
                pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 1 }}
              />
              <Marker position={currentPos} icon={positionIcon} zIndexOffset={1000} />
            </>
          )}
        </MapContainer>
      </div>
    </div>
  );
}