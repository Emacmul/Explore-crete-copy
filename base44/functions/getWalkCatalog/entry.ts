import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getEmailFromToken } from '../../shared/wpToken.ts';

// The walk catalogue, with protected content withheld from callers who haven't bought it.
//
// This is the real fix for the "paywall only hides content" problem: instead of sending
// every walk's full data to the browser and choosing not to display it, the server here
// strips the protected fields (narration scripts, audio URLs, the full route line, the
// GPX) from any walk the caller doesn't own. The browser only ever receives teaser data
// (name, description, stats, start point, price, buy link) for locked walks — so there is
// nothing to read out of devtools.
//
// The caller is identified from the WordPress-issued token the client already holds
// (same as syncLibrary / getOwnedProductIds), not Base44's own session. Each walk is
// returned with an `_accessible` flag (free sample OR owns its creem_product_id) so the
// client can show a Buy button / paywall without re-deciding entitlement.

// Protected content withheld from non-entitled callers.
const PROTECTED_FIELDS = [
  'trail_path',
  'trail_breaks',
  'waypoints',
  'segment_scripts',
  'gpx_file_uri',
  'gpx_filename',
];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const email = getEmailFromToken(body.token);

    // Resolve the caller's owned product IDs by email (case-insensitive both sides).
    // An unidentified caller (no/invalid token) owns nothing — every non-sample walk is
    // returned as a teaser only.
    let ownedSet = new Set();
    if (email) {
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: email });
      ownedSet = new Set(purchases.map(p => p.creem_product_id).filter(Boolean));
    }

    // Fetch the published catalogue. Service role because this is the shared catalogue and
    // the caller's entitlement is decided here (by email), not by Walk row-level security.
    const allWalks = await base44.asServiceRole.entities.Walk.list('-created_date', 1000);

    const walks = allWalks.map(w => {
      const accessible =
        w.approved !== false &&
        (!!w.is_sample_walk || !!(w.creem_product_id && ownedSet.has(w.creem_product_id)));
      const out = { ...w };
      if (!accessible) {
        for (const f of PROTECTED_FIELDS) delete out[f];
      }
      out._accessible = accessible;
      return out;
    });

    return Response.json({ walks });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}