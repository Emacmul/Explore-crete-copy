/**
 * Audio integrity checks for the "Stay Safe Offline" download.
 *
 * WHY THIS EXISTS (Enda's BOR road tests, 2026-09-21): two long narration clips played for only
 * 3 and 5 seconds on the phone although the files on the server are complete (they play in full
 * in a browser). The phone plays its own STORED COPY of each clip, and the download used to store
 * whatever arrived without ever checking it was whole. A copy that is cut short is then played cut
 * short, and it is discovered on the road, when it is too late to fetch a new one.
 *
 * So every clip is now proven complete at download time, at home:
 *   1. size    - bytes received equal the size the server announced (when it announced one)
 *   2. header  - a WAV file states its own length; the bytes held must cover it
 *   3. readback- the copy is read back out of the phone's storage and checked again
 *   4. testplay- the phone's own audio player loads the stored copy; the length it reports must
 *                match the length the header states (catches a copy that would end early)
 * A clip that fails any check is downloaded again (up to 3 tries). A clip that never passes is
 * reported by name and the tour is NOT marked as saved.
 *
 * Pure helpers with no app dependencies except the storage functions passed in / imported.
 */
import { cacheAudio, getCachedAudio, removeAudioUrl } from './offlineStorageService';

const MAX_ATTEMPTS = 3;
const METADATA_TIMEOUT_MS = 8000;
const HEADER_BYTES = 4096;
// A WAV whose stated length is 0 or 0xFFFFFFFF is a "streaming" file with no real length - the
// header cannot be used to check completeness, so only the other checks apply to it.
const UNKNOWN_SIZES = new Set([0, 0xffffffff]);

/**
 * Reads the WAV header of a Blob.
 * Returns { isWav:false } for anything that is not a RIFF/WAVE file, otherwise
 * { isWav:true, complete, declaredSeconds, bytesPresent, bytesExpected }.
 * `complete` is null when the header carries no usable length.
 */
export async function readWavInfo(blob) {
  if (!blob || blob.size < 12) return { isWav: false };
  const buf = await blob.slice(0, Math.min(blob.size, HEADER_BYTES)).arrayBuffer();
  const view = new DataView(buf);
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { isWav: false };

  let offset = 12;
  let byteRate = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 20 <= view.byteLength) {
      byteRate = view.getUint32(offset + 16, true);
    }
    if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (dataOffset < 0 || !byteRate) return { isWav: true, complete: null, declaredSeconds: null };
  if (UNKNOWN_SIZES.has(dataSize)) return { isWav: true, complete: null, declaredSeconds: null };

  const bytesExpected = dataOffset + dataSize;
  const bytesPresent = blob.size;
  return {
    isWav: true,
    complete: bytesPresent >= bytesExpected,
    declaredSeconds: dataSize / byteRate,
    bytesPresent,
    bytesExpected,
  };
}

/**
 * Loads the blob in the phone's own audio player and returns the length it reports (seconds),
 * or null if the player could not tell within a few seconds (some phones refuse to load audio
 * details until the user taps something - that is "unknown", not "bad").
 */
export function probeDurationSeconds(blob, timeoutMs = METADATA_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined' || typeof URL === 'undefined') { resolve(null); return; }
    let done = false;
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      try { audio.load(); } catch { /* ignore */ }
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      const d = audio.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    });
    audio.addEventListener('error', () => finish(-1)); // the phone cannot read this copy at all
    audio.src = url;
  });
}

/**
 * Full check of one stored/downloaded copy. Returns { ok, reason, declaredSeconds, phoneSeconds }.
 * expectedBytes (optional) is the size the server announced.
 */
export async function verifyClipBlob(blob, { expectedBytes = null } = {}) {
  if (!blob || blob.size === 0) return { ok: false, reason: 'empty copy' };
  if (expectedBytes != null && blob.size !== expectedBytes) {
    return { ok: false, reason: `size ${blob.size} bytes, server said ${expectedBytes}` };
  }
  const wav = await readWavInfo(blob);
  if (wav.isWav && wav.complete === false) {
    return {
      ok: false,
      reason: `cut short: holds ${wav.bytesPresent} of ${wav.bytesExpected} bytes`,
      declaredSeconds: wav.declaredSeconds,
    };
  }
  const phoneSeconds = await probeDurationSeconds(blob);
  if (phoneSeconds === -1) return { ok: false, reason: 'the phone cannot read this copy', declaredSeconds: wav.declaredSeconds };
  if (wav.isWav && wav.declaredSeconds && phoneSeconds != null) {
    const tolerance = Math.max(1, wav.declaredSeconds * 0.03);
    if (Math.abs(phoneSeconds - wav.declaredSeconds) > tolerance) {
      return {
        ok: false,
        reason: `phone reports ${phoneSeconds.toFixed(1)}s, file says ${wav.declaredSeconds.toFixed(1)}s`,
        declaredSeconds: wav.declaredSeconds,
        phoneSeconds,
      };
    }
  }
  return { ok: true, declaredSeconds: wav.declaredSeconds ?? null, phoneSeconds };
}

async function fetchWhole(url) {
  // cache:'no-store' so a half-filled entry in the browser's own cache can never be handed back.
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`server answered ${res.status}`);
  const announced = Number(res.headers.get('content-length'));
  const encoded = res.headers.get('content-encoding');
  const blob = await res.blob();
  // A compressed transfer reports the compressed size, so it cannot be compared with the blob.
  const expectedBytes = Number.isFinite(announced) && announced > 0 && !encoded ? announced : null;
  return { blob, expectedBytes };
}

/**
 * Makes sure a verified, complete copy of `url` is in storage.
 * An existing stored copy is re-checked too - a cut copy from an earlier download must be
 * replaced, not trusted. Returns { ok, reason?, attempts, redownloaded }.
 */
export async function ensureVerifiedClip(url) {
  let redownloaded = false;
  try {
    const existing = await getCachedAudio(url);
    if (existing) {
      const check = await verifyClipBlob(existing);
      if (check.ok) return { ok: true, attempts: 0, redownloaded: false };
      await removeAudioUrl(url); // bad stored copy: throw it away and fetch a fresh one
      redownloaded = true;
    }
  } catch { /* fall through to a fresh download */ }

  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { blob, expectedBytes } = await fetchWhole(url);
      const first = await verifyClipBlob(blob, { expectedBytes });
      if (!first.ok) { lastReason = first.reason; continue; }
      await cacheAudio(url, blob);
      // Read it back out of the phone's storage: the copy that will be PLAYED is this one.
      const stored = await getCachedAudio(url);
      const second = await verifyClipBlob(stored, { expectedBytes: blob.size });
      if (!second.ok) { await removeAudioUrl(url); lastReason = `stored copy: ${second.reason}`; continue; }
      return { ok: true, attempts: attempt, redownloaded: redownloaded || attempt > 1 };
    } catch (err) {
      lastReason = err?.message || 'download failed';
    }
  }
  await removeAudioUrl(url).catch(() => {});
  return { ok: false, reason: lastReason, attempts: MAX_ATTEMPTS, redownloaded };
}
