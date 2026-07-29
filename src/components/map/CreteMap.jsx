import React, { useEffect } from 'react';
import { MapContainer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { Mountain } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import OfflineTileLayer from './OfflineTileLayer';

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom walk marker
const createWalkIcon = (isSelected) => {
  return L.divIcon({
    className: 'custom-walk-marker',
    html: `<div class="w-8 h-8 rounded-full ${isSelected ? 'bg-amber-500 scale-125' : 'bg-blue-600'} border-3 border-white shadow-lg flex items-center justify-center transition-all">
      <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M13 4v16M7 8l6-4 6 4M7 12l6 4 6-4"/>
      </svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng);
    },
  });
  return null;
}

function MapBoundsController() {
  const map = useMap();
  
  useEffect(() => {
    // Crete bounds
    const creteBounds = [
      [34.9, 23.5], // Southwest
      [35.7, 26.4]  // Northeast
    ];
    map.fitBounds(creteBounds);
  }, [map]);
  
  return null;
}

export default function CreteMap({ walks, selectedWalk, onWalkSelect, onMapClick }) {
  // Center of Crete
  const creteCenter = [35.24, 24.9];

  return (
    <MapContainer
      center={creteCenter}
      zoom={9}
      className="w-full h-full rounded-xl"
      style={{ minHeight: '400px' }}
    >
      <OfflineTileLayer
        url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <MapBoundsController />
      <MapClickHandler onMapClick={onMapClick} />
      
      {walks.map((walk) => (
        <Marker
          key={walk.id}
          position={[walk.start_lat, walk.start_lng]}
          icon={createWalkIcon(selectedWalk?.id === walk.id)}
          eventHandlers={{
            click: () => onWalkSelect(walk),
          }}
        >
          <Popup>
            <div className="text-center p-1">
              <span className="font-mono text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                {walk.code}
              </span>
              <p className="font-semibold mt-1 text-sm">{walk.name}</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}