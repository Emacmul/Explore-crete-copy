import { useState, useEffect, useCallback } from 'react';
import * as offlineStorageService from '@/lib/offlineStorageService';
import {
  saveWalkOffline,
  preCacheWalkTiles,
  preCacheWalkAudio,
  removeWalkFullyOffline,
} from '@/components/offline/offlineStorage';

// A single event dispatched whenever the offline set changes, so every component
// using this hook (header badge, walk cards, the detail button, My Walks) re-reads
// the one source of truth (IndexedDB) at the same time. Same-tab IndexedDB writes
// don't fire 'storage' events, so we need our own.
const SYNC_EVENT = 'offline-walks-changed';

export function useOfflineWalks() {
  // IndexedDB is the single source of truth: the full walk data, the cached map
  // tiles, and the cached narration audio all live there. The lightweight
  // localStorage index the button used to write to is no longer read by anyone.
  const [offlineWalks, setOfflineWalks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const all = await offlineStorageService.getAllWalkData();
    setOfflineWalks(all);
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload();
    const handler = () => reload();
    window.addEventListener(SYNC_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(SYNC_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, [reload]);

  // The full offline save: walk data + map tiles + narration audio, all into the
  // one IndexedDB store. onProgress reports 0–100 across tiles (0–70%) then audio
  // (70–100%), so the button can show a real percentage instead of a fake spinner.
  const downloadWalk = useCallback(async (walk, onProgress) => {
    await saveWalkOffline(walk);
    await preCacheWalkTiles(walk, p => onProgress?.(Math.round(p * 0.7)));
    await preCacheWalkAudio(walk, p => onProgress?.(70 + Math.round(p * 0.3)));
    onProgress?.(100);
    window.dispatchEvent(new Event(SYNC_EVENT));
  }, []);

  const removeWalk = useCallback(async (walkId) => {
    await removeWalkFullyOffline(walkId);
    window.dispatchEvent(new Event(SYNC_EVENT));
  }, []);

  const isDownloaded = useCallback((walkId) =>
    offlineWalks.some(w => w.id === walkId), [offlineWalks]);

  const getOfflineWalk = useCallback((walkId) =>
    offlineWalks.find(w => w.id === walkId) || null, [offlineWalks]);

  const getAllOfflineWalks = useCallback(() => offlineWalks, [offlineWalks]);

  return { downloadWalk, removeWalk, isDownloaded, getOfflineWalk, getAllOfflineWalks, offlineWalks, loaded };
}