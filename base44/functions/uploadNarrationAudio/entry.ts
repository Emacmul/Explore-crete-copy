import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// Accepts an audio file the CLIENT already built (see src/lib/audioCombiner.js) and
// stores it in Base44 file storage, returning its public URL.
//
// WHY THIS EXISTS: the narration editor's "combined audio" used to be produced by
// sending the whole script — spoken text plus every <break time="Xs"/> pause tag —
// to Google Cloud TTS in one SSML request (see generateTts/entry.ts). Google's own
// docs are explicit that <break> timing is an approximation, not a guarantee, and in
// practice it was rendering every pause longer than requested, with the gap growing
// the longer the requested pause was — exactly what Enda reported live. That's not
// fixable by tuning the request; Google's own recommendation for anything that needs
// exact pause timing is to build it from real audio instead of trusting the SSML
// engine's silence. The client now does exactly that: each spoken segment is still a
// real Google TTS clip (unaffected by this bug — those never contained break tags),
// stitched together with EXACT digital silence for every pause, entirely in the
// browser via the Web Audio API. This function's only job is to take that finished
// file and upload it — same auth model as generateTts (admin, or narrator via
// email+narrToken), since it writes to file storage under the service role and must
// never be reachable by an unauthenticated caller.
//
// VALIDATION (2026-09-02, per Enda: "we don't want fumbles to happen"): every real
// caller (see audioCombiner.js) always builds a plain WAV file and always sends
// mimeType 'audio/wav' — so this is now enforced server-side rather than just trusted:
// a hard size ceiling well above any real narration clip, the declared type must
// actually be audio/wav, and the file's own first bytes must genuinely be a WAV file
// (its "RIFF"/"WAVE" header) rather than just trusting the caller's mimeType label.
// This is a mistake-guard for an already-authorized narrator/admin, not a
// stranger-facing risk — resolveActor above is still the real access boundary.
const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50MB — generous for a single waypoint's combined narration clip, nowhere near an accidental huge/wrong file

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { audioBase64, mimeType } = body;

    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!audioBase64 || !String(audioBase64).trim()) {
      return Response.json({ error: 'Missing audio data' }, { status: 400 });
    }

    if (mimeType && String(mimeType).toLowerCase() !== 'audio/wav') {
      return Response.json({ error: `Expected audio/wav, got "${mimeType}".` }, { status: 400 });
    }

    // Base64 inflates size by ~4/3 — reject on the raw string length first so an
    // oversized upload doesn't even get fully decoded into memory.
    if (audioBase64.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3)) {
      return Response.json({ error: `Audio file is too large (max ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB).` }, { status: 400 });
    }

    let bytes;
    try {
      const binaryString = atob(audioBase64);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } catch {
      return Response.json({ error: 'Audio data is not valid base64.' }, { status: 400 });
    }

    if (bytes.length > MAX_AUDIO_BYTES) {
      return Response.json({ error: `Audio file is too large (max ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB).` }, { status: 400 });
    }

    // A real WAV file starts "RIFF....WAVE" — checking this (rather than just trusting
    // the mimeType label above) catches a mislabeled or corrupt upload before it's ever
    // written to storage.
    const asText = (start: number, len: number) =>
      Array.from(bytes.slice(start, start + len)).map((b) => String.fromCharCode(b)).join('');
    if (bytes.length < 12 || asText(0, 4) !== 'RIFF' || asText(8, 4) !== 'WAVE') {
      return Response.json({ error: 'This does not look like a valid WAV audio file.' }, { status: 400 });
    }

    // Filename is generated here, never taken from the caller — there's nothing
    // legitimate a caller needs to control about it, so there's nothing to sanitize.
    const file = new File(
      [bytes],
      `narration_${Date.now()}.wav`,
      { type: 'audio/wav' }
    );
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    return Response.json({ url: uploadResult.file_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
