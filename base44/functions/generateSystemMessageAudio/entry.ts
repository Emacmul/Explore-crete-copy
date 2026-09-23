import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// Per Enda's report: the tour's spoken system messages (off-route, GPS trouble, driving
// too fast) used the phone's own built-in "read this aloud" voice — robotic, and always
// in English regardless of the tour's language. He wants these generated instead in the
// assigned narrator's own PCV (Professional Cloned Voice) — the same ElevenLabs-cloned
// voice used for their real recorded narration elsewhere, just reached automatically
// here via ElevenLabs' API rather than a manual recording + upload.
//
// Deliberately mirrors generateTts/entry.ts's shape as closely as possible (same actor
// check, same "your own key" error wording, same base64-free binary upload pattern) —
// text in, a ready-to-play MP3 URL out, no side effects on any Walk record. Saving the
// returned URL onto the Walk is left to the caller (WalkEditor.jsx), exactly like
// generateTts's own draft audio URL is — never saved here directly, so a narrator's
// still-unsaved text edit can never end up paired with an already-saved audio URL that
// doesn't match it.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { text, voiceId, apiKey } = body;

    // Admin, or narrator via email+narrToken — without this, this function was reachable
    // by anyone at all, with no restriction on who could trigger an ElevenLabs call (and
    // spend someone else's ElevenLabs credits).
    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!text || !text.trim()) {
      return Response.json({ error: 'Missing message text' }, { status: 400 });
    }

    // Each narrator uses their own ElevenLabs account/voice — Enda has permissioned
    // access to every narrator's account, but the key and voice ID are still stored and
    // used per-account here, same as every other key on this app.
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: 'No ElevenLabs API key found for your account. Add your own key under "API Keys" in the header.' }, { status: 400 });
    }
    if (!voiceId || !voiceId.trim()) {
      return Response.json({ error: 'No ElevenLabs voice ID found for your account. Add it under "API Keys" in the header.' }, { status: 400 });
    }

    // eleven_multilingual_v2 — ElevenLabs' own multilingual model, picked so the SAME
    // narrator voice can speak this text correctly whichever tour language it's already
    // been translated into, without needing a separate model/voice per language.
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId.trim())}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey.trim(),
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_multilingual_v2',
        }),
      }
    );

    if (!ttsResponse.ok) {
      const errData = await ttsResponse.json().catch(() => ({}));
      const message = (typeof errData?.detail === 'string' ? errData.detail : errData?.detail?.message)
        || `ElevenLabs API returned ${ttsResponse.status}`;
      return Response.json({ error: message }, { status: 500 });
    }

    // Unlike Google TTS (generateTts), ElevenLabs returns the audio as raw binary
    // straight in the response body — no base64 decode step needed.
    const arrayBuffer = await ttsResponse.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length === 0) {
      return Response.json({ error: 'ElevenLabs returned no audio' }, { status: 500 });
    }

    const file = new File([bytes], `pcv_system_${Date.now()}.mp3`, { type: 'audio/mpeg' });
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    return Response.json({ url: uploadResult.file_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
