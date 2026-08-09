import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Returns the set of Merchant-of-Record product IDs the currently logged-in user has
// purchased. The client combines this with each walk's `is_sample_walk` flag to decide
// which walks the user can open vs. sees a Buy button for.
//
// Reads the Purchase table as the service role (the client never queries Purchase
// directly, so other buyers' data is never exposed) and matches by the caller's email,
// lowercased on both sides so email casing can't silently block a paying customer.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const email = (user.email || '').toLowerCase().trim();
    if (!email) return Response.json({ productIds: [] });

    const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: email });
    const productIds = [...new Set(purchases.map(p => p.creem_product_id).filter(Boolean))];

    return Response.json({ productIds });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}