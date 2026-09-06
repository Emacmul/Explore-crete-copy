import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isSuperAdmin } from '../../shared/appUserAuth.ts';

// Deletes a single AppUser row — run with the service role.
//
// Per Enda (2026-09-06): deleting a user account is one of the highest-risk actions
// here, so it now requires a Super Admin (see appUserAuth.ts's isSuperAdmin()), not
// just any regular Admin.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isSuperAdmin(base44))) {
      return Response.json({ error: 'Super Admin only' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const { id } = body;
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
    await base44.asServiceRole.entities.AppUser.delete(String(id));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}