

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { text, gender, language_code, apiKey } = body;

    if (!text || !text.trim()) {
      return Response.json({ error: 'Missing script text' }, { status: 400 });
    }

    // Each narrator uses their own Google TTS key (set on their own account) rather than one
    // key shared across everyone — keeps quota and any overage cost personal to them.
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: 'No Google TTS API key found for your account. Add your own key under "API Keys" in the Admin Panel header.' }, { status: 400 });
    }

    // Ensure SSML is wrapped in <speak> tags
    let ssml = text.trim();
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