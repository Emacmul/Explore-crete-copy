import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { recordPurchase } from '../../shared/purchaseRecorder.ts';

// Manually grant a walk to a specific customer for free (birthday raffle, support gesture,
// etc.). Admin-only — admins sign in with Base44's own login, so base44.auth.me() is the
// right identity check here (unlike the customer flows, which use the WordPress token).
//
// Granting works by recording a Purchase with processor "manual" against the walk's
// creem_product_id + the customer's email. That is the SAME record getWalkCatalog and
// getOwnedProductIds already read to decide entitlement, so the gifted walk shows up in
// the customer's library immediately on their next catalogue load — no client changes,
// no second code path. A walk must have a creem_product_id set (it's a sellable product)
// before it can be gifted, since the entitlement check keys on that id.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller || caller.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { walkId, buyerEmail } = body;
    const email = (buyerEmail || '').toLowerCase().trim();
    if (!walkId || !email) {
      return Response.json({ error: 'walkId and buyerEmail are required' }, { status: 400 });
    }

    const walk = await base44.asServiceRole.entities.Walk.get(walkId);
    if (!walk) {
      return Response.json({ error: 'Walk not found' }, { status: 404 });
    }
    if (!walk.creem_product_id) {
      return Response.json({ error: 'This walk has no Creem product id set — add one in the Walk editor before granting it.' }, { status: 400 });
    }

    // Already owned? Check across every processor (a real Creem purchase OR a prior manual
    // gift) so we don't create a redundant record and can tell the admin it's already there.
    const existing = await base44.asServiceRole.entities.Purchase.filter({
      buyer_email: email,
      creem_product_id: walk.creem_product_id,
    });
    if (existing.length > 0) {
      return Response.json({ granted: false, reason: 'already_owned', walk_id: walk.id, walk_name: walk.name });
    }

    // Record the gift. transactionId null => recordPurchase dedupes by (manual, email, product).
    await recordPurchase(base44, {
      buyerEmail: email,
      productId: walk.creem_product_id,
      processor: 'manual',
      transactionId: null,
    });

    return Response.json({ granted: true, walk_id: walk.id, walk_name: walk.name });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}