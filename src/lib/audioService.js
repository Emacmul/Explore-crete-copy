/**
 * Audio Service — abstracts programmatic audio playback.
 *
 * Currently uses the HTML5 Audio API. When migrating to native, swap this module
 * for a native media plugin wrapper (e.g. Capacitor Audio plugin) — all consumers
 * import from here.
 *
 * If a narration clip has been pre-downloaded for offline use, playback reads from
 * the cached blob instead of streaming, so the geofence-triggered spoken narration
 * works with no connection.
 *
 * For declarative <audio controls> rendering, use the AudioPlayer component
 * (src/components/ui/AudioPlayer.jsx), which is the single place that renders
 * an HTML <audio> element.
 */
import { getCachedAudio } from './offlineStorageService';

export function isSupported() {
  return typeof Audio !== 'undefined';
}

/**
 * Create a programmatic audio player for the given source URL.
 * Used by the DrivingTourPlayer for geofence-triggered narration.
 *
 * @param {string} src — audio URL
 * @returns {object} player with play/pause/stop/seek/etc.
 */
export function createPlayer(src) {
  const audio = new Audio();
  audio.preload = 'metadata';

  let objectUrl = null;
  let srcResolved = false;
  let currentSrc = src;

  // Resolve the source lazily on first play: prefer a cached blob (offline-ready),
  // fall back to the remote URL. Deferred so a player can be constructed before its
  // audio has been downloaded without blocking, and so setSrc() can swap sources.
  const ensureSrc = async () => {
    if (srcResolved) return;
    srcResolved = true;
    try {
      const cached = await getCachedAudio(currentSrc);
      if (cached) {
        objectUrl = URL.createObjectURL(cached);
        audio.src = objectUrl;
        return;
      }
    } catch { /* fall through to remote */ }
    audio.src = currentSrc;
  };

  return {
    play: async () => { await ensureSrc(); return audio.play(); },
    pause: () => audio.pause(),
    stop: () => { audio.pause(); audio.currentTime = 0; },
    setSrc: (newSrc) => {
      srcResolved = false;
      currentSrc = newSrc;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      audio.removeAttribute('src');
      audio.load();
    },
    setVolume: (vol) => { audio.volume = vol; },
    seek: (time) => { audio.currentTime = time; },
    onEnded: (cb) => audio.addEventListener('ended', cb),
    onTimeUpdate: (cb) => audio.addEventListener('timeupdate', cb),
    onLoaded: (cb) => audio.addEventListener('loadedmetadata', cb),
    getDuration: () => audio.duration || 0,
    getCurrentTime: () => audio.currentTime || 0,
    getElement: () => audio,
    destroy: () => {
      audio.pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      audio.removeAttribute('src');
      audio.load();
    },
  };
}