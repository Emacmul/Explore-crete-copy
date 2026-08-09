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

export async function recordPurchase(base44, { buyerEmail, productId, processor, transactionId }) {
  const email = (buyerEmail || '').toLowerCase().trim();
  if (!email || !productId) {
    return { recorded: false, reason: 'missing_email_or_product' };
  }

  // Idempotency check — has this exact purchase already been recorded?
  const dedupeFilter = transactionId
    ? { processor, transaction_id: transactionId }
    : { processor, buyer_email: email, creem_product_id: productId };

  const existing = await base44.asServiceRole.entities.Purchase.filter(dedupeFilter);
  if (existing.length > 0) {
    return { recorded: false, reason: 'duplicate', purchase_id: existing[0].id };
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