import React, { useState, useEffect } from 'react';
import { getCachedAudio } from '@/lib/offlineStorageService';

/**
 * AudioPlayer — the single component that renders an HTML <audio> element.
 *
 * If the narration clip has been pre-downloaded for offline use, it plays from the
 * cached blob so the spoken audio works with no connection. Otherwise it streams
 * the remote URL as before.
 *
 * When migrating to native, replace this component with a native media view
 * (e.g. Capacitor Audio plugin's audio element). All audio rendering in the app
 * should go through this component rather than using <audio> directly.
 */
export default function AudioPlayer({ src, className }) {
  const [playableSrc, setPlayableSrc] = useState(null);

  useEffect(() => {
    if (!src) { setPlayableSrc(null); return; }
    let objectUrl = null;
    let cancelled = false;

    getCachedAudio(src).then(blob => {
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setPlayableSrc(objectUrl);
      } else {
        setPlayableSrc(src);
      }
    }).catch(() => {
      if (!cancelled) setPlayableSrc(src);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!playableSrc) return null;
  return <audio controls src={playableSrc} className={className} />;
}