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
// A redelivered webhook just re-writes the same status/expiry — never a duplicate row —
// UNLESS the membership is currently 'disputed' (see below), or the incoming event is
// genuinely OLDER than the last one already applied (see the last_event_at check below),
// in which case it's refused outright rather than written.
//
// `eventCreatedAt` is the PROCESSOR's own timestamp for when it generated this lifecycle
// event (Creem's event.created_at) — not when we received it. It's optional: a caller with
// no such timestamp (a processor that doesn't provide one, or a manual admin grant) simply
// skips the ordering check below, exactly as before this fix existed.
export async function recordMembership(base44, { buyerEmail, processor, subscriptionId, status, expiresAt, eventCreatedAt }) {
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

  // A membership marked 'disputed' had its access pulled by a refund/chargeback (see
  // accessRevoker.ts), not by an ordinary processor lifecycle event. An out-of-order or
  // redelivered webhook for this same subscription — e.g. Creem re-sending the ORIGINAL
  // subscription.paid event after the dispute already revoked access — must never be able
  // to silently undo that on its own (audit finding U-06, 2026-09-09 review). Only the
  // Super-Admin dispute-restore flow (accessRevoker.ts's restoreAccess) clears the flag;
  // until then, every ordinary webhook for this subscription id is ignored outright.
  if (current?.disputed) {
    return { recorded: false, reason: 'disputed', membership_id: current.id };
  }

  // General out-of-order guard (audit re-check, 2026-09-09 — finding U-06, the wider case
  // beyond just the disputed one above): the disputed flag only ever covers a refund/
  // chargeback. Any two ordinary webhooks can still arrive out of order for lots of mundane
  // reasons (retries, network delays, processor-side queueing) — e.g. a genuinely newer
  // subscription.expired followed by a delayed, older subscription.paid must not be allowed
  // to silently reactivate a membership that correctly already ended. Reject only a
  // STRICTLY older event than the last one applied — an equal timestamp (the same event
  // redelivered) still passes through, keeping redelivery idempotent as documented above.
  const newEventTime = eventCreatedAt ? new Date(eventCreatedAt).getTime() : null;
  const lastEventTime = current?.last_event_at ? new Date(current.last_event_at).getTime() : null;
  if (newEventTime !== null && !Number.isNaN(newEventTime) && lastEventTime !== null && !Number.isNaN(lastEventTime) && newEventTime < lastEventTime) {
    return { recorded: false, reason: 'stale_event', membership_id: current.id };
  }

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

  // Only advance last_event_at when this event actually carried a timestamp — a caller with
  // none (see above) leaves whatever was already stored untouched, rather than blanking it.
  const newLastEventAt = newEventTime !== null && !Number.isNaN(newEventTime)
    ? new Date(newEventTime).toISOString()
    : (current?.last_event_at ?? null);

  if (!current) {
    const created = await base44.asServiceRole.entities.Membership.create({
      buyer_email: email,
      processor,
      subscription_id: subscriptionId,
      status,
      expires_at: expiresAtValue,
      last_event_at: newLastEventAt,
    });
    return { recorded: true, action: 'created', membership_id: created.id };
  }

  // Update the status + expiry. The buyer email can very rarely change for the same
  // subscription id — keep it fresh if it did.
  const update = { status, expires_at: expiresAtValue, last_event_at: newLastEventAt };
  if (current.buyer_email !== email) update.buyer_email = email;
  await base44.asServiceRole.entities.Membership.update(current.id, update);
  return { recorded: true, action: 'updated', membership_id: current.id };
}