import React, { useState, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents, CircleMarker, Rectangle } from 'react-leaflet';
import L from 'leaflet';
import { Button } from '@/components/ui/button';
import { Trash2, MousePointerClick, Eraser, RefreshCw, MapPin, Scissors } from 'lucide-react';
import { reindexAfterInsert, reindexAfterDeleteOne, reindexAfterDeleteMany, nearestInsertIndex, distToSegmentM } from '@/lib/trailBreaks';

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
// Cut re-indexing + nearest-insertion helpers are imported above from
// @/lib/trailBreaks, shared with the list-style TrailPathEditor so both keep
// cuts aligned no matter which one edits the path.

// Drag-to-box delete. Uses DOM-level listeners on the map container + window so the box
// always releases — even if the cursor leaves the map or passes over a marker mid-drag
// (the old map-only mouseup sometimes never fired, leaving the red box stuck on screen).
function BoxDelete({ active, trailPath, onDelete, trailBreaks, onBreaksChange }) {
  const map = useMap();
  const startRef = React.useRef(null);
  const pathRef = React.useRef(trailPath);
  pathRef.current = trailPath;
  const breaksRef = React.useRef(trailBreaks);
  breaksRef.current = trailBreaks;
  const [box, setBox] = useState(null);

  React.useEffect(() => {
    if (!active) { startRef.current = null; setBox(null); return; }
    const container = map.getContainer();

    const onDown = (e) => {
      if (e.button !== 0) return;
      const ll = map.mouseEventToLatLng(e);
      startRef.current = ll;
      setBox({ start: ll, end: ll });
    };
    const onMove = (e) => {
      if (!startRef.current) return;
      setBox({ start: startRef.current, end: map.mouseEventToLatLng(e) });
    };
    const onUp = (e) => {
      if (!startRef.current) return;
      const start = startRef.current;
      const end = map.mouseEventToLatLng(e);
      startRef.current = null;
      setBox(null);
      const minLat = Math.min(start.lat, end.lat), maxLat = Math.max(start.lat, end.lat);
      const minLng = Math.min(start.lng, end.lng), maxLng = Math.max(start.lng, end.lng);
      // Bare click (no real drag) — single-point deletes happen via marker clicks.
      if (Math.abs(start.lat - end.lat) < 1e-7 && Math.abs(start.lng - end.lng) < 1e-7) return;
      const deletedSet = new Set();
      pathRef.current.forEach((p, i) => {
        if (p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng) deletedSet.add(i);
      });
      const next = pathRef.current.filter((_, i) => !deletedSet.has(i));
      if (deletedSet.size > 0) {
        onDelete(next);
        onBreaksChange?.(reindexAfterDeleteMany(breaksRef.current, deletedSet));
      }
    };

    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      startRef.current = null;
      setBox(null);
    };
  }, [active, map, onDelete, onBreaksChange]);

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



const trailDot = (mode) => L.divIcon({
  className: '',
  html: `<div style="width:13px;height:13px;border-radius:50%;background:${mode === 'delete' ? '#ef4444' : '#f59e0b'};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);cursor:${mode === 'delete' ? 'pointer' : 'move'}"></div>`,
  iconSize: [13, 13],
  iconAnchor: [6.5, 6.5],
});

