// Processor-agnostic membership status recording.
//
// This is the ONE place that records/updates "this person's membership is now in this
// state". It is called by each Merchant-of-Record webhook receiver (Creem now, Paddle
// later) AFTER that receiver has verified the incoming webhook is genuinely from its
// processor and parsed the subscription lifecycle event. Adding a new processor later is
// therefore just a second webhook receiver (with its own signature verification) feeding
// into this same function — not new membership logic. Mirrors recordPurchase.
//
// Idempotent: the subscription id is stable across the entire lifecycle (start → each
// renewal → cancellation/expiry), so we upsert keyed by (processor, subscription_id).
// A redelivered webhook just re-writes the same status/expiry — never a duplicate row.

export async function recordMembership(base44, { buyerEmail, processor, subscriptionId, status, expiresAt }) {
  const email = (buyerEmail || '').toLowerCase().trim();
  if (!email || !subscriptionId || !status) {
    return { recorded: false, reason: 'missing_email_subscription_or_status' };
  }

  // Find the existing membership for this processor + subscription id — one row per
  // subscription, updated on every lifecycle event.
  const existing = await base44.asServiceRole.entities.Membership.filter({
    processor,
    subscription_id: subscriptionId,
  });
  const current = existing[0];
  let expiresAtValue = expiresAt || null;

  // Safeguard: a cancellation should keep the member covered until the end of the period
  // they already paid for. Creem's canceled/scheduled_cancel payloads do carry
  // current_period_end_date, but if one ever arrived without it we must NOT null the
  // stored expiry (that would instantly mark a paying member as lapsed). Preserve the
  // existing value instead. Revoke events (expired/paused/past_due/unpaid) deliberately
  // still null here — losing access then is the intended behavior.
  if (!expiresAtValue && status === 'canceled' && current?.expires_at) {
    expiresAtValue = current.expires_at;
  }

  if (!current) {
    const created = await base44.asServiceRole.entities.Membership.create({
      buyer_email: email,
      processor,
      subscription_id: subscriptionId,
      status,
      expires_at: expiresAtValue,
    });
    return { recorded: true, action: 'created', membership_id: created.id };
  }

  // Update the status + expiry. The buyer email can very rarely change for the same
  // subscription id — keep it fresh if it did.
  const update = { status, expires_at: expiresAtValue };
  if (current.buyer_email !== email) update.buyer_email = email;
  await base44.asServiceRole.entities.Membership.update(current.id, update);
  return { recorded: true, action: 'updated', membership_id: current.id };
}