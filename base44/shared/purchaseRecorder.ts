// Processor-agnostic ownership recording.
//
// This is the ONE place that records "this person now owns this walk". It is called by
// each Merchant-of-Record webhook receiver (Creem now, Paddle later) AFTER that receiver
// has verified the incoming webhook is genuinely from its processor and extracted the
// buyer + product. Adding a new processor later is therefore just a second webhook
// receiver (with its own signature verification) feeding into this same function —
// not new ownership logic.
//
// Idempotent: processors (Creem included) can redeliver the same webhook, so we dedupe
// by (processor, transaction_id); if a transaction id isn't available we fall back to
// (buyer_email + product_id) so a repeat still can't create a second record for the
// same person + product.
//
// A dedupe match that is currently REVOKED (see accessRevoker.ts / Purchase.jsonc, audit
// finding U-05) needs different handling depending on WHO is calling:
//
//  - the raw payment webhook (checkout.completed) must NEVER bring a revoked purchase back
//    on its own — a redelivered/retried webhook for a transaction that was already refunded
//    or charged back must stay blocked, full stop. That is the entire point of the U-05 fix.
//  - an explicit, already-authenticated admin action — restoring access after a won dispute,
//    or gifting a walk again after an earlier refund — is allowed to reactivate that exact
//    row in place (rather than piling up a second record for the same person + product).
//
// The `allowReactivate` flag is how a caller opts into the second behavior. It defaults to
// false, so a plain call (the webhook path) can never do it by accident; only
// accessRevoker.ts's restoreAccess() and grantWalk's re-gift path pass it explicitly, and
// both of those are Super-Admin-gated before they ever reach here. A genuine new purchase —
// a different transaction id — is unaffected either way and always creates its own fresh
// record.

export async function recordPurchase(base44, { buyerEmail, productId, processor, transactionId, allowReactivate = false }) {
  const email = (buyerEmail || '').toLowerCase().trim();
  if (!email || !productId) {
    return { recorded: false, reason: 'missing_email_or_product' };
  }

  // Idempotency check — has this exact purchase already been recorded?
  const dedupeFilter = transactionId
    ? { processor, transaction_id: transactionId }
    : { processor, buyer_email: email, creem_product_id: productId };

  const existing = await base44.asServiceRole.entities.Purchase.filter(dedupeFilter);
  const activeExisting = existing.find((p) => p.status !== 'revoked');
  if (activeExisting) {
    return { recorded: false, reason: 'duplicate', purchase_id: activeExisting.id };
  }

  const revokedExisting = existing.find((p) => p.status === 'revoked');
  if (revokedExisting) {
    if (!allowReactivate) {
      // Blocked, not reactivated — see the header comment above. This is the fix: an
      // ordinary (non-admin) call can find a revoked row here and must leave it revoked.
      return { recorded: false, reason: 'revoked', purchase_id: revokedExisting.id };
    }
    await base44.asServiceRole.entities.Purchase.update(revokedExisting.id, {
      status: 'active',
      revoked_at: null,
      purchased_at: new Date().toISOString(),
    });
    return { recorded: true, walk_id: revokedExisting.walk_id || null, reactivated: true };
  }

  // Resolve which walk this product grants access to — matched by the walk's
  // creem_product_id field (not a loose text match on the code). The purchase is
  // recorded even if no walk matches yet, so support can still see "someone paid for
  // product X" and access works the moment a walk is created with that product id.
  const walks = await base44.asServiceRole.entities.Walk.filter({ creem_product_id: productId });
  const walk = walks[0];

  await base44.asServiceRole.entities.Purchase.create({
    buyer_email: email,
    creem_product_id: productId,
    walk_id: walk ? walk.id : null,
    walk_name: walk ? walk.name : null,
    processor,
    transaction_id: transactionId || null,
    purchased_at: new Date().toISOString(),
  });

  return { recorded: true, walk_id: walk ? walk.id : null };
}