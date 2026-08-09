import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { recordPurchase } from '../../shared/purchaseRecorder.ts';

// Creem webhook receiver (sandbox for now; live Creem or a Paddle receiver later).
//
// This file is the Creem-SPECIFIC part: it verifies the incoming request is genuinely
// from Creem, then extracts the buyer + product. The actual ownership recording is
// delegated to the shared, processor-agnostic recordPurchase() — so adding Paddle
// later is a second webhook receiver (with Paddle's own signature verification)
// calling the same recordPurchase with processor: 'paddle'.
//
// Creem signs every webhook with HMAC-SHA256 over the raw request body, using the
// webhook secret as the key, sent in the "creem-signature" header
// (docs.creem.io/learn/webhooks/verify-webhook-requests). This verification is never
// skipped — without it anyone could POST a fake purchase here.
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

    // Only checkout.completed confirms a successful one-time payment. The app sells
    // individual walks/tours as one-time purchases today; subscription.* events are
    // subscribed to but not acted on here yet (the future membership will use them).
    const eventType = event.eventType || event.type;
    if (eventType !== 'checkout.completed') {
      return Response.json({ received: true, skipped: true });
    }

    const checkout = event.object || event.data || event;
    const customerEmail = (checkout.customer?.email || checkout.customer_email || '').toLowerCase().trim();
    const productId = checkout.product?.id || checkout.product_id;
    // Order/checkout id from Creem — used to dedupe redelivered webhooks.
    const transactionId = checkout.id || checkout.checkout_id || event.id || null;

    if (!customerEmail || !productId) {
      console.error('Creem webhook payload missing email or product ID', JSON.stringify(event));
      return Response.json({ error: 'Missing customer email or product ID' }, { status: 400 });
    }

    // Hand off to the shared ownership recorder. This is the only part that touches our
    // data; everything above is Creem-specific verification + parsing.
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