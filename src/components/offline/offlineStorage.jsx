/**
 * Offline storage for walks.
 *
 * Platform-specific storage operations are delegated to offlineStorageService.
 * This module preserves the original API names as a thin facade so existing
 * consumers do not need to change their imports.
 */

import * as offlineStorageService from '@/lib/offlineStorageService';
import { splitTrailRuns } from '@/lib/routeExport';

export const saveWalkOffline = offlineStorageService.saveWalkData;
export const getOfflineWalk = offlineStorageService.getWalkData;
export const getAllOfflineWalks = offlineStorageService.getAllWalkData;
export const removeOfflineWalk = offlineStorageService.removeWalkData;
export const isWalkSavedOffline = offlineStorageService.isWalkDataSaved;
export const isWalkOutdated = offlineStorageService.isWalkDataOutdated;
export const cacheTile = offlineStorageService.cacheTile;
export const getCachedTile = offlineStorageService.getCachedTile;

/**
 * Pre-cache all map tiles for a given trail bounding box at zoom levels 12–16.
 * Returns { total, cached } counts.
 */
export async function preCacheWalkTiles(walk, onProgress) {
  const tileUrl = (z, x, y) =>
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

  const lat2tile = (lat, zoom) =>
    Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * Math.pow(2, zoom));
  const lng2tile = (lng, zoom) =>
    Math.floor((lng + 180) / 360 * Math.pow(2, zoom));

  // One coverage box per trail run (broken at cuts) plus a box for the waypoints
  // and start point. A box per run — instead of one box over every trail point —
  // means a large gap between two cut sections doesn't pull in a huge rectangle
  // of irrelevant tiles over the gap; only the areas the hiker visits are cached.
  const PAD = 0.02; // degrees padding (~2km) around each box
  const boxes = [];
  for (const run of splitTrailRuns(walk.trail_path || [], walk.trail_breaks)) {
    if (run.length === 0) continue;
    boxes.push(run.map(([lat, lng]) => ({ lat, lng })));
  }
  const extraPoints = [
    ...(walk.waypoints || []),
    { lat: walk.start_lat, lng: walk.start_lng },
  ].filter(p => p.lat && p.lng);
  if (extraPoints.length) boxes.push(extraPoints);

  if (boxes.length === 0) return { total: 0, cached: 0 };

  const tileSet = new Set(); // dedupe "z:x:y" across overlapping boxes
  for (const pts of boxes) {
    const lats = pts.map(p => p.lat);
    const lngs = pts.map(p => p.lng);
    const minLat = Math.min(...lats) - PAD;
    const maxLat = Math.max(...lats) + PAD;
    const minLng = Math.min(...lngs) - PAD;
    const maxLng = Math.max(...lngs) + PAD;
    for (let z = 12; z <= 16; z++) {
      const x0 = lng2tile(minLng, z);
      const x1 = lng2tile(maxLng, z);
      const y0 = lat2tile(maxLat, z);
      const y1 = lat2tile(minLat, z);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          tileSet.add(`${z}:${x}:${y}`);
        }
      }
    }
  }

  const tilesToFetch = [...tileSet].map(key => {
    const [z, x, y] = key.split(':').map(Number);
    return { z, x, y };
  });

  let cached = 0;
  const total = tilesToFetch.length;

  // Batch fetch with concurrency limit of 4
  const batchSize = 4;
  for (let i = 0; i < tilesToFetch.length; i += batchSize) {
    const batch = tilesToFetch.slice(i, i + batchSize);
    await Promise.all(batch.map(async ({ z, x, y }) => {
      const url = tileUrl(z, x, y);
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          await offlineStorageService.cacheTile(url, blob);
          cached++;
        }
      } catch { /* skip on error */ }
      if (onProgress) onProgress(Math.round((cached / total) * 100));
    }));
  }

  return { total, cached };
}