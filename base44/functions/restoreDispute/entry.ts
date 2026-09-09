import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { restoreAccess } from '../../shared/accessRevoker.ts';
import { isSuperAdmin } from '../../shared/appUserAuth.ts';

// Super-Admin-only: puts access back after a chargeback dispute is resolved in our favor.
//
// Creem sends no "dispute won" webhook event, so there's nothing to listen for — an admin
// sees the win in the Creem dashboard and clicks Restore in the Disputes panel, which calls
// this. It re-creates the deleted one-time walk Purchase (or re-activates the expired
// membership) via the shared restoreAccess(), then marks the Dispute record 'restored'.
//
// Per Enda (2026-09-06): restoring a disputed purchase is one of the highest-risk admin
// actions, so it now requires a Super Admin (see appUserAuth.ts's isSuperAdmin()) rather
// than just any real Base44 login.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isSuperAdmin(base44))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { disputeId } = body;
    if (!disputeId) {
      return Response.json({ error: 'disputeId is required' }, { status: 400 });
    }

    const dispute = await base44.asServiceRole.entities.Dispute.get(disputeId);
    if (!dispute) {
      return Response.json({ error: 'Dispute not found' }, { status: 404 });
    }
    if (dispute.status === 'restored') {
      return Response.json({ restored: false, reason: 'already_restored' });
    }


    const result = await restoreAccess(base44, {
      buyerEmail: dispute.buyer_email,
      processor: dispute.processor,
      accessTarget: dispute.access_target,
      productId: dispute.product_id,
      transactionId: dispute.transaction_id,
      subscriptionId: dispute.subscription_id,
    });

    if (result.restored) {
      await base44.asServiceRole.entities.Dispute.update(dispute.id, {
        status: 'restored',
        restored_at: new Date().toISOString(),
      });
    }

    return Response.json({
      restored: result.restored,
      target: result.target || null,
      reason: result.reason || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}