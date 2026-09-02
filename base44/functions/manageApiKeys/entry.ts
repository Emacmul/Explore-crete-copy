import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

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
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action, google_tts_api_key, groq_api_key, groq_api_key_2 } = body || {};

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
      });
    }

    // action === 'save'
    const updates = {};
    if (google_tts_api_key !== undefined) updates.google_tts_api_key = google_tts_api_key;
    if (groq_api_key !== undefined) updates.groq_api_key = groq_api_key;
    if (groq_api_key_2 !== undefined) updates.groq_api_key_2 = groq_api_key_2;

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
