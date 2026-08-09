import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isAppAdmin } from '../../shared/appUserAuth.ts';

// Returns the full AppUser list — but only to app-admins (the Base44 builder, or
// an AppUser whose role is 'admin'). AppUser has no Base44-role read rule that can
// express "app admin" (promoted admins log into Base44 as plain 'user'), so the
// full-list read is gated here on the app's own admin concept and served with the
// service role. Direct client-SDK reads are restricted by RLS to a user's own
// row(s); the full list only ever comes back through this function.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isAppAdmin(base44))) {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }
    const list = await base44.asServiceRole.entities.AppUser.filter(
      {},
      '-created_date',
      5000
    );
    return Response.json({ users: Array.isArray(list) ? list : [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}