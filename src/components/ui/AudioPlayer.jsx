import React from 'react';

/**
 * AudioPlayer — the single component that renders an HTML <audio> element.
 *
 * When migrating to native, replace this component with a native media view
 * (e.g. Capacitor Audio plugin's video/audio element). All audio rendering
 * in the app should go through this component rather than using <audio> directly.
 */
export default function AudioPlayer({ src, className }) {
  if (!src) return null;
  return <audio controls src={src} className={className} />;
}