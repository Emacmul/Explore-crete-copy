import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getEmailFromToken } from '../../shared/wpToken.ts';

// Replaces browser-only localStorage for the Google TTS / Groq API keys with real,
// permanent, server-side storage tied to whoever is actually calling — an admin's real
// Base44 session, or a narrator's own email+token. Fixes the exact fragility that was
// happening: a key that only ever lived in one specific browser, gone the moment that
// browser's site data was cleared, with no way to recover it from anywhere.
//
// Every action here only ever touches the CALLER's own AppUser record — an admin gets
// and saves their own keys, a narrator gets and saves their own, never anyone else's.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action, token, google_tts_api_key, groq_api_key } = body || {};

    if (action !== 'get' && action !== 'save') {
      return Response.json({ error: 'action must be "get" or "save"' }, { status: 400 });
    }

    // Identify the caller — admin via a real Base44 session, narrator via the same
    // email+token pattern used everywhere else in this app.
    let email = null;
    try {
      const me = await base44.auth.me();
      if (me && me.email) email = me.email.toLowerCase();
    } catch { /* no Base44 session — try the narrator token path below */ }

    if (!email) {
      email = getEmailFromToken(token);
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
      });
    }

    // action === 'save'
    const updates = {};
    if (google_tts_api_key !== undefined) updates.google_tts_api_key = google_tts_api_key;
    if (groq_api_key !== undefined) updates.groq_api_key = groq_api_key;

    if (record) {
      await base44.asServiceRole.entities.AppUser.update(record.id, updates);
    } else {
      // No AppUser record yet for this email (shouldn't normally happen for an already-
      // authenticated caller, but handle it rather than fail) — create one.
      await base44.asServiceRole.entities.AppUser.create({ email, ...updates });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
