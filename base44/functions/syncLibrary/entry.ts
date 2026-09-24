import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { isTokenGenuine } from '../../shared/wpToken.ts';
import { isSessionRevoked } from '../../shared/deviceAuth.ts';

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
    if (!(await isTokenGenuine(token, Deno.env.get('WC_SITE_URL')))) {
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

    // Session-revocation gate (audit N5, 2026-09-23) — see isSessionRevoked in
    // shared/deviceAuth.ts. A session explicitly ended (forceLogoutAdmin / logout) must
    // revoke ownership reads for as long as the old WordPress token stays valid. Returns
    // the same empty-ownership shape a successful sync produces, so no client change is
    // needed.
    // Session-revocation gate — now for EVERY genuine token, email-free ones included
    // (audit 2026-09-24): a token carrying a WordPress user ID but no email used to skip
    // this check entirely and keep pulling purchase/library metadata even after its
    // session was revoked. When the payload has no email, the account's email is
    // resolved from AppUser by WordPress user ID (set at onboarding); if that fails too,
    // the gate fails CLOSED — an identity we can't resolve is treated as revoked.
    const wpUserId = payload.data?.user?.id || payload.user_id || payload.sub;
    const wpUserEmail = payload.data?.user?.email || payload.email;
    let gateEmail = wpUserEmail ? String(wpUserEmail).toLowerCase().trim() : null;
    if (!gateEmail && wpUserId) {
      const appUser = await base44.asServiceRole.entities.AppUser.filter({ user_id: String(wpUserId) });
      gateEmail = appUser[0]?.email || null;
    }
    if (!gateEmail || await isSessionRevoked(base44.asServiceRole, gateEmail, token)) {
      return Response.json({ owned_codes: [], owned_sku_count: 0, walk_count: 0, walks: [] });
    }

    // --- Ownership comes from the app's own Purchase records, NOT WooCommerce ---
    // Per Enda (2026-09-24): the WordPress store is a product brochure only — customers
    // can't buy there. Real purchases arrive via the Creem payment webhook
    // (purchaseRecorder.ts), which records each one with the buyer's email, the product
    // id and the resolved walk id. The old version fetched WooCommerce orders here,
    // which could only ever return an empty set — and needed the WooCommerce API
    // credentials (WC_CONSUMER_KEY/SECRET) to do it.
    const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: gateEmail });
    const eligiblePurchases = purchases.filter(p => p.status !== 'revoked');
    const ownedProductIds = new Set(eligiblePurchases.map(p => p.creem_product_id).filter(Boolean));
    const ownedWalkIds = new Set(eligiblePurchases.map(p => p.walk_id).filter(Boolean));

    // --- Fetch all walks and determine which ones the user owns ---
    // Service role: no Base44 user session exists (auth is via WordPress JWT)
    const allWalks = await base44.asServiceRole.entities.Walk.list('-created_date', 200);

    // Owned walks = walks this account holds an eligible Purchase for, plus free samples.
    // Published walks ONLY, mirroring the customer catalogue's rule exactly (2026-09-24
    // security review, "draft metadata" + "publication gate" findings): `approved` must
    // be genuinely true — a missing/null value is a draft, not the "default published"
    // reading the earlier `approved !== false` gave it — and a translation clone must
    // also be finished, so an unfinished clone of a purchased/sample tour can't leak its
    // name/description through the library. Admins preview drafts through their own
    // gated paths, never here.
    const isPublished = (w) => w.approved === true && (!w.clone_of || w.finished === true);
    const isPurchased = (w) => ownedProductIds.has(w.creem_product_id) || ownedWalkIds.has(w.id);
    const ownedWalks = allWalks.filter(w => isPublished(w) && (w.is_sample_walk || isPurchased(w)));

    const purchasedCodes = allWalks
      .filter(w => w.code && isPublished(w) && isPurchased(w))
      .map(w => w.code);

    return Response.json({
      owned_codes: purchasedCodes,
      owned_sku_count: ownedProductIds.size,
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
        id: wpUserId ?? null,
        email: wpUserEmail ?? gateEmail ?? null
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});