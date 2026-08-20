/**
 * Builds a single "<tour>-backup.zip" containing every narration script (.docx) and
 * every audio clip the app currently holds for a tour — one folder for waypoints
 * (the actual clips a real customer's phone plays, per DrivingTourWaypointEditor /
 * AudioTriggerFields) and one for segments (the combined/final/finished scripts and
 * audio from Segment Script Manager / Segment Script Editor — authoring & QA
 * artifacts, never played live, but still worth keeping a copy of).
 *
 * This is deliberately just a bundle of what already exists — no merging into one
 * script or one audio file. Per Enda: since the PCV (Professional Cloned Voice)
 * production can be asked to produce audio per waypoint, and the live app already
 * plays per-waypoint clips, there's no production need to combine everything into
 * a single file; this is purely a "grab everything in one click, in case I need it
 * later" backup.
 */

import { createZip, buildScriptDocxBlob } from './docxExporter';

async function scriptToDocxBytes(script) {
  const blob = buildScriptDocxBlob(script);
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

async function fetchAsUint8Array(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// Combined audio built by this app's own exact-silence pipeline (see
// audioCombiner.js) is a .wav file; older recordings, and anything uploaded from
// PCV production, are typically .mp3 — keeping whatever extension the URL actually
// has (rather than assuming one) means the backup's filenames always match what's
// really inside them.
function extOf(url, fallback = 'mp3') {
  const m = String(url || '').match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  return m ? m[1] : fallback;
}

function safeName(s, fallback) {
  return String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || fallback;
}

// Guards against two waypoints/segments landing on an identical filename inside the
// zip (shouldn't normally happen given the app's naming convention, but a collision
// would otherwise silently overwrite one entry with another).
function uniqueName(base, used) {
  if (!used.has(base)) { used.add(base); return base; }
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  const name = `${base}-${i}`;
  used.add(name);
  return name;
}

/**
 * @param {object} walk  The full Walk record (needs .waypoints and .segment_scripts).
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{ blob: Blob, includedCount: number, skipped: string[] }>}
 *   `skipped` lists anything that couldn't be fetched (e.g. a stale/broken URL) —
 *   the rest of the backup still completes rather than failing the whole zip over
 *   one bad file.
 */
export async function buildTourBackupZip(walk, onProgress) {
  const waypoints = walk?.waypoints || [];
  const segments = walk?.segment_scripts || [];
  const total = waypoints.length + segments.length;
  let done = 0;
  const report = () => { done++; if (onProgress) onProgress(done, total); };

  const files = [];
  const skipped = [];
  const usedNames = new Set();

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const label = uniqueName(safeName(wp.name || wp.segment_id, `waypoint-${i + 1}`), usedNames);

    if (wp.narration_script && wp.narration_script.trim()) {
      try {
        files.push({ name: `waypoints/${label}_script.docx`, content: await scriptToDocxBytes(wp.narration_script) });
      } catch (err) {
        skipped.push(`${label} script: ${err?.message || 'failed to build .docx'}`);
      }
    }
    if (wp.audio_clip_url) {
      try {
        files.push({ name: `waypoints/${label}_audio.${extOf(wp.audio_clip_url)}`, content: await fetchAsUint8Array(wp.audio_clip_url) });
      } catch (err) {
        skipped.push(`${label} audio: ${err?.message || 'failed to fetch'}`);
      }
    }
    report();
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const label = uniqueName(safeName(seg.segment_id || seg.segment_number, `segment-${i + 1}`), usedNames);
    const script = seg.final_script || seg.combined_script;

    if (script && script.trim()) {
      try {
        files.push({ name: `segments/${label}_script.docx`, content: await scriptToDocxBytes(script) });
      } catch (err) {
        skipped.push(`${label} script: ${err?.message || 'failed to build .docx'}`);
      }
    }

    // Prefer the PCV "finished" production audio if it's been uploaded; otherwise
    // fall back to whatever draft exists — labelling which tier it is in the
    // filename so it's never mistaken for the finished version later.
    const audioUrl = seg.finished_audio_url || seg.final_audio_url || seg.combined_audio_url;
    const tier = seg.finished_audio_url ? 'finished' : seg.final_audio_url ? 'draft-final' : 'draft-combined';
    if (audioUrl) {
      try {
        files.push({ name: `segments/${label}_audio-${tier}.${extOf(audioUrl)}`, content: await fetchAsUint8Array(audioUrl) });
      } catch (err) {
        skipped.push(`${label} audio: ${err?.message || 'failed to fetch'}`);
      }
    }
    report();
  }

  if (files.length === 0) {
    throw new Error('Nothing to back up yet — no waypoint or segment scripts/audio found on this tour.');
  }

  const blob = createZip(files, 'application/zip');
  return { blob, includedCount: files.length, skipped };
}
