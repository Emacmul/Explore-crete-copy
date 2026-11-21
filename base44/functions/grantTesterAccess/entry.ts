import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isSuperAdmin, resolveNarrSession } from '../../shared/appUserAuth.ts';

// Give ONE tour to ONE person for free, as tester access — the path for a tour that is not
// ready to sell yet (no Creem product id, not published).
//
// Why this is separate from grantWalk: a gift is recorded as a Purchase, which keys
// entitlement on the tour's creem_product_id — so it can only ever grant a sellable product.
// A TesterGrant keys on the tour's stable family id instead, and getWalkCatalog treats it as
// both VISIBILITY (the tour is listed for that tester even while it is still a draft) and
// ENTITLEMENT (its route, waypoints and audio are served unlocked). Nothing about the tour
// changes for anyone else: it stays unapproved and absent from every other customer's
// catalogue, and it is never for sale.
//
// Super-Admin gated for the same reason grantWalk is (Enda, 2026-09-06): handing out tour
// content is one of the highest-risk admin actions. Removing a grant is a plain delete of
// the TesterGrant row.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (!(await isSuperAdmin(base44, body))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { walkId, testerEmail } = body;
    const email = (testerEmail || '').toLowerCase().trim();
    if (!walkId || !email) {
      return Response.json({ error: 'walkId and testerEmail are required' }, { status: 400 });
    }

    const walk = await base44.asServiceRole.entities.Walk.get(walkId);
    if (!walk) {
      return Response.json({ error: 'Walk not found' }, { status: 404 });
    }
    // A translation clone is not a separate tour identity — a grant always belongs to the
    // original, exactly as a purchase does, so every language is covered by one grant.
    const familyId = walk.clone_of || walk.id;
    const original = walk.clone_of
      ? await base44.asServiceRole.entities.Walk.get(walk.clone_of)
      : walk;

    const existing = await base44.asServiceRole.entities.TesterGrant.filter({
      walk_id: familyId,
      tester_email: email,
    });
    if (Array.isArray(existing) && existing.length > 0) {
      return Response.json({ granted: false, reason: 'already_granted', walk_id: familyId, walk_name: original.name });
    }

    // Who gave it, for the audit trail — the narr session's own account when there is one.
    const narrator = await resolveNarrSession(base44, body);
    await base44.asServiceRole.entities.TesterGrant.create({
      walk_id: familyId,
      walk_code: original.code || null,
      walk_name: original.name || null,
      tester_email: email,
      granted_at: new Date().toISOString(),
      granted_by_email: narrator?.email || body.email || 'admin (Base44 session)',
    });

    return Response.json({ granted: true, walk_id: familyId, walk_name: original.name });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}