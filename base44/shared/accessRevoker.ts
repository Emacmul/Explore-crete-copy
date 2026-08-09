// Processor-agnostic access revocation after a refund or chargeback/dispute.
//
// Called by each Merchant-of-Record webhook receiver (Creem now, Paddle later) AFTER that
// receiver has verified the incoming webhook and parsed the refund/dispute event. Given
// the buyer and the disputed product, it revokes the right thing — because a chargeback
// means the money came back out, so whatever access that payment granted must come off too:
//
//  - if the disputed product is a one-time walk/tour product → delete the Purchase record(s)
//    for that buyer + product, so getOwnedProductIds stops returning it (walk access gone);
//  - otherwise (a membership product — no walk matches that product id) → mark the buyer's
//    membership(s) for this processor 'expired', so getMembershipStatus reports no current
//    membership.
//
// Routing by product id (rather than guessing from the event name) means a chargeback on a
// walk never touches someone's membership, and vice versa. Mirrors recordPurchase /
// recordMembership: the Creem- or Paddle-specific verification + parsing stays in the
// webhook; this is the one shared place that does the actual revocation.
import { recordPurchase } from './purchaseRecorder.ts';

export async function revokeAccess(base44, { buyerEmail, processor, productId }) {
  const email = (buyerEmail || '').toLowerCase().trim();
  if (!email) return { revoked: false, reason: 'missing_email' };
  if (!productId) return { revoked: false, reason: 'missing_product_id' };

  // Is the disputed product a walk/tour? Match by Walk.creem_product_id — the same field
  // recordPurchase uses to grant access.
  const walks = await base44.asServiceRole.entities.Walk.filter({ creem_product_id: productId });
  if (walks.length > 0) {
    const purchases = await base44.asServiceRole.entities.Purchase.filter({
      buyer_email: email,
      creem_product_id: productId,
    });
    for (const p of purchases) {
      await base44.asServiceRole.entities.Purchase.delete(p.id);
    }
    return {
      revoked: true,
      target: 'purchase',
      count: purchases.length,
      walk_id: walks[0] ? walks[0].id : null,
      transaction_id: purchases[0] ? purchases[0].transaction_id : null,
    };
  }

  // Not a walk product → it's the membership product. Revoke the buyer's membership(s) for
  // this processor. Setting status 'expired' is enough: getMembershipStatus treats
  // 'expired' as no current access regardless of expires_at.
  const memberships = await base44.asServiceRole.entities.Membership.filter({
    buyer_email: email,
    processor,
  });
  for (const m of memberships) {
    await base44.asServiceRole.entities.Membership.update(m.id, { status: 'expired' });
  }
  return {
    revoked: true,
    target: 'membership',
    count: memberships.length,
    subscription_id: memberships[0] ? memberships[0].subscription_id : null,
  };
}

// Restore access that revokeAccess took away — used when a chargeback dispute is later
// resolved in our favor. Creem sends no "dispute won" event, so today an admin triggers this
// from the Disputes panel once they see the win in the Creem dashboard; a future scheduled
// poll of Creem's API can call this same function automatically (so swapping to the polling
// option later needs no new restore path).
//
// Mirrors revokeAccess: membership → flip status back to 'active' (only if the paid period
// hasn't naturally ended while revoked); purchase → re-record the Purchase that was deleted,
// reusing recordPurchase so dedupe + walk resolution match the original grant.
export async function restoreAccess(base44, { buyerEmail, processor, accessTarget, productId, transactionId, subscriptionId }) {
  const email = (buyerEmail || '').toLowerCase().trim();
  if (!email) return { restored: false, reason: 'missing_email' };

  if (accessTarget === 'membership') {
    const filter = subscriptionId
      ? { buyer_email: email, processor, subscription_id: subscriptionId }
      : { buyer_email: email, processor };
    const memberships = await base44.asServiceRole.entities.Membership.filter(filter);
    for (const m of memberships) {
      const stillValid = !m.expires_at || new Date(m.expires_at).getTime() > Date.now();
      if (m.status === 'expired' && stillValid) {
        await base44.asServiceRole.entities.Membership.update(m.id, { status: 'active' });
      }
    }
    return { restored: true, target: 'membership', count: memberships.length };
  }

  if (accessTarget === 'purchase') {
    const res = await recordPurchase(base44, {
      buyerEmail: email,
      productId,
      processor,
      transactionId: transactionId || null,
    });
    return { restored: res.recorded, target: 'purchase', reason: res.reason || null };
  }

  return { restored: false, reason: 'unknown_target' };
}