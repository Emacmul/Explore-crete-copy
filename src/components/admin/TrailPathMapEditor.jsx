import React, { useState, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents, CircleMarker, Rectangle } from 'react-leaflet';
import L from 'leaflet';
import { Button } from '@/components/ui/button';
import { Trash2, MousePointerClick, Eraser, RefreshCw, MapPin } from 'lucide-react';

// Click-anywhere handler: inserts a new trail point at the clicked location, at the
// nearest position along the existing path (so refining a bend drops the point in the
// right place rather than always at the end).
function ClickToAdd({ onAdd, active }) {
  useMapEvents({
    click: (e) => { if (active) onAdd(e.latlng); },
  });
  return null;
}

// In Delete mode the map's normal click-and-drag pan is disabled so the drag gesture
// can be used to draw a selection box instead. Add mode keeps panning enabled.
function DragController({ mode }) {
  const map = useMap();
  React.useEffect(() => {
    if (mode === 'delete') map.dragging.disable();
    else map.dragging.enable();
  }, [map, mode]);
  return null;
}

// Drag-to-box delete: in Delete mode, mousedown on the map starts a rectangle;
// on mouseup every trail point inside the rectangle is removed. A click (no drag)
// deletes nothing — use a marker click for single-point removal.
function BoxDelete({ active, trailPath, onDelete }) {
  const startRef = React.useRef(null);
  const pathRef = React.useRef(trailPath);
  pathRef.current = trailPath;
  const [box, setBox] = useState(null);

  useMapEvents({
    mousedown: (e) => {
      if (!active) return;
      startRef.current = e.latlng;
      setBox({ start: e.latlng, end: e.latlng });
    },
    mousemove: (e) => {
      if (!active || !startRef.current) return;
      setBox({ start: startRef.current, end: e.latlng });
    },
    mouseup: (e) => {
      if (!active || !startRef.current) return;
      const start = startRef.current, end = e.latlng;
      startRef.current = null;
      setBox(null);
      const minLat = Math.min(start.lat, end.lat), maxLat = Math.max(start.lat, end.lat);
      const minLng = Math.min(start.lng, end.lng), maxLng = Math.max(start.lng, end.lng);
      // Ignore a bare click (no real drag) — single-point deletes happen via marker clicks.
      if (Math.abs(start.lat - end.lat) < 1e-7 && Math.abs(start.lng - end.lng) < 1e-7) return;
      const next = pathRef.current.filter(
        p => !(p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng)
      );
      onDelete(next);
    },
  });

  if (!box) return null;
  const bounds = [
    [Math.min(box.start.lat, box.end.lat), Math.min(box.start.lng, box.end.lng)],
    [Math.max(box.start.lat, box.end.lat), Math.max(box.start.lng, box.end.lng)],
  ];
  return <Rectangle bounds={bounds} pathOptions={{ color: '#ef4444', weight: 2, dashArray: '5 5', fillOpacity: 0.12 }} />;
}

