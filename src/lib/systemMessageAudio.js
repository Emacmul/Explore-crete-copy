import { base44 } from '@/api/base44Client';

// Generates real PCV (Professional Cloned Voice) audio for one of a driving tour's
// system voice messages (off-route / no-GPS / weak-GPS / driving-too-fast alerts), in
// the narrator's own ElevenLabs voice, in whatever language the CURRENT box text is in.
//
// Deliberately generate-and-return-URL only — this does NOT save anything to the Walk
// itself. The caller (SystemMessagesPanel) sets both the text and the returned URL into
// the WalkEditor form via set(), so they only ever get persisted together on the next
// "Save Route", the same way every other translated field already works. This avoids a
// stored audio URL ever going out of sync with unsaved text sitting in the box above it.
//
// Throws a plain Error with a human-readable message on any failure (no ElevenLabs key
// saved yet, no voice ID saved yet, ElevenLabs itself erroring, etc.) — the caller
// decides how to surface that.
export async function generateSystemMessageAudio({ text, apiKeys, authPayload }) {
  const response = await base44.functions.invoke('generateSystemMessageAudio', {
    text,
    voiceId: apiKeys?.elevenlabs_voice_id,
    apiKey: apiKeys?.elevenlabs_api_key,
    ...authPayload,
  });
  if (response?.data?.error) throw new Error(response.data.error);
  const url = response?.data?.url;
  if (!url) throw new Error('Audio generation returned no file.');
  return url;
}
