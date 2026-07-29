import { useState, useEffect, useCallback } from 'react';
import * as offlineStorageService from '@/lib/offlineStorageService';

export function useOfflineWalks() {
  const [offlineWalks, setOfflineWalks] = useState(offlineStorageService.getIndex);

  useEffect(() => {
    const handler = () => setOfflineWalks(offlineStorageService.getIndex());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const downloadWalk = useCallback((walk) => {
    const stored = offlineStorageService.addToIndex(walk);
    setOfflineWalks({ ...stored });
  }, []);

  const removeWalk = useCallback((walkId) => {
    const stored = offlineStorageService.removeFromIndex(walkId);
    setOfflineWalks({ ...stored });
  }, []);

  const isDownloaded = useCallback((walkId) => {
    return !!offlineWalks[walkId];
  }, [offlineWalks]);

  const getOfflineWalk = useCallback((walkId) => {
    return offlineWalks[walkId] || null;
  }, [offlineWalks]);

  const getAllOfflineWalks = useCallback(() => {
    return Object.values(offlineWalks);
  }, [offlineWalks]);

  return { downloadWalk, removeWalk, isDownloaded, getOfflineWalk, getAllOfflineWalks, offlineWalks };
}