export default function TrailPathMapEditor({ trailPath, onChange, trailBreaks = [], onBreaksChange, waypoints = [] }) {
  const [mode, setMode] = useState('add'); // 'add' | 'delete' | 'cut'

  // Toggle a cut at the segment between point idx and point idx+1.
  const toggleBreak = (idx) => {
    if (idx < 0 || idx >= trailPath.length - 1) return;
    const set = new Set(trailBreaks || []);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    onBreaksChange?.(Array.from(set).sort((a, b) => a - b));
  };

  const insertAt = (latlng) => {
    const idx = nearestInsertIndex(trailPath, latlng);
    const next = [...trailPath];
    next.splice(idx, 0, { lat: latlng.lat, lng: latlng.lng });
    onChange(next);
    onBreaksChange?.(reindexAfterInsert(trailBreaks, idx));
  };

  const movePoint = (index, latlng) => {
    const next = [...trailPath];
    next[index] = { lat: latlng.lat, lng: latlng.lng };
    onChange(next);
  };

  const removePoint = (index) => {
    const next = trailPath.filter((_, i) => i !== index);
    onChange(next);
    onBreaksChange?.(reindexAfterDeleteOne(trailBreaks, index));
  };

  const rebuildFromWaypoints = () => {
    if (waypoints.length < 2) return;
    onChange(waypoints.map(w => ({ lat: w.lat, lng: w.lng })));
    onBreaksChange?.([]);
  };

  const clearAll = () => {
    if (trailPath.length && !confirm(`Clear all ${trailPath.length} trail points?`)) return;
    onChange([]);
    onBreaksChange?.([]);
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
            onClick={() => setMode(mode === 'delete' ? 'add' : 'delete')}
            className={mode === 'delete' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}
            title="Drag a box to delete many points at once (click again to exit)"
          >
            <Eraser className="w-4 h-4" /> Delete
          </Button>
          <Button
            type="button" size="sm"
            variant={mode === 'cut' ? 'default' : 'outline'}
            onClick={() => setMode(mode === 'cut' ? 'add' : 'cut')}
            className={mode === 'cut' ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}
            title="Click a line segment to break it — the non-existing link disappears. Click the dashed red segment again to rejoin."
          >
            <Scissors className="w-4 h-4" /> Cut
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
          : mode === 'delete'
          ? 'Drag on the map to draw a box and delete every point inside it at once — great for clearing a dense surplus. Or click a single red dot to remove just that one. Deleted points also vanish from the Route Path list below.'
          : 'Click any amber line segment to break it — the non-existing link between two trail sections disappears and is shown as a dashed red line. Click the dashed red segment again to rejoin. Use this to remove straight "bridge" lines the import drew across gaps.'}
      </p>

      <div className="h-[420px] rounded-xl overflow-hidden border border-slate-600">
        <MapContainer center={center} zoom={14} className="w-full h-full" style={{ minHeight: '420px' }}>
          <ClickToAdd onAdd={insertAt} active={mode === 'add'} />
          <DragController mode={mode} />
          <BoxDelete active={mode === 'delete'} trailPath={trailPath} onDelete={onChange} trailBreaks={trailBreaks} onBreaksChange={onBreaksChange} />

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

          {/* The trail line — split into runs at each cut, so broken segments aren't drawn */}
          {(() => {
            const breakSet = new Set((trailBreaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1));
            const runs = [];
            let run = []; let runStart = 0;
            for (let i = 0; i < trailPath.length; i++) {
              run.push([trailPath[i].lat, trailPath[i].lng]);
              if (breakSet.has(i) || i === trailPath.length - 1) {
                runs.push({ pts: run, startIdx: runStart, endIdx: i });
                run = []; runStart = i + 1;
              }
            }
            const connectors = (trailBreaks || [])
              .filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1)
              .map(b => ({ breakIdx: b, from: [trailPath[b].lat, trailPath[b].lng], to: [trailPath[b + 1].lat, trailPath[b + 1].lng] }));
            return (
              <>
                {runs.map((r, ri) => r.pts.length > 1 && (
                  <Polyline
                    key={`run-${ri}`}
                    positions={r.pts}
                    pathOptions={{ color: '#f59e0b', weight: 4, opacity: 0.9 }}
                    eventHandlers={mode === 'cut' ? {
                      click: (e) => {
                        const ll = e.latlng;
                        let best = { d: Infinity, idx: r.startIdx };
                        for (let j = r.startIdx; j < r.endIdx; j++) {
                          const d = distToSegmentM(ll, trailPath[j], trailPath[j + 1]);
                          if (d < best.d) best = { d, idx: j };
                        }
                        toggleBreak(best.idx);
                      },
                    } : {}}
                  />
                ))}
                {/* Dashed red connectors mark the cuts — click to rejoin (cut mode only) */}
                {mode === 'cut' && connectors.map((c, ci) => (
                  <Polyline
                    key={`brk-${ci}`}
                    positions={[c.from, c.to]}
                    pathOptions={{ color: '#ef4444', weight: 3, opacity: 0.6, dashArray: '6 6' }}
                    eventHandlers={{
                      click: (e) => { e.originalEvent.stopPropagation?.(); toggleBreak(c.breakIdx); },
                    }}
                  />
                ))}
              </>
            );
          })()}

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
        <span className="flex items-center gap-1"><Scissors className="w-3 h-3 text-purple-400" /> Cuts: {(trailBreaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1).length}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /> Waypoints: {waypoints.length}</span>
      </div>
    </div>
  );
}