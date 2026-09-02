import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isTokenGenuine, getEmailFromToken } from '../../shared/wpToken.ts';

// Customer onboarding — called from Home on login. Identifies the caller by the
// WordPress user id AND email carried inside their WP JWT (the tMeister token holds
// data.user.id and, when present, data.user.email), finds/creates their AppUser row,
// and returns ONLY the role so Home can surface the Admin/Narr button for promoted
// users.
//
// Real customers log in through WordPress and have no Base44 session, so this
// runs with the service role (the admin-only RLS on AppUser can't identify
// anonymous customers). It NEVER touches `role` — role only ever changes via
// saveAppUserAdmin (admin-gated). It returns no PII (no password, no full row)
// so a forged token can't harvest another user's record.
export default async function (req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, display_name } = body;
    const clientEmail = String(body.email || '').toLowerCase().trim();

    // SECURITY: this function reads/writes AppUser rows under the service role (bypassing
    // Base44's own RLS), so it must never act on anything the client claims about its own
    // identity until that claim is actually verified. Previously, a missing or invalid
    // token simply left wpId null and fell through to trusting the client-supplied `email`
    // to look up, mark-complete, or even create an AppUser row — meaning anyone on the
    // internet could call this public function URL with an arbitrary email and get back
    // that account's role, flip its registration_complete flag, or spray fake rows into the
    // table. Flagged by Base44's own security scan as "Anyone can run this function" /
    // "Unprotected backend functions." Fix: require a genuine, WordPress-verified token
    // before touching AppUser at all — no valid token, no access, full stop.
    const siteUrl = Deno.env.get('WC_SITE_URL');
    if (!token || !(await isTokenGenuine(token, siteUrl))) {
      return Response.json({ error: 'Not authorized' }, { status: 401 });
    }

    // WP user id from the token payload (same decode wpLogin uses client-side) — safe to
    // read now that isTokenGenuine has confirmed WordPress itself issued this exact token.
    let wpId = null;
    try {
      const parts = String(token).split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        wpId = payload?.data?.user?.id || payload?.user_id || payload?.sub || null;
      }
    } catch {
      // keep wpId null
    }

    if (!wpId) {
      // Token was genuine but its payload carried no usable WordPress user id — nothing
      // trustworthy left to identify the caller by. Fail closed instead of falling back
      // to the client-supplied email, which is exactly the hole being closed here.
      return Response.json({ error: 'Not authorized' }, { status: 401 });
    }

    const svc = createClientFromRequest(req).asServiceRole;

    // SECURITY (2026-09-02 audit, fixed): the email-fallback lookup below used to trust
    // whatever `clientEmail` the caller put in the request body outright. Since the only
    // requirement to reach this far is having SOME genuine WordPress account (not
    // specifically the one being looked up), anyone could self-register, then submit any
    // OTHER email address — a narrator's, or Enda's own admin email — and, for any
    // AppUser row that didn't yet have a user_id linked (true for any account created by
    // hand through the admin panel), get back that account's role and permanently
    // relink its user_id to themselves.
    //
    // Fix: prefer the email carried INSIDE the token's own payload (verifiedEmail) — safe
    // to read now that isTokenGenuine has already confirmed WordPress itself issued this
    // exact token, so it can only ever be the caller's own email. If this WordPress JWT
    // Auth plugin's payload doesn't happen to carry an email, `clientEmail` is still used
    // as a fallback, but ONLY to link an ordinary 'user'-role row — never a narrator or
    // admin row — since an ordinary customer row has no sensitive role or identity worth
    // protecting the same way, while a narrator/admin row is exactly what the exploit
    // targeted.
    const verifiedEmail = getEmailFromToken(token);

    const byId = await svc.entities.AppUser.filter({ user_id: String(wpId) });
    let row = Array.isArray(byId) ? byId[0] : null;
    if (!row && verifiedEmail) {
      const byEmail = await svc.entities.AppUser.filter({ email: verifiedEmail });
      row = Array.isArray(byEmail) ? byEmail[0] : null;
    } else if (!row && clientEmail) {
      const byEmail = await svc.entities.AppUser.filter({ email: clientEmail });
      const candidate = Array.isArray(byEmail) ? byEmail[0] : null;
      if (candidate && (!candidate.role || candidate.role === 'user')) {
        row = candidate;
      }
    }

    if (row) {
      // Link to this WP id + mark complete if not already. Role is never modified.
      const patch = {};
      if (!row.user_id) patch.user_id = String(wpId);
      if (!row.registration_complete) patch.registration_complete = true;
      if (Object.keys(patch).length) {
        await svc.entities.AppUser.update(row.id, patch);
      }
      return Response.json({ role: row.role || 'user' });
    }

    // Brand-new customer — create their row. Prefer the token's own verified email;
    // clientEmail (from the wpLogin response) is only a fallback for the rare case the
    // token payload didn't carry one. Either way this only ever creates a row tied to
    // the CALLER's own now-verified wpId, so there's nothing to hijack here.
    let fn = '';
    let ln = '';
    if (display_name) {
      const parts = String(display_name).trim().split(/\s+/);
      fn = parts[0] || '';
      ln = parts.slice(1).join(' ') || '';
    }

    await svc.entities.AppUser.create({
      email: verifiedEmail || clientEmail || '',
      user_id: String(wpId),
      first_name: fn,
      last_name: ln,
      role: 'user',
      registration_complete: true,
    });

    return Response.json({ role: 'user' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}