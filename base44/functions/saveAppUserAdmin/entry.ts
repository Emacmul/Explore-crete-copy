import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isAppAdmin } from '../../shared/appUserAuth.ts';

// Updates a single AppUser row (role / password / date of birth / gender /
// newsletter opt-in) — gated on app-admin and run with the service role so the
// Base44-role RLS on AppUser (which can't recognise promoted admins) doesn't
// block the write. This is the only path that ever changes an AppUser's role, so
// promotion always requires an admin — never the sync, never a non-admin.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isAppAdmin(base44))) {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const { id, updates } = body;
    if (!id || !updates || typeof updates !== 'object') {
      return Response.json({ error: 'id and updates are required' }, { status: 400 });
    }
    // Only allow the fields the edit dialog actually changes — never let a caller
    // rewrite email or sneak arbitrary fields through the update payload.
    const allowed = {};
    for (const k of ['role', 'password', 'date_of_birth', 'gender', 'newsletter_opted_in']) {
      if (k in updates) allowed[k] = updates[k];
    }
    const updated = await base44.asServiceRole.entities.AppUser.update(String(id), allowed);
    return Response.json({ ok: true, user: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}