import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getEmailFromToken } from '../../shared/wpToken.ts';

// Returns the calling customer's current membership status.
//
// IMPORTANT: the caller is identified from the WordPress-issued token the client already
// holds (passed in the body), NOT Base44's own auth session — exactly like
// getOwnedProductIds. Real customers only ever log in through WordPress, so
// base44.auth.me() would return nothing for them.
//
// A person is a "current member" when a Membership record exists, its paid period hasn't
// lapsed (now < expires_at), and its status isn't 'expired'. A 'canceled' member keeps
// access until expires_at (they paid for that period); only a lapsed expiry or an
// 'expired' status means no current membership.
//
// This is intentionally just a status read — applying the 25% member discount at
// checkout is a separate piece that depends on a processor-side pricing mechanism
// (coupon / customer group) we haven't confirmed with Creem yet, so it's not built here.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const email = getEmailFromToken(body.token);
    if (!email) return Response.json({ isMember: false, status: null, expiresAt: null });

    // Service role: read this caller's Membership records. The client only receives a
    // boolean + status + expiry, never raw records, so other members' data isn't exposed.
    const memberships = await base44.asServiceRole.entities.Membership.filter({ buyer_email: email });
    if (memberships.length === 0) {
      return Response.json({ isMember: false, status: null, expiresAt: null });
    }

    // A buyer could in principle hold more than one membership record (a stale one plus a
    // new subscription, or a different processor). Use the one with the furthest-future
    // expiry — that's the one granting access right now.
    const now = Date.now();
    let best = null;
    let bestExp = -Infinity;
    for (const m of memberships) {
      const exp = m.expires_at ? new Date(m.expires_at).getTime() : 0;
      if (exp > bestExp) { best = m; bestExp = exp; }
    }

    const expiresAt = best.expires_at || null;
    const lapsed = !best.expires_at || new Date(best.expires_at).getTime() <= now;
    // canceled-but-still-within-the-paid-period keeps access until expires_at; only an
    // 'expired' status or a lapsed expiry means no current membership.
    const isMember = !lapsed && best.status !== 'expired';


    return Response.json({
      isMember,
      status: best.status,
      expiresAt,
      processor: best.processor,
      subscriptionId: best.subscription_id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}