import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getEmailFromToken } from '../../shared/wpToken.ts';

// Customer onboarding — called from Home on first login. Identifies the customer
// by their WordPress JWT (NOT a Base44 session: real customers never have one) and
// ensures an AppUser row exists for them, fully linked (user_id set to the WP id,
// registration_complete true). NEVER touches `role` — role only ever changes via
// saveAppUserAdmin, which is admin-gated. Runs with the service role so the
// admin-only RLS on AppUser (which can't identify anonymous customers) doesn't
// block it, and so a customer can't write arbitrary fields themselves.
//
// Returns the AppUser row + its role so Home can surface the Admin/Narr button for
// promoted users (who log in through the same WordPress flow as everyone else).
export default async function (req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, display_name } = body;
    const email = getEmailFromToken(token);
    if (!email) {
      return Response.json({ error: 'Invalid token' }, { status: 401 });
    }

    // WP user id from the token payload (same decode wpLogin uses client-side).
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

    // Derive first/last name from display_name when creating a brand-new row.
    let fn = '';
    let ln = '';
    if (display_name) {
      const parts = String(display_name).trim().split(/\s+/);
      fn = parts[0] || '';
      ln = parts.slice(1).join(' ') || '';
    }

    const svc = createClientFromRequest(req).asServiceRole;

    const rows = await svc.entities.AppUser.filter({ email });
    let row = Array.isArray(rows) ? rows[0] : null;

    if (row) {
      // Link to this WP id + mark complete if not already. Role is never modified.
      const patch = {};
      if (!row.user_id && wpId) patch.user_id = String(wpId);
      if (!row.registration_complete) patch.registration_complete = true;
      if (Object.keys(patch).length) {
        row = await svc.entities.AppUser.update(row.id, patch);
      }
    } else {
      row = await svc.entities.AppUser.create({
        email,
        user_id: wpId ? String(wpId) : '',
        first_name: fn,
        last_name: ln,
        role: 'user',
        registration_complete: true,
      });
    }

    return Response.json({ appUser: row, role: row.role || 'user' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}