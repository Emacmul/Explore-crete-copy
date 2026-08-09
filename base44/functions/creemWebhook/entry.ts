import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { recordPurchase } from '../../shared/purchaseRecorder.ts';
import { recordMembership } from '../../shared/membershipRecorder.ts';

// Creem webhook receiver (sandbox for now; live Creem or a Paddle receiver later).
//
// This file is the Creem-SPECIFIC part: it verifies the incoming request is genuinely
// from Creem, then routes the event. The actual data writing is delegated to shared,
// processor-agnostic recorders — recordPurchase() for one-time walk/tour purchases and
// recordMembership() for the annual membership subscription. Adding Paddle later is a
// second webhook receiver (with Paddle's own signature verification) calling the same
// recorders with processor: 'paddle'.
//
// Creem signs every webhook with HMAC-SHA256 over the raw request body, using the
// webhook secret as the key, sent in the "creem-signature" header
// (docs.creem.io/learn/webhooks/verify-webhook-requests). This verification is never
// skipped — without it anyone could POST a fake purchase or membership here.
async function verifySignature(payload, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computed === signature;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const rawBody = await req.text();
    const signature = req.headers.get('creem-signature');
    const secret = Deno.env.get('CREEM_WEBHOOK_SECRET');

    if (!secret) {
      console.error('CREEM_WEBHOOK_SECRET is not set — webhook cannot accept anything until it is configured.');
      return Response.json({ error: 'Webhook not configured' }, { status: 500 });
    }
    if (!signature) {
      return Response.json({ error: 'Missing creem-signature header' }, { status: 400 });
    }

    const valid = await verifySignature(rawBody, signature, secret);
    if (!valid) {
      console.error('Creem webhook signature did not match — request rejected (not from Creem, or the secret is wrong).');
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const eventType = event.eventType || event.type;
    const payload = event.object || event.data || event;

    // ---- Annual membership: subscription.* lifecycle events ----
    // Creem fires these for recurring (membership) products. subscription.active /
    // subscription.paid cover a new membership starting AND each annual renewal (both just
    // confirm a paid period). subscription.canceled / subscription.scheduled_cancel mean
    // the member stopped recurring but the already-paid period continues until expires_at.
    // subscription.expired / subscription.paused / subscription.past_due / subscription.unpaid
    // mean access should end now.
    if (eventType && eventType.startsWith('subscription.')) {
      const sub = payload || {};
      const customerEmail = (sub.customer?.email || sub.customer_email || '').toLowerCase().trim();
      const subscriptionId = sub.id || sub.subscription_id;
      if (!customerEmail || !subscriptionId) {
        console.error('Creem subscription event missing email or subscription id', JSON.stringify(event));
        return Response.json({ error: 'Missing customer email or subscription id' }, { status: 400 });
      }

      const expiresAt = sub.current_period_end_date || null;

      const grantEvents = ['subscription.active', 'subscription.trialing', 'subscription.paid', 'subscription.update'];
      const cancelEvents = ['subscription.canceled', 'subscription.scheduled_cancel'];
      const revokeEvents = ['subscription.expired', 'subscription.paused', 'subscription.past_due', 'subscription.unpaid'];

      let status = null;
      if (grantEvents.includes(eventType)) status = 'active';
      else if (cancelEvents.includes(eventType)) status = 'canceled';
      else if (revokeEvents.includes(eventType)) status = 'expired';

      if (!status) {
        return Response.json({ received: true, skipped: true, reason: 'unhandled_subscription_event' });
      }

      const result = await recordMembership(base44, {
        buyerEmail: customerEmail,
        processor: 'creem',
        subscriptionId,
        status,
        expiresAt,
      });
      return Response.json({
        received: true,
        recorded: result.recorded,
        action: result.action || null,
        reason: result.reason || null,
      });
    }

    // ---- One-time walk/tour purchase: checkout.completed ----
    if (eventType !== 'checkout.completed') {
      return Response.json({ received: true, skipped: true });
    }

    const checkout = payload;
    // A membership (recurring) product ALSO fires checkout.completed, but the
    // subscription.* event above is what grants the membership — so don't also record it as
    // a one-time walk purchase (it would otherwise create a Purchase with no matching walk).
    const product = checkout.product || {};
    const isRecurring =
      product.billing_type === 'recurring' ||
      checkout.billing_type === 'recurring' ||
      !!checkout.subscription_id ||
      !!checkout.subscription?.id;
    if (isRecurring) {
      return Response.json({ received: true, skipped: true, reason: 'recurring_product_membership' });
    }

    const customerEmail = (checkout.customer?.email || checkout.customer_email || '').toLowerCase().trim();
    const productId = product.id || checkout.product_id;
    // Order/checkout id from Creem — used to dedupe redelivered webhooks.
    const transactionId = checkout.id || checkout.checkout_id || event.id || null;

    if (!customerEmail || !productId) {
      console.error('Creem webhook payload missing email or product ID', JSON.stringify(event));
      return Response.json({ error: 'Missing customer email or product ID' }, { status: 400 });
    }

    const result = await recordPurchase(base44, {
      buyerEmail: customerEmail,
      productId,
      processor: 'creem',
      transactionId,
    });

    return Response.json({ received: true, recorded: result.recorded, reason: result.reason || null });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});