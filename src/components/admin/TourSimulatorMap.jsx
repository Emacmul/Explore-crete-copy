import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getRoleColour, calculateBearing } from '@/lib/routeExport';

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

function FitBounds({ trailPath, waypoints }) {
  const map = useMap();
  useEffect(() => {
    const pts = trailPath?.length > 0
      ? trailPath.map(p => [p.lat, p.lng])
      : waypoints?.map(w => [w.lat, w.lng]);
    if (pts?.length > 0) {
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
    }
  }, [map, trailPath, waypoints]);
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

function wpIcon(colour, emoji) {
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${colour};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:12px;">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
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

export default function TourSimulatorMap({ trailPath, waypoints, allWaypoints, triggered, currentPos, currentBearing, isWalkingTour, onWaypointUpdate }) {
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

      {trailPath.length > 1 && (
        <Polyline
          positions={trailPath.map(p => [p.lat, p.lng])}
          pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.7 }}
        />
      )}

      {waypoints.map((wp, i) => {
        const isTriggered = triggered[i];
        const hasAudio = wp.trigger_audio && wp.audio_clip_url;
        const colour = isTriggered ? '#22c55e' : (hasAudio ? '#a855f7' : getRoleColour(wp.waypoint_role));
        const emoji = isTriggered ? '✅' : (hasAudio ? '🔊' : '📍');
        // 150m matches the Walk entity's schema default and the live tour
        // player's fallback — must stay in sync with those (see TourSimulator.jsx).
        const radius = Number(wp.trigger_radius_m) || 150;
        const bearingDir = Number(wp.bearing_direction) || 0;
        const canEdit = !!onWaypointUpdate;
        // `waypoints` here may be a filtered subset of the tour's full waypoint
        // list (entries missing lat/lng are dropped upstream), so its index `i`
        // does not necessarily match the index onWaypointUpdate expects into the
        // full, unfiltered waypoints array. Resolve the real index by identity.
        const origIndex = allWaypoints ? allWaypoints.indexOf(wp) : i;

        const bearingTipPos = destinationPoint(wp.lat, wp.lng, bearingDir, radius);
        const bearingTailPos = destinationPoint(wp.lat, wp.lng, bearingDir + 180, radius);
        const radiusHandlePos = destinationPoint(wp.lat, wp.lng, bearingDir + 90, radius);

        return (
          <React.Fragment key={i}>
            <Marker position={[wp.lat, wp.lng]} icon={wpIcon(colour, emoji)} />

            {/* Pastel red radius circle — scales with zoom (uses metres) */}
            {hasAudio && (
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
            )}

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
                      if (origIndex < 0) return;
                      const ll = e.target.getLatLng();
                      const newBearing = calculateBearing(wp.lat, wp.lng, ll.lat, ll.lng);
                      const normalized = Math.round(((newBearing % 360) + 360) % 360);
                      onWaypointUpdate(origIndex, 'bearing_direction', normalized);
                    },
                  } : undefined}
                />
                <Marker
                  position={radiusHandlePos}
                  icon={handleIcon('#ff6b6b')}
                  draggable={canEdit}
                  eventHandlers={canEdit ? {
                    dragend: (e) => {
                      if (origIndex < 0) return;
                      const ll = e.target.getLatLng();
                      const newRadius = haversine(wp.lat, wp.lng, ll.lat, ll.lng);
                      onWaypointUpdate(origIndex, 'trigger_radius_m', Math.max(10, Math.round(newRadius)));
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