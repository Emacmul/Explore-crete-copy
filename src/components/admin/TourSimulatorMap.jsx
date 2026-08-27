import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { calculateBearing, splitTrailRuns } from '@/lib/routeExport';

const R_EARTH = 6371000;

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

function destinationPoint(lat, lng, bearingDeg, distanceM) {
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const dR = distanceM / R_EARTH;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
    Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [
    (lat2 * 180) / Math.PI,
    (((lng2 * 180) / Math.PI + 540) % 360) - 180,
  ];
}

// Per Enda's follow-up 48 report: separate from the initial whole-trail fit above —
// this fires only when `focusBounds` itself changes (passed down from
// TourSimulator.jsx's jumpToLocation, a fresh array each time), zooming/centring on
// just one location's own waypoints without disturbing the whole-trail fit's own
// unrelated effect timing.
function FocusBounds({ focusBounds }) {
  const map = useMap();
  useEffect(() => {
    if (focusBounds && focusBounds.length > 0) {
      // Per Enda's report: opening a location didn't actually zoom in tight — he had to
      // zoom in manually about 4x to reach the view this should already open with.
      // Leaflet computes fitBounds against whatever pixel size the map container has AT
      // THE MOMENT this runs; in a CSS grid layout like this one (the map is one column
      // of a two-column grid next to the script editor), that size can still be
      // settling for a frame or two right after mount, so the very first fit can be
      // computed against a container that isn't at its final size yet — a manual zoom
      // works fine because by then the layout has long since settled. invalidateSize()
      // forces Leaflet to re-measure the container right before fitting, and the
      // requestAnimationFrame defers this one extra frame so that re-measure happens
      // after the browser has actually finished laying the grid out — the standard fix
      // for a map mounted inside a layout whose size isn't known synchronously at mount.
      const frame = requestAnimationFrame(() => {
        map.invalidateSize();
        map.fitBounds(L.latLngBounds(focusBounds), { padding: [60, 60], maxZoom: 17 });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [map, focusBounds]);
  return null;
}

function FitBounds({ trailPath, waypoints }) {
  const map = useMap();
  // Per Enda: this used to re-fit (and so re-zoom/re-centre) the map on every single
  // render of the parent TourSimulator, because `waypoints` was in the dependency
  // array below and TourSimulator passes a freshly-filtered (i.e. a brand new,
  // never-the-same-object) waypoints array on every render — which happens on every
  // simulation tick while playing. That's why zooming in to fine-tune a waypoint and
  // then pressing Start immediately snapped the map back out to fit the whole trail:
  // this effect was firing again the instant the first tick's re-render happened.
  // `waypoints` is only needed as a fallback source of points when there's no trail
  // path at all yet, so it's read directly inside the effect (not via a dependency)
  // and the effect itself now only re-runs when the map instance or the trail path
  // itself actually changes — never on a normal playback tick — so a manual zoom/pan
  // is preserved through Start/Pause/Reset. Same invalidateSize()/requestAnimationFrame
  // reasoning as FocusBounds above — this is the very first fit to run at all, so it's
  // the one most likely to land before the grid layout has finished settling.
  useEffect(() => {
    const pts = trailPath?.length > 0
      ? trailPath.map(p => [p.lat, p.lng])
      : waypoints?.map(w => [w.lat, w.lng]);
    if (pts?.length > 0) {
      const frame = requestAnimationFrame(() => {
        map.invalidateSize();
        map.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [map, trailPath]);
  return null;
}

const RED_CAR_SVG = `<svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="18" cy="23" rx="12" ry="14" fill="rgba(0,0,0,0.25)"/>
  <rect x="7" y="3" width="22" height="38" rx="9" fill="#ef4444" stroke="#b91c1c" stroke-width="2"/>
  <path d="M10,10 Q18,6 26,10 L24,15 Q18,12 12,15 Z" fill="#dbeafe" opacity="0.9"/>
  <rect x="10" y="15" width="16" height="12" rx="2" fill="#dc2626"/>
  <path d="M12,29 Q18,31 24,29 L26,34 Q18,36 10,34 Z" fill="#dbeafe" opacity="0.75"/>
  <circle cx="11" cy="6" r="1.5" fill="#fde68a"/>
  <circle cx="25" cy="6" r="1.5" fill="#fde68a"/>
</svg>`;

const RED_MAN_SVG = `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="14" cy="19" rx="8" ry="10" fill="rgba(0,0,0,0.25)"/>
  <path d="M14,12 C9,12 6,16 6,22 C6,28 9,32 14,32 C19,32 22,28 22,22 C22,16 19,12 14,12 Z" fill="#ef4444" stroke="#b91c1c" stroke-width="2"/>
  <circle cx="14" cy="7" r="5" fill="#fecaca" stroke="#b91c1c" stroke-width="2"/>
  <circle cx="14" cy="3" r="1.2" fill="#b91c1c"/>
</svg>`;

function moverIcon(bearing, isWalking) {
  const svg = isWalking ? RED_MAN_SVG : RED_CAR_SVG;
  const w = isWalking ? 28 : 36;
  const h = isWalking ? 36 : 44;
  return L.divIcon({
    className: '',
    html: `<div style="transform: rotate(${bearing}deg); transform-origin: center; transition: transform 0.15s linear; width:${w}px;height:${h}px;">${svg}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

function wpIcon(colour, emoji, size, opacity = 1) {
  const half = size / 2;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colour};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.43)}px;opacity:${opacity};">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
  });
}

// Per Enda's follow-up 48 report: "A Primary waypoint must be Green, as is its colour
// code throughout the app, and larger than a secondary waypoint. A secondary waypoint
// must be blue, and smaller." This is now the marker's BASE colour/size, unconditional
// on role — separate from the emoji overlay just below, which is what still shows
// triggered/has-audio state. Before this, colour itself flipped for triggered/has-audio
// (green when triggered, purple when it merely had audio) and every waypoint was drawn
// at the same fixed size — that meant a triggered SECONDARY waypoint turned the same
// green as an untriggered PRIMARY one, and a co-located primary_start/secondary pair
// (see the comment on locationKey below) was impossible to tell apart at all. Role
// colour/size is now the constant, primary signal; triggered/audio state moved onto the
// emoji instead of taking over the whole marker.
function roleMarkerStyle(role) {
  const isPrimary = role === 'primary_start' || role === 'primary_stop';
  return { colour: isPrimary ? '#22c55e' : '#3b82f6', size: isPrimary ? 34 : 22 };
}

function arrowIcon(bearing) {
  return L.divIcon({
    className: '',
    html: `<svg width="24" height="24" viewBox="0 0 24 24" style="transform: rotate(${bearing}deg); transform-origin: center;"><path d="M12,2 L18,16 L12,12 L6,16 Z" fill="white" stroke="#333" stroke-width="1.5"/></svg>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function handleIcon(colour) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${colour};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);cursor:grab;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Per Enda's report: when the map is scoped to just one location (focusRange, set by
// TourSimulator.jsx during ordinary script/audio browsing), the drawn road should only
// cover that location's own stretch — not the whole tour's trail. Finds the trail-path
// vertex nearest each end of the location (the same "nearest vertex" approach
// cumDistForWaypoint in TourSimulator.jsx uses for trigger-distance calculations) and
// slices the polyline between them. Falls back to the full trailPath whenever there's no
// focusRange, or the location's own waypoints can't be matched onto the trail for any
// reason — never silently draws nothing.
function sliceTrailToRange(trailPath, waypoints, focusRange) {
  if (!focusRange || !trailPath || trailPath.length < 2) return trailPath;
  const first = waypoints[focusRange.startIndex];
  const last = waypoints[Math.max(focusRange.startIndex, focusRange.endIndex - 1)];
  if (!first?.lat || !first?.lng || !last?.lat || !last?.lng) return trailPath;
  const nearestIndex = (lat, lng) => {
    let bestIdx = 0, bestD = Infinity;
    trailPath.forEach((pt, i) => {
      const d = haversine(lat, lng, pt.lat, pt.lng);
      if (d < bestD) { bestD = d; bestIdx = i; }
    });
    return bestIdx;
  };
  const startIdx = nearestIndex(first.lat, first.lng);
  const endIdx = nearestIndex(last.lat, last.lng);
  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);
  const slice = trailPath.slice(lo, hi + 1);
  return slice.length > 1 ? slice : trailPath;
}

export default function TourSimulatorMap({ trailPath, waypoints, triggered, currentPos, currentBearing, isWalkingTour, onWaypointUpdate, breaks, focusBounds, focusRange }) {
  // Per Enda's report: general script/audio browsing should show only the current
  // location's own waypoints and road, not the whole multi-location tour. `waypoints`
  // itself is deliberately left untouched below (still the full array, so `i` in the
  // marker loop stays aligned with `triggered`'s keys and with onWaypointUpdate's
  // expected index) — only the drawn polyline is scoped here, and each marker below
  // checks focusRange itself before rendering.
  const displayTrailPath = useMemo(
    () => sliceTrailToRange(trailPath, waypoints, focusRange),
    [trailPath, waypoints, focusRange]
  );
  const center = trailPath.length > 0
    ? [trailPath[0].lat, trailPath[0].lng]
    : waypoints.length > 0
      ? [waypoints[0].lat, waypoints[0].lng]
      : [35.24, 24.81];

  return (
    <MapContainer center={center} zoom={13} className="w-full h-full" style={{ minHeight: '350px' }}>
      <TileLayer
        url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      <FitBounds trailPath={trailPath} waypoints={waypoints} />
      <FocusBounds focusBounds={focusBounds} />

      {displayTrailPath.length > 1 &&
        // `breaks` holds indices into the FULL trailPath — meaningless against a
        // location-scoped slice, so it's skipped whenever focusRange narrowed the
        // polyline (a break landing inside one location's own stretch is rare; drawing
        // that stretch as one continuous line in that case is a minor, honest trade-off,
        // not a data problem).
        splitTrailRuns(displayTrailPath, focusRange ? [] : breaks).map((run, i) =>
          run.length > 1 ? (
            <Polyline
              key={i}
              positions={run.map(([lat, lng]) => [lat, lng])}
              pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.7 }}
            />
          ) : null
        )}

      {waypoints.map((wp, i) => {
        // `i` is this waypoint's real position in the FULL array — deliberately never
        // filtered/re-indexed (see the note on `displayTrailPath` above) — so this is a
        // pure "skip drawing" check, not a slice; triggered[i] and onWaypointUpdate(i, …)
        // below both still line up correctly for whichever waypoints DO get drawn.
        if (focusRange && (i < focusRange.startIndex || i >= focusRange.endIndex)) return null;
        const isTriggered = triggered[i];
        const hasAudio = wp.trigger_audio && wp.audio_clip_url;
        const { colour, size } = roleMarkerStyle(wp.waypoint_role);
        const emoji = isTriggered ? '✅' : (hasAudio ? '🔊' : '');
        const radius = Number(wp.trigger_radius_m) || 30;
        const bearingDir = Number(wp.bearing_direction) || 0;
        // Per Enda's follow-up 52 report, correcting follow-up 50: a primary_start
        // point (e.g. BOR1a) being "static" only means there's no driving speed to
        // test its SPEECH against — it says nothing about its trigger geofence, which
        // still controls exactly when its (essential) audio starts playing, same as
        // any other waypoint. Follow-up 50 wrongly grouped the two together and made
        // bearing/trigger-radius here non-draggable for a primary_start too; reverted
        // — canEdit is back to being role-independent, so both handles work normally
        // regardless of role.
        //
        // NOTE — this also un-does the side effect follow-up 50 leaned on to resolve
        // changelog item 2 (a primary_start and its first secondary point sit at the
        // exact same lat/lng, so their markers/handles stack). With both editable
        // again, two co-located, both-draggable handles is a real open question once
        // more — Leaflet will just hand a drag to whichever marker happens to be on
        // top / gets clicked, which can make fine-tuning one of the pair fiddly. Not
        // a data risk like the editor-lockout was, just a UI-precision one — left
        // alone for now rather than guessing at a toggle/offset mechanism nobody's
        // asked for yet.
        const canEdit = !!onWaypointUpdate;
        const isMuted = wp.waypoint_role === 'primary_start';

        const bearingTipPos = destinationPoint(wp.lat, wp.lng, bearingDir, radius);
        const bearingTailPos = destinationPoint(wp.lat, wp.lng, bearingDir + 180, radius);
        const radiusHandlePos = destinationPoint(wp.lat, wp.lng, bearingDir + 90, radius);

        return (
          <React.Fragment key={wp.segment_id || `${wp.lat},${wp.lng},${i}`}>
            <Marker position={[wp.lat, wp.lng]} icon={wpIcon(colour, emoji, size, isMuted ? 0.55 : 1)} />

            {/* Pastel red radius circle — scales with zoom (uses metres). Per Enda's
                follow-up 49 report: shown for every waypoint now, not just ones that
                already have audio — the trigger radius should be visible at a glance,
                not something you only find out about as a number after opening the
                editor. Whether a circle can actually be DRAGGED to resize (the handle
                marker below) is a separate concern and stays tied to hasAudio — no
                point offering a resize handle for a radius that doesn't gate anything
                yet. */}
            <Circle
              center={[wp.lat, wp.lng]}
              radius={radius}
              pathOptions={{
                color: '#ff6b6b',
                fillColor: '#ff6b6b',
                fillOpacity: 0.1,
                weight: 1.5,
                dashArray: '4, 4',
              }}
            />

            {/* White bearing arrow through the circle + drag handles */}
            {hasAudio && (
              <>
                <Polyline
                  positions={[bearingTailPos, [wp.lat, wp.lng], bearingTipPos]}
                  pathOptions={{ color: 'white', weight: 2.5, opacity: 0.9 }}
                />
                <Marker
                  position={bearingTipPos}
                  icon={arrowIcon(bearingDir)}
                  draggable={canEdit}
                  eventHandlers={canEdit ? {
                    dragend: (e) => {
                      const ll = e.target.getLatLng();
                      const newBearing = calculateBearing(wp.lat, wp.lng, ll.lat, ll.lng);
                      const normalized = Math.round(((newBearing % 360) + 360) % 360);
                      onWaypointUpdate(i, 'bearing_direction', normalized);
                    },
                  } : undefined}
                />
                <Marker
                  position={radiusHandlePos}
                  icon={handleIcon('#ff6b6b')}
                  draggable={canEdit}
                  eventHandlers={canEdit ? {
                    dragend: (e) => {
                      const ll = e.target.getLatLng();
                      const newRadius = haversine(wp.lat, wp.lng, ll.lat, ll.lng);
                      onWaypointUpdate(i, 'trigger_radius_m', Math.max(10, Math.round(newRadius)));
                    },
                  } : undefined}
                />
              </>
            )}
          </React.Fragment>
        );
      })}

      {currentPos && (
        <Marker position={[currentPos.lat, currentPos.lng]} icon={moverIcon(currentBearing || 0, isWalkingTour)} />
      )}
    </MapContainer>
  );
}