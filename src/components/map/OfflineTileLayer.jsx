import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { cacheTile, getCachedTile } from '../offline/offlineStorage';

/**
 * A custom tile layer that:
 * 1. Tries to load tiles from the network (and caches them in IndexedDB)
 * 2. Falls back to the cached version when offline
 */
export default function OfflineTileLayer({ url, attribution }) {
  const map = useMap();

  useEffect(() => {
    const OfflineLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('img');
        tile.setAttribute('role', 'presentation');

        const tileUrl = this.getTileUrl(coords);

        // Try network first, cache on success
        const tryNetwork = () => {
          fetch(tileUrl)
            .then(res => {
              if (!res.ok) throw new Error('Network tile failed');
              return res.blob();
            })
            .then(blob => {
              cacheTile(tileUrl, blob);
              const objectUrl = URL.createObjectURL(blob);
              tile.src = objectUrl;
              tile.onload = () => { URL.revokeObjectURL(objectUrl); done(null, tile); };
            })
            .catch(() => {
              // Network failed — try cache
              getCachedTile(tileUrl).then(blob => {
                if (blob) {
                  const objectUrl = URL.createObjectURL(blob);
                  tile.src = objectUrl;
                  tile.onload = () => { URL.revokeObjectURL(objectUrl); done(null, tile); };
                } else {
                  // No cache either — use a grey placeholder
                  tile.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
                  done(null, tile);
                }
              });
            });
        };

        tryNetwork();
        return tile;
      },
    });

    const layer = new OfflineLayer(url, {
      attribution,
      maxZoom: 19,
      crossOrigin: true,
    });

    layer.addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map, url, attribution]);

  return null;
}