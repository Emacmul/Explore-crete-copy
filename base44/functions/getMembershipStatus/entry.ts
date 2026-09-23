import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyEmailFromToken } from '../../shared/wpToken.ts';
import { isSessionRevoked } from '../../shared/deviceAuth.ts';

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
    const email = await verifyEmailFromToken(body.token, Deno.env.get('WC_SITE_URL'));
    if (!email) return Response.json({ isMember: false, status: null, expiresAt: null });

    // Session-revocation gate (audit N5, 2026-09-23) — see isSessionRevoked in
    // shared/deviceAuth.ts. A session explicitly ended (forceLogoutAdmin / logout) must
    // revoke membership reads for as long as the old WordPress token stays valid.
    if (await isSessionRevoked(base44.asServiceRole, email, body.token)) {
      return Response.json({ isMember: false, status: null, expiresAt: null });
    }

    // Service role: read this caller's Membership records. The client only receives a
    // boolean + status + expiry, never raw records, so other members' data isn't exposed.
    const memberships = await base44.asServiceRole.entities.Membership.filter({ buyer_email: email });
    if (memberships.length === 0) {
      return Response.json({ isMember: false, status: null, expiresAt: null });
    }

    // Eligible-first selection (audit N5, 2026-09-23): a record grants access when its
    // status isn't 'expired', it isn't disputed, and its paid period hasn't lapsed. A buyer
    // can hold more than one membership record (a stale one plus a new subscription, or a
    // different processor), so the furthest-future expiry among the ELIGIBLE records wins.
    // The old code picked the furthest expiry first and only then checked eligibility, so a
    // later-expiring but expired/disputed record masked a genuinely active paid period and
    // answered "not a member" despite it. canceled-but-still-within-the-paid-period stays
    // eligible until expires_at, as before.
    const now = Date.now();
    const eligible = memberships.filter((m) =>
      m.status !== 'expired' && m.disputed !== true
      && m.expires_at && new Date(m.expires_at).getTime() > now
    );
    // Nothing eligible: still report the furthest-expiry record's status/expiry so the
    // client can show why — but isMember stays false.
    const pool = eligible.length > 0 ? eligible : memberships;
    let best = pool[0];
    let bestExp = -Infinity;
    for (const m of pool) {
      const exp = m.expires_at ? new Date(m.expires_at).getTime() : 0;
      if (exp > bestExp) { best = m; bestExp = exp; }
    }

    return Response.json({
      isMember: eligible.length > 0,
      status: best.status,
      expiresAt: best.expires_at || null,
      processor: best.processor,
      subscriptionId: best.subscription_id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}