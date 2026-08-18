import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyEmailFromToken } from '../../shared/wpToken.ts';

// Returns the set of Merchant-of-Record product IDs the calling customer has purchased.
//
// IMPORTANT: the caller is identified from the WordPress-issued token the client already
// holds (passed in the body), NOT Base44's own auth session. Real customers only ever log
// in through WordPress, so base44.auth.me() would return nothing for them — which is why
// this reads the token instead, exactly like syncLibrary. The email is lowercased on both
// sides so email casing can't silently block a paying customer.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const email = await verifyEmailFromToken(body.token);
    if (!email) return Response.json({ productIds: [] });

    // Service role: read this caller's Purchase records (the client only receives product
    // IDs, never raw purchase records, so other buyers' data is never exposed).
    const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: email });
    const productIds = [...new Set(purchases.map(p => p.creem_product_id).filter(Boolean))];

    return Response.json({ productIds });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}