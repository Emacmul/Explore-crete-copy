import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getEmailFromToken } from '../../shared/wpToken.ts';

// The ONLY place a customer's locked tour language ever changes after their first-time
// default is set. Called from a real "Do you want to swap?" prompt in the app — never
// invoked automatically, never a side effect of anything else. Two actions:
//   - accept: the customer said yes — updates accepted_language to the offered language.
//   - decline: the customer said no — accepted_language is left completely untouched;
//     the offered language is recorded so the same offer isn't repeated, but nothing about
//     what they already have changes in any way.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { token, walkId, language, action } = body || {};

    const email = getEmailFromToken(token);
    if (!email) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }
    if (!walkId || !language || (action !== 'accept' && action !== 'decline')) {
      return Response.json({ error: 'walkId, language, and a valid action are required' }, { status: 400 });
    }

    const existing = await base44.asServiceRole.entities.TourLanguagePref.filter({ buyer_email: email, walk_id: walkId });
    const pref = existing[0] || null;

    if (!pref) {
      // Shouldn't normally happen — a pref record is created the first time getWalkCatalog
      // resolves this tour for this customer — but handle it defensively rather than fail.
      if (action === 'accept') {
        await base44.asServiceRole.entities.TourLanguagePref.create({
          buyer_email: email,
          walk_id: walkId,
          accepted_language: language,
        });
      }
      return Response.json({ ok: true });
    }

    if (action === 'accept') {
      await base44.asServiceRole.entities.TourLanguagePref.update(pref.id, {
        accepted_language: language,
      });
    } else {
      const declined = new Set((pref.declined_languages || '').split(',').map(s => s.trim()).filter(Boolean));
      declined.add(language);
      await base44.asServiceRole.entities.TourLanguagePref.update(pref.id, {
        declined_languages: Array.from(declined).join(','),
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
