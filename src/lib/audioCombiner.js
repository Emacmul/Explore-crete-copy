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
 * Individual segment clips (from "Parse & Generate") were never affected by this —
 * each one is sent to Google as plain spoken text with no break tags in it at all.
 * So the fix doesn't need to touch speech synthesis at all: it only needs to stop
 * asking Google to render the pauses, and build them itself instead. Digital silence
 * has no timing to get wrong — a gap of N samples at the render's sample rate IS N
 * samples long, exactly, by construction.
 */

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

    let totalSeconds = 0;
    for (const seg of segments) {
      totalSeconds += seg.type === 'text' ? (decoded[seg.id]?.duration || 0) : (seg.duration || 0);
    }
    if (totalSeconds <= 0) {
      throw new Error('Nothing to combine — the script has no generated audio.');
    }

    const offlineCtx = new OfflineAudioContextClass(
      channelCount,
      Math.ceil(totalSeconds * sampleRate) + 1,
      sampleRate
    );

    // Schedule each spoken clip to start at an exact cumulative time offset. A pause
    // is simply the gap between one clip's scheduled start and the next — nothing is
    // scheduled inside it, so it's silence by construction, not a duration handed to
    // the TTS engine to approximate. start()'s offset is a floating-point number of
    // seconds, so there's no per-segment sample rounding for drift to accumulate from
    // across a long script, unlike the old SSML-break approach.
    let cursor = 0;
    for (const seg of segments) {
      if (seg.type === 'text') {
        const buf = decoded[seg.id];
        if (!buf) continue;
        const source = offlineCtx.createBufferSource();
        source.buffer = buf;
        source.connect(offlineCtx.destination);
        source.start(cursor);
        cursor += buf.duration;
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
