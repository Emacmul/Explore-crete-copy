import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Creem signs every webhook with HMAC-SHA256 over the raw request body, using the webhook
// secret as the key, sent in a header called "creem-signature" — confirmed directly from
// Creem's own documentation (docs.creem.io/learn/webhooks/verify-webhook-requests).
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
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
  const base44 = createClientFromRequest(req);

  const rawBody = await req.text();
  const signature = req.headers.get('creem-signature');
  const secret = Deno.env.get('CREEM_WEBHOOK_SECRET');

  if (!secret) {
    console.error('CREEM_WEBHOOK_SECRET is not set — this must be configured before this webhook can accept anything.');
    return Response.json({ error: 'Webhook not configured' }, { status: 500 });
  }
  if (!signature) {
    return Response.json({ error: 'Missing creem-signature header' }, { status: 400 });
  }

  const valid = await verifySignature(rawBody, signature, secret);
  if (!valid) {
    console.error('Creem webhook signature did not match — request rejected, not from Creem or the secret is wrong.');
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Only checkout.completed actually confirms a successful one-time payment. The app currently
  // only sells individual walks/tours as one-time purchases, not subscriptions — the
  // subscription.* events are subscribed to (per the webhook setup) but not acted on here yet.
  // NOTE: the exact field names below (eventType, customer.email, product.id) are a best-effort
  // reading of Creem's general webhook shape — worth confirming against a real test event sent
  // from the Creem dashboard once that's available, and adjusting if the actual payload differs.
  const eventType = event.eventType || event.type;
  if (eventType !== 'checkout.completed') {
    return Response.json({ received: true, skipped: true });
  }

  const checkout = event.object || event.data || event;
  const customerEmail = (checkout.customer?.email || checkout.customer_email || '').toLowerCase().trim();
  const productId = checkout.product?.id || checkout.product_id;

  if (!customerEmail || !productId) {
    console.error('Creem webhook payload missing email or product ID', JSON.stringify(event));
    return Response.json({ error: 'Missing customer email or product ID in payload' }, { status: 400 });
  }

  // Find which walk this Creem product corresponds to.
  const walks = await base44.asServiceRole.entities.Walk.filter({ creem_product_id: productId });
  const walk = walks[0];
  if (!walk) {
    console.error('No walk found with creem_product_id matching:', productId);
    return Response.json({ error: 'No matching walk for this product ID' }, { status: 404 });
  }

  // Record the purchase against the customer's AppUser record.
  const appUsers = await base44.asServiceRole.entities.AppUser.filter({ email: customerEmail });
  const appUser = appUsers[0];

  if (!appUser) {
    // They paid before ever logging into the app — genuinely possible (bought from the website
    // first). Create a placeholder record with no user_id yet; Home.jsx's own registration check
    // already knows how to find and link up a record like this by email on their first real
    // login, same mechanism already built for admin-invited staff.
    await base44.asServiceRole.entities.AppUser.create({
      email: customerEmail,
      purchased_walk_ids: [walk.id],
    });
  } else if (!(appUser.purchased_walk_ids || []).includes(walk.id)) {
    await base44.asServiceRole.entities.AppUser.update(appUser.id, {
      purchased_walk_ids: [...(appUser.purchased_walk_ids || []), walk.id],
    });
  }

  return Response.json({ received: true });
});
