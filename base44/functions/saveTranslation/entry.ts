import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Saves (or reverts) a UI-string override so an admin or narrator can correct an
// unnatural AI translation. Overrides live in the Translation entity and are merged
// over the hardcoded baseline in src/lib/i18n by the LanguageProvider, so a correction
// goes live for every customer on next app load.
//
// Authorization — two paths, because the back end is reached two ways:
//  - Admin via the /Admin route: signed in with Base44's own login, so base44.auth.me()
//    returns role 'admin'. No extra credentials needed.
//  - Narrator (or admin wearing the Narr hat) via the Narr button: NO Base44 session,
//    so we verify them by email + the same backend password narrLogin checks against
//    AppUser.password.
// Runs as the service role so it can read AppUser (narrator auth) and write Translation
// records regardless of the caller's session.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { key, lang, value, mode, email, narrPassword } = body || {};

    if (!key || !lang) {
      return Response.json({ error: 'key and lang are required' }, { status: 400 });
    }

    // --- authorize ---
    let authorizedEmail = null;
    try {
      const me = await base44.auth.me();
      if (me && me.role === 'admin') authorizedEmail = me.email || null;
    } catch { /* no Base44 session — fall through to the narrator path */ }

    if (!authorizedEmail) {
      if (!email || !narrPassword) {
        return Response.json({ error: 'Not authorized' }, { status: 403 });
      }
      const normalized = String(email).trim().toLowerCase();
      const matches = await base44.asServiceRole.entities.AppUser.filter({ email: normalized });
      const u = Array.isArray(matches) ? matches[0] : null;
      if (!u || (u.role !== 'narrator' && u.role !== 'admin') || !u.password || String(u.password) !== String(narrPassword)) {
        return Response.json({ error: 'Not authorized' }, { status: 403 });
      }
      authorizedEmail = u.email;
    }

    // --- upsert or delete the override for (key, lang) ---
    const existing = await base44.asServiceRole.entities.Translation.filter({ key, lang });
    const record = Array.isArray(existing) ? existing[0] : null;

    if (mode === 'delete') {
      if (record) await base44.asServiceRole.entities.Translation.delete(record.id);
      return Response.json({ ok: true, deleted: !!record });
    }

    if (typeof value !== 'string' || !value.trim()) {
      return Response.json({ error: 'value is required' }, { status: 400 });
    }

    if (record) {
      await base44.asServiceRole.entities.Translation.update(record.id, { value, edited_by_email: authorizedEmail });
    } else {
      await base44.asServiceRole.entities.Translation.create({ key, lang, value, edited_by_email: authorizedEmail });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}