function FitBounds({ trailPath, waypoints }) {
  const map = useMap();
  React.useEffect(() => {
    const pts = trailPath?.length > 0
      ? trailPath.map(p => [p.lat, p.lng])
      : waypoints?.length > 0
        ? waypoints.map(w => [w.lat, w.lng])
        : null;
    if (pts && pts.length > 0) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    }
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function haversineM(a, b) {
  const R = 6371e3, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Distance from point p to segment a-b (metres).
function distToSegmentM(p, a, b) {
  const toRad = d => d * Math.PI / 180;
  // Approximate as flat for short segments — fine for insertion ranking.
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

function nearestInsertIndex(path, latlng) {
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

const trailDot = (mode) => L.divIcon({
  className: '',
  html: `<div style="width:13px;height:13px;border-radius:50%;background:${mode === 'delete' ? '#ef4444' : '#f59e0b'};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);cursor:${mode === 'delete' ? 'pointer' : 'move'}"></div>`,
  iconSize: [13, 13],
  iconAnchor: [6.5, 6.5],
});

export default function TrailPathMapEditor({ trailPath, onChange, waypoints = [] }) {
  const [mode, setMode] = useState('add'); // 'add' | 'delete'

  const insertAt = (latlng) => {
    const idx = nearestInsertIndex(trailPath, latlng);
    const next = [...trailPath];
    next.splice(idx, 0, { lat: latlng.lat, lng: latlng.lng });
    onChange(next);
  };

  const movePoint = (index, latlng) => {
    const next = [...trailPath];
    next[index] = { lat: latlng.lat, lng: latlng.lng };
    onChange(next);
  };

  const removePoint = (index) => {
    onChange(trailPath.filter((_, i) => i !== index));
  };

  const rebuildFromWaypoints = () => {
    if (waypoints.length < 2) return;
    onChange(waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
  };

  const clearAll = () => {
    if (trailPath.length && !confirm(`Clear all ${trailPath.length} trail points?`)) return;
    onChange([]);
  };

  const center = useMemo(() => {
    if (trailPath.length > 0) return [trailPath[0].lat, trailPath[0].lng];
    if (waypoints.length > 0) return [waypoints[0].lat, waypoints[0].lng];
    return [35.24, 24.8]; // Crete fallback
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button" size="sm"
            variant={mode === 'add' ? 'default' : 'outline'}
            onClick={() => setMode('add')}
            className={mode === 'add' ? 'bg-amber-500 hover:bg-amber-600 text-black' : 'bg-slate-700 border-slate-600 text-slate-300'}
          >
            <MousePointerClick className="w-4 h-4" /> Add
          </Button>
          <Button
            type="button" size="sm"
            variant={mode === 'delete' ? 'default' : 'outline'}
            onClick={() => setMode('delete')}
            className={mode === 'delete' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}
          >
            <Eraser className="w-4 h-4" /> Delete
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button" size="sm" variant="outline"
            onClick={rebuildFromWaypoints}
            disabled={waypoints.length < 2}
            className="bg-slate-700 border-slate-600 text-slate-300 hover:text-white"
            title="Replace the trail line with straight segments connecting your waypoint coordinates"
          >
            <RefreshCw className="w-4 h-4" /> From waypoints
          </Button>
          <Button
            type="button" size="sm" variant="outline"
            onClick={clearAll}
            disabled={trailPath.length === 0}
            className="bg-slate-700 border-slate-600 text-slate-400 hover:text-red-400"
          >
            <Trash2 className="w-4 h-4" /> Clear
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        {mode === 'add'
          ? 'Click anywhere on the map to drop a trail point — it inserts at the nearest spot along the line. Drag any amber dot to move it onto the visible trail.'
          : 'Drag on the map to draw a box and delete every point inside it at once — great for clearing a dense surplus. Or click a single red dot to remove just that one. Deleted points also vanish from the Route Path list below.'}
      </p>

      <div className="h-[420px] rounded-xl overflow-hidden border border-slate-600">
        <MapContainer center={center} zoom={14} className="w-full h-full" style={{ minHeight: '420px' }}>
          <ClickToAdd onAdd={insertAt} active={mode === 'add'} />
          <DragController mode={mode} />
          <BoxDelete active={mode === 'delete'} trailPath={trailPath} onDelete={onChange} />

          {/* OSM tiles — same base map users see */}
          <TileLayer
            url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />

          <FitBounds trailPath={trailPath} waypoints={waypoints} />

          {/* Your waypoints as reference pins (blue, non-interactive) */}
          {waypoints.map((w, i) => (
            <CircleMarker
              key={`wp-${i}`}
              center={[w.lat, w.lng]}
              radius={5}
              pathOptions={{ color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.7 }}
            />
          ))}

          {/* The trail line */}
          {trailPath.length > 1 && (
            <Polyline
              positions={trailPath.map(p => [p.lat, p.lng])}
              pathOptions={{ color: '#f59e0b', weight: 4, opacity: 0.9 }}
            />
          )}

          {/* Draggable trail points */}
          {trailPath.map((p, i) => (
            <Marker
              key={`pt-${i}`}
              position={[p.lat, p.lng]}
              icon={trailDot(mode)}
              draggable={mode === 'add'}
              eventHandlers={{
                dragend: (e) => {
                  const ll = e.target.getLatLng();
                  movePoint(i, { lat: ll.lat, lng: ll.lng });
                },
                click: (e) => {
                  if (mode === 'delete') {
                    e.originalEvent.stopPropagation?.();
                    removePoint(i);
                  }
                },
              }}
            />
          ))}
        </MapContainer>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-amber-400" /> Trail points: {trailPath.length}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /> Waypoints: {waypoints.length}</span>
      </div>
    </div>
  );
}