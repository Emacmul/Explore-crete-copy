/**
 * Builds the "combined" narration audio — and, critically, PREVIEWS it — by stitching
 * together the already-generated per-segment TTS clips with EXACT silence for every
 * pause, entirely in the browser via the Web Audio API. No network round trip to a
 * TTS engine is involved in producing the pauses at all, and the live preview a
 * narrator listens to via "Build & Play" is now built from the EXACT SAME decoded
 * clips and the EXACT SAME schedule math as the file that actually gets saved — see
 * playSegmentsPrecisely() and combineSegmentsToWav() below, which share
 * decodeAndBoundSegments()/buildSchedule() rather than each computing timing their
 * own way. That parity is the fix for the third round of this bug (see below).
 *
 * HISTORY — three rounds of the same underlying complaint ("pauses come out longer
 * than set"), three different real causes:
 *
 * 1. The combined audio used to come from a single Google Cloud TTS request
 *    containing the whole script, pauses written in as SSML `<break time="Xs"/>`
 *    tags. Google's SSML break timing is documented as an approximation, and in
 *    practice rendered every pause longer than requested, worse for longer pauses.
 *    Fixed by building pauses ourselves instead of asking Google to render them.
 *
 * 2. Once pauses were built from real per-segment clips stitched together, a SECOND
 *    source of extra silence showed up: Google leaves a natural beat of silence at
 *    the very start and end of every independently-synthesized clip (normal for a
 *    standalone utterance). Stitching two clips with our own exact gap between them
 *    STACKED our pause on top of both clips' own boundary silence instead of
 *    replacing it. Fixed by findSoundBounds() below, trimming each clip down to its
 *    real speech before scheduling it.
 *
 * 3. Round 2's trimming was only ever applied to the file that gets saved
 *    (combineSegmentsToWav, called AFTER the "Build & Play" preview loop finishes) —
 *    NOT to the actual live preview a narrator listens to and judges pause length
 *    by, which was still playing each raw, untrimmed segment clip via a plain
 *    <audio> element and waiting for it to fully end (including its own boundary
 *    silence) before starting a setTimeout for the pause. So what narrators actually
 *    heard while testing was never fixed by round 2 at all — the saved file may well
 *    have been correct, but there was no way to tell without downloading and
 *    measuring it separately from the app. Fixed by making the preview
 *    (playSegmentsPrecisely) use this exact same decode/trim/schedule pipeline, so
 *    there is only one implementation of "how long is this pause" in the whole
 *    codebase, and what's heard live IS what gets saved, by construction.
 */

// How quiet counts as "silence" when trimming a clip's own boundary padding, and how
// much of a natural lead-in/tail to leave in place either side of detected speech so
// a soft consonant at the very start of a word isn't clipped.
const SILENCE_THRESHOLD_DB = -50;
const SILENCE_PAD_SECONDS = 0.015;

// Google's synthesized speech comes back mono at a modest sample rate. Only used if a
// browser ever hands back a buffer with no sampleRate at all (shouldn't happen).
const FALLBACK_SAMPLE_RATE = 24000;

// Per Enda: a stalled network request here used to hang forever with no error and no
// way to cancel it — plain `fetch()` never times out on its own, so a flaky connection
// (or a segment's audio URL that was slow/unreachable) left "Continue"/"Build & Play"
// stuck mid-click. Every button on the panel gates on the `playing` flag, which this
// hang left permanently true, so the whole panel looked frozen and the only way out
// was a hard refresh — which threw away every unsaved edit on the WHOLE tour, not just
// this one part. Giving every fetch a hard ceiling means this always either finishes or
// fails with a visible, recoverable error instead of hanging indefinitely.
const FETCH_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Timed out waiting for a segment's audio to load (over ${Math.round(timeoutMs / 1000)}s) — check your connection and try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finds where actual sound starts and ends within a decoded clip, scanning inward
 * from both edges in short (~5ms) windows and comparing each window's RMS level
 * against a fixed threshold — well below anything a synthesized voice produces, but
 * safely above the near-zero digital silence Google pads each clip with. A few
 * milliseconds of padding are kept on each side of the detected sound so the trim
 * doesn't clip the natural attack of the first/last word.
 */
