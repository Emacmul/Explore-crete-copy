import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
// Per Enda / Base44 support: retries a real 429 (pooled rate limit) with a short backoff —
// see withEntityRetry.ts's own header comment for the full reasoning.
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';

// Replaces browser-only localStorage for the Google TTS / Groq API keys with real,
// permanent, server-side storage tied to whoever is actually calling — an admin's real
// Base44 session, or a narrator's own email+token. Fixes the exact fragility that was
// happening: a key that only ever lived in one specific browser, gone the moment that
// browser's site data was cleared, with no way to recover it from anywhere.
//
// Every action here only ever touches the CALLER's own AppUser record — an admin gets
// and saves their own keys, a narrator gets and saves their own, never anyone else's.
//
// FIXED (2026-09-02 audit): this used to identify a narrator by treating their Narr
// Studio session token (a random ID narrLogin.ts makes up itself) as if it were a
// WordPress-issued login token, and asking WordPress to validate it. WordPress has
// never seen that token, so it rejected it every single time, and every real narrator
// got "Not authorized" on both get and save. This was the actual, now-confirmed root
// cause behind the repeated "No Google TTS API key found" reports (see
// CLAUDE_CHANGELOG.md, follow-up 61). Now uses the same resolveActor (email+narrToken
// checked against AppUser.narr_session_token) every other narrator-facing function in
// this app already relies on.
// Key validation (Enda's request, 2026-09-28): a narrator whose saved key is wrong only
// found out much later, deep inside some tool, from an error that never named the cause.
// A save now checks the keys against their real provider first and refuses to store the
// ones the provider rejects — the dialog names exactly which field failed. Only non-empty
// keys that actually CHANGED are checked, so re-saving untouched keys (or the retry path
// after a load error) never makes extra provider calls. A provider that can't be reached
// at all is NOT treated as an invalid key — the save goes through with a warning instead
// of blocking someone's work over a transient network issue.
const validateGroqKey = async (key: string): Promise<'valid' | 'invalid' | 'unverified'> => {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return 'valid';
    if (res.status === 401 || res.status === 403) return 'invalid';
    return 'unverified';
  } catch { return 'unverified'; }
};


const validateGoogleTtsKey = async (key: string): Promise<'valid' | 'invalid' | 'unverified'> => {
  try {
    // One character of the cheapest voice — a validation probe, not real generation.
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: 'a' }, voice: { languageCode: 'en-US' }, audioConfig: { audioEncoding: 'LINEAR16' } }),
    });
    if (res.ok) return 'valid';
    // 400 "API key not valid" = a typo'd/wrong key. 403 = the key exists but the Cloud
    // Text-to-Speech API isn't enabled on its project — it can never work for narration,
    // so it's rejected as invalid too. Anything else (quota, network) = unverified.
    if (res.status === 400 || res.status === 403) return 'invalid';
    return 'unverified';
  } catch { return 'unverified'; }
};

export default async function(req) {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    const { action, google_tts_api_key, groq_api_key, groq_api_key_2, elevenlabs_api_key, elevenlabs_voice_id } = body || {};

    if (action !== 'get' && action !== 'save') {
      return Response.json({ error: 'action must be "get" or "save"' }, { status: 400 });
    }

    let email = null;
    try {
      const me = await base44.auth.me();
      if (me?.email) email = me.email.toLowerCase();
    } catch { /* no Base44 session — try the narrator/admin-via-Narr path below */ }

    if (!email) {
      const actor = await resolveActor(base44, body);
      if (actor?.kind === 'narrator') {
        email = actor.email;
      } else if (actor?.kind === 'admin' && body?.email) {
        // An admin wearing the Narr hat has no Base44 session; resolveActor already
        // confirmed body.narrToken matches this exact admin-role AppUser row, so
        // body.email is trustworthy here — it's the same row that was just verified.
        email = String(body.email).trim().toLowerCase();
      }
    }

    if (!email) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    const matches = await base44.asServiceRole.entities.AppUser.filter({ email });
    const record = matches[0] || null;

    if (action === 'get') {
      return Response.json({
        google_tts_api_key: record?.google_tts_api_key || '',
        groq_api_key: record?.groq_api_key || '',
        // Optional backup Groq key from a SEPARATE Groq account — see
        // base44/shared/groqKeyRotation.ts. Never required; blank means "no backup set".
        groq_api_key_2: record?.groq_api_key_2 || '',
        // Per Enda's follow-up request: system voice messages (off-route/GPS/speed alerts)
        // need to be spoken in this narrator's own PCV (ElevenLabs cloned voice) instead
        // of the phone's robotic built-in voice. Since 2026-09-25 the finished .wav files
        // are imported directly in Narration & Simulate — the generateSystemMessageAudio
        // endpoint and its frontend helper were removed in that cleanup.
        // Each narrator has their own separate ElevenLabs account (Enda has permissioned
        // access to all of them, but each key/voice is still stored per-account here,
        // same as every other key on this record). Optional — blank until a narrator/admin
        // sets it up.
        elevenlabs_api_key: record?.elevenlabs_api_key || '',
        elevenlabs_voice_id: record?.elevenlabs_voice_id || '',
      });
    }

    // action === 'save'
    const updates = {};
    if (google_tts_api_key !== undefined) updates.google_tts_api_key = google_tts_api_key;
    if (groq_api_key !== undefined) updates.groq_api_key = groq_api_key;
    if (groq_api_key_2 !== undefined) updates.groq_api_key_2 = groq_api_key_2;
    if (elevenlabs_api_key !== undefined) updates.elevenlabs_api_key = elevenlabs_api_key;
    if (elevenlabs_voice_id !== undefined) updates.elevenlabs_voice_id = elevenlabs_voice_id;

    // Validate before writing anything — an invalid key must not be stored, or the
    // app treats setup as complete and every tool later fails with a mystery error.
    const invalid_fields: string[] = [];
    const warnings: string[] = [];
    if (google_tts_api_key && google_tts_api_key !== (record?.google_tts_api_key || '')) {
      const verdict = await validateGoogleTtsKey(google_tts_api_key);
      if (verdict === 'invalid') invalid_fields.push('google_tts_api_key');
      else if (verdict === 'unverified') warnings.push('Your Google API key could not be checked right now — saved anyway.');
    }
    if (groq_api_key && groq_api_key !== (record?.groq_api_key || '')) {
      const verdict = await validateGroqKey(groq_api_key);
      if (verdict === 'invalid') invalid_fields.push('groq_api_key');
      else if (verdict === 'unverified') warnings.push('Your Groq API key could not be checked right now — saved anyway.');
    }
    if (groq_api_key_2 && groq_api_key_2 !== (record?.groq_api_key_2 || '')) {
      const verdict = await validateGroqKey(groq_api_key_2);
      if (verdict === 'invalid') invalid_fields.push('groq_api_key_2');
      else if (verdict === 'unverified') warnings.push('Your backup Groq key could not be checked right now — saved anyway.');
    }
    if (invalid_fields.length) {
      return Response.json({
        error: 'Key(s) rejected by their provider — nothing was saved.',
        invalid_fields,
      }, { status: 400 });
    }

    if (record) {
      await base44.asServiceRole.entities.AppUser.update(record.id, updates);
    } else {
      // No AppUser record yet for this email (shouldn't normally happen for an already-
      // authenticated caller, but handle it rather than fail) — create one.
      await base44.asServiceRole.entities.AppUser.create({ email, ...updates });
    }

    return Response.json({ ok: true, warnings });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}