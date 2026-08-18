import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { isTokenGenuine } from '../../shared/wpToken.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { token } = body;

    if (!token) {
      return Response.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Confirm this token is genuinely real, issued by WordPress, before trusting anything
    // decoded from it below — without this, anyone could hand-construct a fake token
    // claiming to be any customer's WordPress user ID and email.
    if (!(await isTokenGenuine(token))) {
      return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return Response.json({ error: 'Invalid token format' }, { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return Response.json({ error: 'Invalid token payload' }, { status: 401 });
    }

    // Check expiry
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return Response.json({ error: 'Token expired — please log in again' }, { status: 401 });
    }

    const wpUserId = payload.data?.user?.id || payload.user_id || payload.sub;
    const wpUserEmail = payload.data?.user?.email || payload.email;

    if (!wpUserId) {
      return Response.json({ error: 'Could not determine user from token' }, { status: 401 });
    }

    // --- Fetch WooCommerce orders for this customer ---
    const siteUrl = Deno.env.get("WC_SITE_URL");
    const consumerKey = Deno.env.get("WC_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("WC_CONSUMER_SECRET");

    if (!siteUrl || !consumerKey || !consumerSecret) {
      return Response.json({ error: 'Server not configured for WooCommerce' }, { status: 500 });
    }

    const authHeader = btoa(`${consumerKey}:${consumerSecret}`);

    const ordersResponse = await fetch(
      `${siteUrl}/wp-json/wc/v3/orders?customer=${wpUserId}&status=completed&per_page=100`,
      {
        headers: { 'Authorization': `Basic ${authHeader}` }
      }
    );

    if (!ordersResponse.ok) {
      const errText = await ordersResponse.text();
      return Response.json({
        error: 'Failed to fetch orders from WooCommerce',
        details: errText
      }, { status: 502 });
    }

    const orders = await ordersResponse.json();

    // --- Extract product SKUs from all completed order line items ---
    const ownedSkus = new Set();
    for (const order of orders) {
      for (const item of order.line_items || []) {
        if (item.sku) ownedSkus.add(item.sku);
      }
    }

    // --- Fetch all walks and determine which ones the user owns ---
    // Service role: no Base44 user session exists (auth is via WordPress JWT)
    const allWalks = await base44.asServiceRole.entities.Walk.list('-created_date', 200);

    // Owned walks = walks whose code matches a purchased SKU, plus free sample walks
    const ownedWalks = allWalks.filter(w =>
      w.is_sample_walk || (w.code && ownedSkus.has(w.code))
    );

    const purchasedCodes = allWalks
      .filter(w => w.code && ownedSkus.has(w.code))
      .map(w => w.code);

    return Response.json({
      owned_codes: purchasedCodes,
      owned_sku_count: ownedSkus.size,
      walk_count: ownedWalks.length,
      walks: ownedWalks.map(w => ({
        id: w.id,
        code: w.code,
        name: w.name,
        description: w.description,
        tour_category: w.tour_category,
        difficulty: w.difficulty,
        distance_km: w.distance_km,
        duration_hours: w.duration_hours,
        image_url: w.image_url,
        is_sample_walk: w.is_sample_walk || false,
        region: w.region
      })),
      user: {
        id: wpUserId,
        email: wpUserEmail
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});