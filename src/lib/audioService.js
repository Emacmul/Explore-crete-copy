/**
 * Audio Service — abstracts programmatic audio playback.
 *
 * Currently uses the HTML5 Audio API.
 * In a native build, swap this module for a native media plugin wrapper
 * (e.g. Capacitor Audio plugin) — all consumers import from here.
 *
 * For declarative <audio controls> rendering, use the AudioPlayer component
 * (src/components/ui/AudioPlayer.jsx), which is the single place that renders
 * an HTML <audio> element.
 */

export function isSupported() {
  return typeof Audio !== 'undefined';
}

/**
 * Create a programmatic audio player for the given source URL.
 * Used by the future DrivingTourPlayer for geofence-triggered narration.
 *
 * @param {string} src — audio URL
 * @returns {object} player with play/pause/stop/seek/etc.
 */
export function createPlayer(src) {
  const audio = new Audio(src);
  audio.preload = 'metadata';

  return {
    play: () => audio.play(),
    pause: () => audio.pause(),
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
    },
    setSrc: (newSrc) => {
      audio.src = newSrc;
    },
    setVolume: (vol) => {
      audio.volume = vol;
    },
    seek: (time) => {
      audio.currentTime = time;
    },
    onEnded: (cb) => audio.addEventListener('ended', cb),
    onTimeUpdate: (cb) => audio.addEventListener('timeupdate', cb),
    onLoaded: (cb) => audio.addEventListener('loadedmetadata', cb),
    getDuration: () => audio.duration || 0,
    getCurrentTime: () => audio.currentTime || 0,
    getElement: () => audio,
    destroy: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}