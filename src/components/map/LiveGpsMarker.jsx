import { useEffect, useState } from 'react';
import { Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import * as gpsService from '@/lib/gpsService';

const gpsIcon = L.divIcon({
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

export default function LiveGpsMarker({ followUser }) {
  const [position, setPosition] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const map = useMap();

  useEffect(() => {
    if (!gpsService.isSupported()) return;

    const watcher = gpsService.watchPosition(
      (pos) => {
        const latlng = [pos.coords.latitude, pos.coords.longitude];
        setPosition(latlng);
        setAccuracy(pos.coords.accuracy);
        if (followUser) {
          map.setView(latlng, Math.max(map.getZoom(), 15), { animate: true });
        }
      },
      null,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => gpsService.clearWatch(watcher);
  }, [map, followUser]);

  if (!position) return null;

  return (
    <>
      <Circle
        center={position}
        radius={accuracy || 20}
        pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 1 }}
      />
      <Marker position={position} icon={gpsIcon} zIndexOffset={1000} />
    </>
  );
}