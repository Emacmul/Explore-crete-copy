import { useState, useEffect, useCallback } from 'react';
import * as offlineStorageService from '@/lib/offlineStorageService';
import {
  replaceWalkOffline,
  preCacheWalkTiles,
  preCacheWalkAudio,
  removeWalkFullyOffline,
} from '@/components/offline/offlineStorage';
import { useAuth } from '@/lib/AuthContext';

// A single event dispatched whenever the offline set changes, so every component
// using this hook (header badge, walk cards, the detail button, My Walks) re-reads
// the one source of truth (IndexedDB) at the same time. Same-tab IndexedDB writes
// don't fire 'storage' events, so we need our own.
const SYNC_EVENT = 'offline-walks-changed';

export function useOfflineWalks() {
  // IndexedDB is the single source of truth: the full walk data, the cached map
  // tiles, and the cached narration audio all live there. The lightweight
  // localStorage index the button used to write to is no longer read by anyone.
  const { user } = useAuth();
  const ownerEmail = (user?.email || '').toLowerCase().trim() || null;
  const [offlineWalks, setOfflineWalks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Filtered to walks THIS account downloaded (audit finding U-04, 2026-09-09 review): the
  // IndexedDB store itself is shared by whoever is signed in on this browser, so without
  // this filter a shared device would show one person's paid offline downloads — full trail,
  // waypoints, narration — to whoever signs in next. A walk saved before this fix shipped
  // has no _owner_email at all; it's shown to nobody until re-downloaded under an account,
  // rather than guessed to belong to whoever happens to be signed in now.
  const reload = useCallback(async () => {
    const all = await offlineStorageService.getAllWalkData();
    setOfflineWalks(ownerEmail ? all.filter(w => w._owner_email === ownerEmail) : []);
    setLoaded(true);
  }, [ownerEmail]);

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

  // The full offline save: map tiles + narration audio downloaded first, THEN the walk
  // is recorded as "saved offline" — only once the audio (the actual point of the app)
  // is confirmed complete. Map tiles are a secondary visual aid — the trail line itself
  // is drawn from the walk's own GPS points, not the tile images — so a few missing
  // tiles don't block the save, but a walk is never marked offline-ready with narration
  // missing (audit finding U-02, 2026-09-09 review: the old version always reported
  // success/100% even when clips silently failed to download).
  //
  // onProgress reports 0–100 across tiles (0–70%) then audio (70–100%), so the button
  // can show a real percentage instead of a fake spinner. The return value tells the
  // caller whether the save actually succeeded, and how much of the audio made it.
  const downloadWalk = useCallback(async (walk, onProgress) => {
    const tiles = await preCacheWalkTiles(walk, p => onProgress?.(Math.round(p * 0.7)));
    const audio = await preCacheWalkAudio(walk, p => onProgress?.(70 + Math.round(p * 0.3)));
    onProgress?.(100);

    const audioComplete = audio.cached >= audio.total;
    if (audioComplete) {
      // Only now — with every narration clip confirmed in storage — does this walk
      // become the one IndexedDB stores as "offline". Doing this last (instead of
      // first, as before) also means that if this is replacing an older translation's
      // download, the OLD audio stays available the whole time the new audio is
      // downloading, instead of being deleted up front before the replacement exists.
      await replaceWalkOffline(walk, ownerEmail);
      window.dispatchEvent(new Event(SYNC_EVENT));
    }

    return { success: audioComplete, audio, tiles };
  }, [ownerEmail]);

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