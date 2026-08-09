import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isAppAdmin } from '../../shared/appUserAuth.ts';

// Deletes a single AppUser row — gated on app-admin, run with the service role.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isAppAdmin(base44))) {
      return Response.json({ error: 'Admin only' }, { status: 403 });
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