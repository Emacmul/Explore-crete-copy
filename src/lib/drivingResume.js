// "Resume narration" storage (Enda, 2026-09-23). Customers use the same phone as
// their camera: they stop safely, open the camera app, take photos, and come back —
// and meanwhile the browser may have paused the clip, reloaded the page, or discarded
// the tab entirely. While narration is playing, DrivingTourPlayer keeps a small
// snapshot on this device: which tour, which stop's clip, and the playback position
// (the stops that already played are stored separately by the player itself, see
// playedStorageKey in DrivingTourPlayer.jsx). On return, that snapshot is what the
// "Resume narration" card restores from.
//
// Deliberately separate from a deliberate "Stop tour": only the player's Stop clears
// this (plus a clip that finishes normally). Any other interruption — camera,
// background, reload, tab discard — leaves it in place.
//
// Stored: the stop's identifying key (NOT its audio URL — the tour is re-read on
// resume, so a clip whose audio was re-uploaded resumes with the current file), the
// playback seconds, and a timestamp. Never any personal data.
//
// Staleness: the same 18-hour rule the player already uses for its "last known
// position" / "stops already played" records — a snapshot older than that is from a
// previous day's drive and is dropped rather than offered for resume.

const RESUME_STALE_MS = 18 * 60 * 60 * 1000;

function storageKey(walkId) {
  return `explore_crete_driving_resume__${walkId}`;
}

export function loadResumeSnapshot(walkId) {
  if (!walkId) return null;
  try {
    const raw = localStorage.getItem(storageKey(walkId));
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || typeof snap.wpKey !== 'string') {
      localStorage.removeItem(storageKey(walkId));
      return null;
    }
    if (Date.now() - (snap.savedAt || 0) > RESUME_STALE_MS) {
      localStorage.removeItem(storageKey(walkId));
      return null;
    }
    return { wpKey: snap.wpKey, timeSec: Number(snap.timeSec) || 0, savedAt: snap.savedAt };
  } catch {
    return null;
  }
}

export function saveResumeSnapshot(walkId, snap) {
  if (!walkId || !snap || typeof snap.wpKey !== 'string') return;
  try {
    localStorage.setItem(storageKey(walkId), JSON.stringify({ ...snap, savedAt: Date.now() }));
  } catch {
    // Storage full or unavailable — resume then only works until the page reloads.
  }
}

// Updates just the playback position of the ALREADY-SAVED snapshot. No-op when
// nothing is saved (i.e. no clip is playing that could be resumed), so the player
// can call this freely from timers and visibility handlers without ever creating
// a snapshot on its own.
export function touchResumeTime(walkId, timeSec) {
  if (!walkId || !Number.isFinite(timeSec) || timeSec < 0) return;
  try {
    const raw = localStorage.getItem(storageKey(walkId));
    if (!raw) return;
    const snap = JSON.parse(raw);
    if (!snap || typeof snap.wpKey !== 'string') return;
    snap.timeSec = timeSec;
    snap.savedAt = Date.now();
    localStorage.setItem(storageKey(walkId), JSON.stringify(snap));
  } catch {
    // Ignore — the last successful save stands.
  }
}

export function clearResumeSnapshot(walkId) {
  if (!walkId) return;
  try {
    localStorage.removeItem(storageKey(walkId));
  } catch {
    // Ignore.
  }
}