function findSoundBounds(buffer, thresholdDb = SILENCE_THRESHOLD_DB) {
  const threshold = Math.pow(10, thresholdDb / 20); // dB -> linear amplitude
  const length = buffer.length;
  const frameSize = Math.max(1, Math.round(buffer.sampleRate * 0.005)); // ~5ms
  const channels = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));

  const frameHasSound = (frameStart) => {
    const frameEnd = Math.min(length, frameStart + frameSize);
    for (const data of channels) {
      let sumSq = 0;
      for (let i = frameStart; i < frameEnd; i++) sumSq += data[i] * data[i];
      if (Math.sqrt(sumSq / (frameEnd - frameStart)) > threshold) return true;
    }
    return false;
  };

  let start = length;
  for (let frameStart = 0; frameStart < length; frameStart += frameSize) {
    if (frameHasSound(frameStart)) { start = frameStart; break; }
  }
  let end = 0;
  for (let frameStart = length - frameSize; frameStart >= 0; frameStart -= frameSize) {
    if (frameHasSound(frameStart)) { end = Math.min(length, frameStart + frameSize); break; }
  }

  // A clip that never crosses the threshold at all (shouldn't happen for real
  // narration) is left completely untouched rather than trimmed to nothing.
  if (start >= end) return { start: 0, end: length };

  const pad = Math.round(buffer.sampleRate * SILENCE_PAD_SECONDS);
  return { start: Math.max(0, start - pad), end: Math.min(length, end + pad) };
}

// Decodes every text segment's clip once (via whichever AudioContext the caller is
// already using) and trims each to its real speech bounds. Shared by both the live
// preview and the final saved file so the two can never drift apart.
//
// Per Enda's follow-up 35 report: a segment's own generated-audio URL can go bad
// between being generated and actually being fetched here — he hit an HTTP 403 on his
// tour's first waypoint (a longer "get ready" script recorded before the tour starts
// moving), reported as "segment 0" simply because that's whichever segment this loop
// happens to reach first, not because segment 0 specifically is special — ANY segment
// can go stale the same way, on any waypoint. onRegenerateAudio (optional — only the
// live callers below actually provide it) lets the caller re-request a fresh URL for
// one segment and gets exactly one retry with it before this gives up for real, so one
// bad URL doesn't hard-fail an entire pass that would otherwise have worked fine.
async function decodeAndBoundSegments(segments, segmentAudioUrls, audioCtx, { onRegenerateAudio } = {}) {
  const decoded = {};
  for (const seg of segments) {
    if (seg.type !== 'text') continue;
    let url = segmentAudioUrls[seg.id];
    if (!url) {
      throw new Error(`Segment ${seg.id} has no generated audio yet — click "Parse & Generate" again first.`);
    }
    let res = await fetchWithTimeout(url);
    if (!res.ok && onRegenerateAudio) {
      const freshUrl = await onRegenerateAudio(seg);
      if (freshUrl) {
        url = freshUrl;
        res = await fetchWithTimeout(url);
      }
    }
    if (!res.ok) throw new Error(`Could not fetch segment ${seg.id}'s audio (HTTP ${res.status}).`);
    const arrayBuffer = await res.arrayBuffer();
    decoded[seg.id] = await audioCtx.decodeAudioData(arrayBuffer);
  }
  if (Object.keys(decoded).length === 0) {
    throw new Error('No generated segment audio to combine yet.');
  }

  const bounds = {};
  for (const [id, buf] of Object.entries(decoded)) {
    bounds[id] = findSoundBounds(buf);
  }

  return { decoded, bounds };
}

// Turns segments + decoded/bounds into a flat, ordered schedule of exact cumulative
// start-time offsets (seconds, from the very beginning of the combined audio) — the
// ONLY place pause timing is ever computed, used identically by both live playback
// and file rendering below, so there is nothing for them to disagree about.
function buildSchedule(segments, decoded, bounds) {
  const items = [];
  let cursor = 0;
  for (const seg of segments) {
    if (seg.type === 'text') {
      const buf = decoded[seg.id];
      const b = bounds[seg.id];
      if (!buf || !b) continue;
      const offsetSeconds = b.start / buf.sampleRate;
      const durationSeconds = (b.end - b.start) / buf.sampleRate;
      if (durationSeconds <= 0) continue;
      items.push({ segId: seg.id, buffer: buf, startSeconds: cursor, offsetSeconds, durationSeconds });
      cursor += durationSeconds;
    } else if (seg.type === 'pause') {
      cursor += seg.duration || 0;
    }
  }
  return { items, totalSeconds: cursor };
}

/**
 * Plays the segments back LIVE, in real time, through the speakers — used by "Build &
 * Play" so what the narrator hears is built from the exact same trimmed clips and
 * exact same pause gaps the saved file will have, not a separate approximation.
 * Returns a controller: `stop()` to cut playback short, `done` resolves when playback
 * finishes on its own, and `decoded`/`bounds` so a follow-up combineSegmentsToWav()
 * call can reuse them instead of re-fetching and re-decoding every clip again.
 */
