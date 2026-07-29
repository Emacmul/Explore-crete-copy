import React, { useEffect } from 'react';
import { MapContainer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import OfflineTileLayer from './OfflineTileLayer';
import LiveGpsMarker from './LiveGpsMarker';

const waypointConfig = {
  start: { color: '#22c55e', icon: '🚩', label: 'Start' },
  end: { color: '#ef4444', icon: '🏁', label: 'End' },
  turnoff: { color: '#f59e0b', icon: '↪️', label: 'Turn' },
  danger: { color: '#dc2626', icon: '⚠️', label: 'Danger' },
  viewpoint: { color: '#8b5cf6', icon: '👁️', label: 'View' },
  water: { color: '#3b82f6', icon: '💧', label: 'Water' },
  rest_area: { color: '#10b981', icon: '🪑', label: 'Rest' },
  landmark: { color: '#6366f1', icon: '📍', label: 'Landmark' },
  kafeneon: { color: '#d97706', icon: '☕', label: 'Kafeneon' },
  wildlife_spot: { color: '#16a34a', icon: '🦋', label: 'Wildlife' },
  church: { color: '#ca8a04', icon: '⛪', label: 'Church' },
  ruins: { color: '#ea580c', icon: '🏛️', label: 'Ruins' },
  abandoned_settlement: { color: '#64748b', icon: '🏚️', label: 'Abandoned' },
};

const createWaypointIcon = (type) => {
  const config = waypointConfig[type] || waypointConfig.landmark;

  return L.divIcon({
    className: 'custom-waypoint-marker',
    html: `<div style="width:32px;height:32px;border-radius:50%;background:${config.color};display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${config.icon}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

function FitBoundsToTrail({ trailPath, waypoints }) {
  const map = useMap();

  useEffect(() => {
    const pts = trailPath?.length > 0
      ? trailPath.map(p => [p.lat, p.lng])
      : waypoints?.length > 0
        ? waypoints.map(w => [w.lat, w.lng])
        : null;

    if (pts) {
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
    }
  }, [map, trailPath, waypoints]);

  return null;
}

const drivingRoleConfig = {
  primary_start: { color: '#22c55e', icon: '🚩', label: 'Start' },
  primary_stop: { color: '#ef4444', icon: '🏁', label: 'Stop' },
  secondary: { color: '#3b82f6', icon: '📍', label: 'Point' },
};

export default function WalkDetailMap({ walk, followGps = false }) {
  const trailPath = walk.trail_path || [];
  const isDrivingTour = walk.route_type === 'driving_audio_tour';

  // For driving tours, only show primary_start markers (the -PS segment-start points)
  // on the user-facing map. Secondary waypoints are used internally for audio
  // triggering only. The route line (Polyline) follows trail_path which preserves
  // the full sorted waypoint sequence.
  const allWaypoints = walk.waypoints || [];
  const waypoints = isDrivingTour
    ? allWaypoints.filter(wp => wp.waypoint_role === 'primary_start')
    : allWaypoints;

  const center = trailPath.length > 0
    ? [trailPath[0].lat, trailPath[0].lng]
    : [Number(walk.start_lat), Number(walk.start_lng)];

  return (
    <MapContainer
      center={center}
      zoom={14}
      className="w-full h-full"
      style={{ minHeight: '300px' }}
    >
      <OfflineTileLayer
        url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />

      <FitBoundsToTrail trailPath={trailPath} waypoints={waypoints} />

      {trailPath.length > 1 && (
        <Polyline
          positions={trailPath.map(p => [p.lat, p.lng])}
          pathOptions={{
            color: '#3b82f6',
            weight: 4,
            opacity: 0.85,
            dashArray: '10, 5',
          }}
        />
      )}

      {waypoints.map((wp, i) => {
        const roleConfig = isDrivingTour
          ? (drivingRoleConfig[wp.waypoint_role] || drivingRoleConfig.secondary)
          : null;
        const iconConfig = roleConfig
          ? { color: roleConfig.color, icon: roleConfig.icon }
          : (waypointConfig[wp.type] || waypointConfig.landmark);
        const wpIcon = L.divIcon({
          className: 'custom-waypoint-marker',
          html: `<div style="width:32px;height:32px;border-radius:50%;background:${iconConfig.color};display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${iconConfig.icon}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const wpLabel = roleConfig ? roleConfig.label : (waypointConfig[wp.type]?.label || wp.type);
        const wpColor = iconConfig.color;
        const wpName = isDrivingTour
          ? (wp.segment_title || wp.name)
          : (wp.code && wp.name ? `${wp.code} — ${wp.name}` : (wp.code || wp.name));

        return (
        <Marker
          key={i}
          position={[wp.lat, wp.lng]}
          icon={wpIcon}
        >
          <Popup minWidth={160} maxWidth={220}>
            <div style={{ textAlign: 'center', padding: '4px' }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  color: 'white',
                  backgroundColor: wpColor,
                }}
              >
                {wpLabel}
              </span>

              <p style={{ fontWeight: '600', marginTop: '6px', marginBottom: 0 }}>
                {wpName}
              </p>

              {wp.description && (
                <p style={{ fontSize: '12px', color: '#666', marginTop: '4px', marginBottom: 0 }}>
                  {wp.description}
                </p>
              )}

              {wp.image_url && (
                <img
                  src={wp.image_url}
                  alt={wpName}
                  style={{
                    marginTop: '8px',
                    borderRadius: '6px',
                    width: '100%',
                    maxHeight: '120px',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              )}
            </div>
          </Popup>
        </Marker>
        );
      })}

      <LiveGpsMarker followUser={followGps} />
    </MapContainer>
  );
}