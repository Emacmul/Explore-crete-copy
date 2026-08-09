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
    return { revoked: true, target: 'purchase', count: purchases.length };
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
  return { revoked: true, target: 'membership', count: memberships.length };
}