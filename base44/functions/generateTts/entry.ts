

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { resolveActor } from '../../shared/backendActor.ts';

// SSML is XML — a literal "&", "<", or ">" in ordinary narration text (e.g. "Fish &
// Chips", or any stray "<"/">") is completely normal writing but invalid unescaped
// inside XML/SSML. This is exactly the "Combined audio failed: Invalid SSML" error:
// the real narration text was never escaped before being wrapped in <speak>...</speak>,
// so any of those characters anywhere in the script broke the whole request — and
// per Google's own error text, newer voices (Neural2 etc.) enforce this strictly where
// older ones may have been more forgiving, which is why it surfaced now.
//
// Can't just escape the whole string, though — the real <break time="Xs"/> tags in the
// script are genuine SSML markup that must stay untouched, or they'd become literal text
// (either read aloud as "break time" or silently dropped, either way losing every pause).
// Splitting on that exact tag pattern and escaping only the text between the tags keeps
// both things true at once.
function escapeSsmlText(text: string): string {
  const breakTagRegex = /<break\s+time="[\d.]+s"\s*\/>/gi;
  const tags = text.match(breakTagRegex) || [];
  const parts = text.split(breakTagRegex);
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    result += parts[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (i < tags.length) result += tags[i];
  }
  return result;
}


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { text, gender, language_code, apiKey } = body;

    // Admin, or narrator via email+narrToken — without this, this function was reachable
    // by anyone at all, with no restriction on who could trigger a Google TTS call.
    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!text || !text.trim()) {
      return Response.json({ error: 'Missing script text' }, { status: 400 });
    }

    // Each narrator uses their own Google TTS key (set on their own account) rather than one
    // key shared across everyone — keeps quota and any overage cost personal to them.
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: 'No Google TTS API key found for your account. Add your own key under "API Keys" in the Admin Panel header.' }, { status: 400 });
    }

    // Ensure SSML is wrapped in <speak> tags
    let ssml = escapeSsmlText(text.trim());
    if (!ssml.startsWith('<speak>')) {
      ssml = `<speak>${ssml}</speak>`;
    }

    // Build voice config — Google picks a voice matching the language + gender
    const voice = { languageCode: language_code || 'en-US' };
    if (gender && gender !== 'NEUTRAL') {
      voice.ssmlGender = gender;
    }

    // Call Google Cloud Text-to-Speech
    const ttsResponse = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { ssml },
          voice,
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
        }),
      }
    );

    if (!ttsResponse.ok) {
      const errData = await ttsResponse.json().catch(() => ({}));
      return Response.json({
        error: errData.error?.message || `Google TTS API returned ${ttsResponse.status}`
      }, { status: 500 });
    }

    const ttsData = await ttsResponse.json();
    const audioContent = ttsData.audioContent;

    if (!audioContent) {
      return Response.json({ error: 'No audio content returned from Google TTS' }, { status: 500 });
    }

    // Decode base64 to binary MP3
    const binaryString = atob(audioContent);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to Base44 file storage
    const file = new File([bytes], `tts_${Date.now()}.mp3`, { type: 'audio/mpeg' });
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    return Response.json({ url: uploadResult.file_url });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});