export async function playSegmentsPrecisely(segments, segmentAudioUrls, { onSegmentChange, onRegenerateAudio } = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('This browser does not support the audio playback needed for an accurate preview.');
  }

  const ctx = new AudioContextClass();
  const { decoded, bounds } = await decodeAndBoundSegments(segments, segmentAudioUrls, ctx, { onRegenerateAudio });
  const { items, totalSeconds } = buildSchedule(segments, decoded, bounds);

  const leadIn = 0.05; // tiny safety margin so the very first source isn't scheduled in the past
  const baseTime = ctx.currentTime + leadIn;
  const sources = [];
  const timers = [];

  for (const item of items) {
    const source = ctx.createBufferSource();
    source.buffer = item.buffer;
    source.connect(ctx.destination);
    source.start(baseTime + item.startSeconds, item.offsetSeconds, item.durationSeconds);
    sources.push(source);
    if (onSegmentChange) {
      const segIndex = segments.findIndex((s) => s.id === item.segId);
      timers.push(setTimeout(() => onSegmentChange(segIndex), Math.max(0, item.startSeconds * 1000)));
    }
  }

  // Per the follow-up 24 audit (round 2's disclosed, then-unfixed finding): `stop()`
  // used to clear every pending timer — including the one below that resolves `done`
  // on natural completion — without ever resolving `done` itself. A caller that awaits
  // `done` (NarrationTtsEditor's handlePlayTarget does, for the ordinary "let it play
  // out" path) had no way to find out a manual Stop had already ended playback: `done`
  // just sat unresolved until that caller's OWN much longer fallback timeout
  // ("Playback got stuck…") eventually fired — a bogus error shown well after the
  // narrator had already deliberately stopped and moved on, with nothing actually
  // stuck at all. Fixed by giving `stop()` and natural completion the SAME resolver,
  // so whichever happens first — the narrator stopping it, or it simply finishing —
  // resolves `done` immediately either way.
  let stopped = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    sources.forEach((s) => { try { s.stop(); } catch { /* already ended */ } });
    timers.forEach(clearTimeout);
    ctx.close().catch(() => {});
    resolveDone();
  };

  const doneTimer = setTimeout(() => {
    if (!stopped) { stopped = true; ctx.close().catch(() => {}); resolveDone(); }
  }, Math.ceil((leadIn + totalSeconds) * 1000) + 50);
  timers.push(doneTimer);

  return { stop, done, decoded, bounds, totalSeconds };
}

/**
 * Renders the segments to a single WAV file for saving. Pass the object returned by
 * playSegmentsPrecisely() as `precomputed` to reuse its already-decoded/trimmed clips
 * (the normal path — preview runs first) so nothing is re-fetched or re-decoded;
 * decodes fresh only if called on its own.
 */
export async function combineSegmentsToWav(segments, segmentAudioUrls, precomputed, { onRegenerateAudio } = {}) {
  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!OfflineAudioContextClass || !AudioContextClass) {
    throw new Error('This browser does not support the audio processing needed to build the combined file.');
  }

  let probeCtx = null;
  try {
    let decoded, bounds;
    if (precomputed?.decoded && precomputed?.bounds) {
      ({ decoded, bounds } = precomputed);
    } else {
      probeCtx = new AudioContextClass();
      ({ decoded, bounds } = await decodeAndBoundSegments(segments, segmentAudioUrls, probeCtx, { onRegenerateAudio }));
    }

    const decodedBuffers = Object.values(decoded);
    const channelCount = Math.max(1, ...decodedBuffers.map((b) => b.numberOfChannels));
    const sampleRate = decodedBuffers[0]?.sampleRate || FALLBACK_SAMPLE_RATE;

    const { items, totalSeconds } = buildSchedule(segments, decoded, bounds);
    if (totalSeconds <= 0) {
      throw new Error('Nothing to combine — the script has no generated audio.');
    }

    const offlineCtx = new OfflineAudioContextClass(
      channelCount,
      Math.ceil(totalSeconds * sampleRate) + 1,
      sampleRate
    );

    for (const item of items) {
      const source = offlineCtx.createBufferSource();
      source.buffer = item.buffer;
      source.connect(offlineCtx.destination);
      source.start(item.startSeconds, item.offsetSeconds, item.durationSeconds);
    }

    const rendered = await offlineCtx.startRendering();
    return audioBufferToWavBlob(rendered);
  } finally {
    if (probeCtx) probeCtx.close();
  }
}

// Plain, dependency-free 16-bit PCM WAV encoder — no external library needed, and WAV
// plays natively in every browser and mobile OS the same as MP3 does via <audio>/Audio().
function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let pos = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channels[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      pos += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read the combined audio file.'));
    reader.readAsDataURL(blob);
  });
}
