import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isAppAdmin } from '../../shared/appUserAuth.ts';

// Dispute list for the Admin Panel's chargeback screen (audit N2, 2026-09-23).
// DisputesManager used to read the Dispute entity directly from the browser, but the
// Dispute entity's own RLS only recognises a native Base44 admin session — the revised
// Admin page signs in with a WordPress login plus a narr session, so the direct read
// came back empty or errored for exactly the admins who use the screen. The Restore
// write path already went through restoreDispute (which accepts narrAuth); this gives
// the read path the same treatment. Gated on the app's own admin concept (isAppAdmin —
// base admin or super admin), matching who the screen is shown to in BackendShell.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    if (!(await isAppAdmin(base44, body))) {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const disputes = await base44.asServiceRole.entities.Dispute.list('-created_date', 200);
    return Response.json({ disputes: Array.isArray(disputes) ? disputes : [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}