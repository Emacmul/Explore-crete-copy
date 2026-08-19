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
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { audioBase64, mimeType, filename } = body;


    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!audioBase64 || !String(audioBase64).trim()) {
      return Response.json({ error: 'Missing audio data' }, { status: 400 });
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

    const file = new File(
      [bytes],
      filename || `narration_${Date.now()}.wav`,
      { type: mimeType || 'audio/wav' }
    );
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    return Response.json({ url: uploadResult.file_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
