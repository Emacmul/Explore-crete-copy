/**
 * Tour Log Service — in-memory audit log for driving tour test sessions.
 *
 * Records GPS fixes, trigger evaluations, audio play/skip events, and warnings
 * with precise timestamps. Designed for real-world test drives where you need
 * to diagnose "why didn't trigger B fire?" after the fact.
 *
 * The log lives in memory for the session — no persistence needed.
 * Export to text/CSV via exportLog().
 */

let entries = [];
let subscribers = [];
let sessionInfo = null;

function notify() {
  const snapshot = [...entries];
  subscribers.forEach((cb) => cb(snapshot));
}

function addEntry(type, data) {
  const entry = {
    id: entries.length,
    timestamp: Date.now(),
    elapsed: sessionInfo ? Date.now() - sessionInfo.startTime : 0,
    type,
    data,
  };
  entries.push(entry);
  notify();
  return entry;
}

export function startSession(walkId, walkName) {
  entries = [];
  sessionInfo = {
    walkId,
    walkName,
    startTime: Date.now(),
  };
  addEntry('session_start', { walkId, walkName });
}

export function stopSession() {
  if (!sessionInfo) return;
  addEntry('session_stop', {
    duration: Date.now() - sessionInfo.startTime,
    totalEntries: entries.length,
  });
}

export function clearLog() {
  entries = [];
  sessionInfo = null;
  notify();
}

export function getSessionInfo() {
  return sessionInfo;
}

export function getEntries() {
  return [...entries];
}

// --- Specific log helpers ---

export function logGpsFix(lat, lng, accuracy) {
  addEntry('gps_fix', { lat, lng, accuracy });
}

export function logTriggerCheck(waypoint, distance, withinRadius, bearingInfo, alreadyTriggered, result) {
  addEntry('trigger_check', {
    waypointId: waypoint.segment_id || waypoint.name || 'unnamed',
    waypointRole: waypoint.waypoint_role,
    distance: Math.round(distance),
    triggerRadius: waypoint.trigger_radius_m,
    withinRadius,
    useBearing: waypoint.use_bearing,
    bearingInfo, // { movement, target, tolerance, ok } or null
    alreadyTriggered,
    hasAudio: !!waypoint.audio_clip_url,
    result, // 'fire' | 'skip_distance' | 'skip_bearing' | 'skip_already_triggered' | 'skip_no_audio'
  });
}

export function logAudioPlay(waypoint, audioUrl) {
  addEntry('audio_play', {
    waypointId: waypoint.segment_id || waypoint.name || 'unnamed',
    audioUrl,
  });
}

export function logAudioSkip(waypoint, reason) {
  addEntry('audio_skip', {
    waypointId: waypoint.segment_id || waypoint.name || 'unnamed',
    reason,
  });
}

export function logWarning(message) {
  addEntry('warning', { message });
}

// --- Subscription ---

export function subscribe(callback) {
  subscribers.push(callback);
  callback([...entries]);
  return () => {
    subscribers = subscribers.filter((cb) => cb !== callback);
  };
}

// --- Export ---

function fmtElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function entryToText(entry) {
  const t = fmtElapsed(entry.elapsed);
  switch (entry.type) {
    case 'session_start':
      return `[${t}] SESSION START — "${entry.data.walkName}"`;
    case 'session_stop':
      return `[${t}] SESSION STOP — ${fmtElapsed(entry.data.duration)} total`;
    case 'gps_fix':
      return `[${t}] GPS — ${entry.data.lat.toFixed(5)}, ${entry.data.lng.toFixed(5)} (±${Math.round(entry.data.accuracy || 0)}m)`;
    case 'trigger_check': {
      const d = entry.data;
      const parts = [`WP "${d.waypointId}"`];

      if (d.result === 'fire') {
        parts.push(`✓ TRIGGERED (dist=${d.distance}m/${d.triggerRadius}m)`);
      } else if (d.result === 'skip_distance') {
        parts.push(`✗ FAILED — outside radius: ${d.distance}m > ${d.triggerRadius}m`);
      } else if (d.result === 'skip_bearing') {
        const b = d.bearingInfo || {};
        parts.push(`✗ FAILED — wrong bearing: moving ${Math.round(b.movement || 0)}°, required ${b.target || 0}°±${b.tolerance || 0}°`);
      } else if (d.result === 'skip_already_triggered') {
        parts.push(`✗ SKIPPED — already triggered (trigger_once=true)`);
      } else if (d.result === 'skip_no_audio') {
        parts.push(`✗ FAILED — no audio_clip_url set on this waypoint`);
      }

      if (d.useBearing && d.bearingInfo) {
        parts.push(`[bearing check: moving ${Math.round(d.bearingInfo.movement)}° vs ${d.bearingInfo.target}°±${d.bearingInfo.tolerance}° → ${d.bearingInfo.ok ? 'PASS' : 'FAIL'}]`);
      }

      return `[${t}] TRIGGER — ${parts.join(' | ')}`;
    }
    case 'audio_play':
      return `[${t}] ✓ AUDIO PLAYED — "${entry.data.waypointId}"`;
    case 'audio_skip':
      return `[${t}] ✗ AUDIO SKIPPED — "${entry.data.waypointId}" (${entry.data.reason})`;
    case 'warning':
      return `[${t}] ⚠ ${entry.data.message}`;
    default:
      return `[${t}] ${entry.type}`;
  }
}

export function exportLog() {
  if (!sessionInfo && entries.length === 0) return '';
  const lines = entries.map(entryToText);
  const header = [
    `Tour: ${sessionInfo?.walkName || 'Unknown'}`,
    `Date: ${new Date(sessionInfo?.startTime || Date.now()).toLocaleString()}`,
    `Entries: ${entries.length}`,
    '',
  ];
  return [...header, ...lines].join('\n');
}

export function downloadLog() {
  const text = exportLog();
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tour-log-${sessionInfo?.walkName?.replace(/\s+/g, '-') || 'session'}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}