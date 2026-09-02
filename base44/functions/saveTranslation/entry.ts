import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyPassword } from '../../shared/passwordHash.ts';

// Saves (or reverts) a UI-string override so an admin or narrator can correct an
// unnatural AI translation. Overrides live in the Translation entity and are merged
// over the hardcoded baseline in src/lib/i18n by the LanguageProvider, so a correction
// goes live for every customer on next app load.
//
// Authorization — three paths, because the back end is reached different ways:
//  - Admin via the /Admin route: signed in with Base44's own login, so base44.auth.me()
//    returns role 'admin'. No extra credentials needed.
//  - Narrator (or admin wearing the Narr hat) via the Narr button, within the same
//    login session: a session token issued by narrLogin at the moment the password was
//    genuinely verified — this is what lets a narrator save repeatedly without
//    re-entering the password each time, without ever skipping the actual password
//    check itself (that check just happened once, at login, not here).
//  - Narrator email + password directly — kept as a fallback for any caller that
//    doesn't have a session token for some reason.
// Runs as the service role so it can read AppUser (narrator auth) and write Translation
// records regardless of the caller's session.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { key, lang, value, mode, email, narrPassword, narrToken } = body || {};

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
      if (!email || (!narrPassword && !narrToken)) {
        return Response.json({ error: 'Not authorized' }, { status: 403 });
      }
      const normalized = String(email).trim().toLowerCase();
      const matches = await base44.asServiceRole.entities.AppUser.filter({ email: normalized });
      const u = Array.isArray(matches) ? matches[0] : null;
      if (!u || (u.role !== 'narrator' && u.role !== 'admin')) {
        return Response.json({ error: 'Not authorized' }, { status: 403 });
      }
      const tokenValid = narrToken && u.narr_session_token && String(u.narr_session_token) === String(narrToken)
        && u.narr_session_expires_at && new Date(u.narr_session_expires_at).getTime() > Date.now();
      // Passwords are now stored hashed (see passwordHash.ts / narrLogin.ts) — this
      // still verifies correctly against either a hashed or a not-yet-migrated
      // plain-text row, same as narrLogin itself.
      const passwordValid = !tokenValid && narrPassword && u.password && (await verifyPassword(String(narrPassword), String(u.password))).valid;
      if (!tokenValid && !passwordValid) {
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