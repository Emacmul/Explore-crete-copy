/**
 * Builds the final "combined" narration audio by stitching together the already-
 * generated per-segment TTS clips with EXACT silence for every pause — entirely in
 * the browser, via the Web Audio API. No network round trip to a TTS engine is
 * involved in producing the pauses at all.
 *
 * WHY THIS EXISTS: the combined audio used to come from a single Google Cloud TTS
 * request containing the whole script, pauses written in as SSML `<break
 * time="Xs"/>` tags. Google's SSML break timing is documented as an approximation —
 * in practice it was consistently rendering every pause LONGER than requested, and
 * the gap grew the longer the requested pause was (0.2s/0.5s pauses coming out
 * noticeably long, worse for bigger values) — exactly what Enda reported from live
 * testing. That's a property of the TTS engine's own silence rendering, not
 * something fixable by adjusting the request.
 *
 * Individual segment clips (from "Parse & Generate") were never affected by the SSML
 * break bug — each one is sent to Google as plain spoken text with no break tags in
 * it at all. But stitching independently-synthesized clips together exposed a SECOND,
 * separate source of extra silence: Google's TTS naturally leaves a short pause of
 * its own at the very start and end of EVERY synthesized clip (audible as a beat of
 * silence before/after the speech in each segment's own preview) — normal for a
 * standalone utterance, but on top of our own inserted pause when two clips are
 * stitched with a gap between them, not instead of it. A requested 0.5s pause
 * measuring out at 1.4s (each clip contributing roughly another ~0.4-0.5s of its own
 * boundary silence) is exactly that stacking, not a second copy of the original bug.
 * findSoundBounds() below trims each clip down to where the actual speech starts and
 * ends before scheduling it, so the only silence between two clips is the pause we
 * asked for — nothing contributed by the clips themselves.
 */

// How quiet counts as "silence" when trimming a clip's own boundary padding, and how
// much of a natural lead-in/tail to leave in place either side of detected speech so
// a soft consonant at the very start of a word isn't clipped.
const SILENCE_THRESHOLD_DB = -50;
const SILENCE_PAD_SECONDS = 0.015;

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

// Google's synthesized speech comes back mono at a modest sample rate. Rendering the
// final file at that same rate (via OfflineAudioContext, which resamples automatically
// as needed) — rather than the browser's own 44.1/48kHz default — keeps file size sane
// for narrators on mobile data and for hikers pre-downloading tours for offline use,
// with no audible loss for spoken narration.
const FALLBACK_SAMPLE_RATE = 24000;

export async function combineSegmentsToWav(segments, segmentAudioUrls) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineAudioContextClass) {
    throw new Error('This browser does not support the audio processing needed to build the combined file.');
  }

  const probeCtx = new AudioContextClass();
  try {
    // Decode every text segment's real, already-synthesized speech up front. This
    // step is untouched by the bug being fixed here — only pause timing was ever
    // wrong, never the spoken audio itself.
    const decoded = {};
    for (const seg of segments) {
      if (seg.type !== 'text') continue;
      const url = segmentAudioUrls[seg.id];
      if (!url) {
        throw new Error(`Segment ${seg.id} has no generated audio yet — click "Parse & Generate" again first.`);
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch segment ${seg.id}'s audio (HTTP ${res.status}).`);
      const arrayBuffer = await res.arrayBuffer();
      decoded[seg.id] = await probeCtx.decodeAudioData(arrayBuffer);
    }

    const decodedBuffers = Object.values(decoded);
    if (decodedBuffers.length === 0) {
      throw new Error('No generated segment audio to combine yet.');
    }
    const channelCount = Math.max(1, ...decodedBuffers.map((b) => b.numberOfChannels));
    const sampleRate = decodedBuffers[0]?.sampleRate || FALLBACK_SAMPLE_RATE;

    // Trim each clip's own leading/trailing silence ONCE up front (start/end sample
    // indices, in the clip's own native sample count — not yet converted to seconds)
    // so both the total-length calculation below and the actual scheduling use the
    // same trimmed bounds and can't disagree with each other.
    const bounds = {};
    for (const [id, buf] of Object.entries(decoded)) {
      bounds[id] = findSoundBounds(buf);
    }

    let totalSeconds = 0;
    for (const seg of segments) {
      if (seg.type === 'text') {
        const buf = decoded[seg.id];
        const b = bounds[seg.id];
        totalSeconds += buf && b ? (b.end - b.start) / buf.sampleRate : 0;
      } else {
        totalSeconds += seg.duration || 0;
      }
    }
    if (totalSeconds <= 0) {
      throw new Error('Nothing to combine — the script has no generated audio.');
    }

    const offlineCtx = new OfflineAudioContextClass(
      channelCount,
      Math.ceil(totalSeconds * sampleRate) + 1,
      sampleRate
    );

    // Schedule each spoken clip — trimmed down to just its actual speech, see
    // findSoundBounds() above — to start at an exact cumulative time offset. A pause
    // is simply the gap between one clip's scheduled start and the next — nothing is
    // scheduled inside it, so it's silence by construction, not a duration handed to
    // the TTS engine (or left over from the TTS engine's own clip boundary padding)
    // to approximate. start()'s offset/duration are floating-point seconds, so
    // there's no per-segment sample rounding for drift to accumulate from across a
    // long script.
    let cursor = 0;
    for (const seg of segments) {
      if (seg.type === 'text') {
        const buf = decoded[seg.id];
        const b = bounds[seg.id];
        if (!buf || !b) continue;
        const offsetSeconds = b.start / buf.sampleRate;
        const durationSeconds = (b.end - b.start) / buf.sampleRate;
        if (durationSeconds <= 0) continue;
        const source = offlineCtx.createBufferSource();
        source.buffer = buf;
        source.connect(offlineCtx.destination);
        source.start(cursor, offsetSeconds, durationSeconds);
        cursor += durationSeconds;
      } else if (seg.type === 'pause') {
        cursor += seg.duration || 0;
      }
    }

    const rendered = await offlineCtx.startRendering();
    return audioBufferToWavBlob(rendered);
  } finally {
    probeCtx.close();
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
