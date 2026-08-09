import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Customer onboarding — called from Home on login. Identifies the caller by the
// WordPress user id carried inside their WP JWT (the tMeister token holds
// data.user.id, NOT the email), finds/creates their AppUser row, and returns
// ONLY the role so Home can surface the Admin/Narr button for promoted users.
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

    // WP user id from the token payload (same decode wpLogin uses client-side).
    let wpId = null;
    if (token) {
      try {
        const parts = String(token).split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          wpId = payload?.data?.user?.id || payload?.user_id || payload?.sub || null;
        }
      } catch {
        // keep wpId null
      }
    }

    const svc = createClientFromRequest(req).asServiceRole;

    // Find the caller's row: by WP id (from the token) first, then by email.
    let row = null;
    if (wpId) {
      const byId = await svc.entities.AppUser.filter({ user_id: String(wpId) });
      row = Array.isArray(byId) ? byId[0] : null;
    }
    if (!row && clientEmail) {
      const byEmail = await svc.entities.AppUser.filter({ email: clientEmail });
      row = Array.isArray(byEmail) ? byEmail[0] : null;
    }

    if (row) {
      // Link to this WP id + mark complete if not already. Role is never modified.
      const patch = {};
      if (!row.user_id && wpId) patch.user_id = String(wpId);
      if (!row.registration_complete) patch.registration_complete = true;
      if (Object.keys(patch).length) {
        await svc.entities.AppUser.update(row.id, patch);
      }
      return Response.json({ role: row.role || 'user' });
    }

    // Brand-new customer — create their row. Email comes from the client (the
    // wpLogin response), since the token carries only the WP id, not the email.
    if (!clientEmail && !wpId) {
      return Response.json({ role: 'user' });
    }

    let fn = '';
    let ln = '';
    if (display_name) {
      const parts = String(display_name).trim().split(/\s+/);
      fn = parts[0] || '';
      ln = parts.slice(1).join(' ') || '';
    }

    await svc.entities.AppUser.create({
      email: clientEmail || '',
      user_id: wpId ? String(wpId) : '',
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