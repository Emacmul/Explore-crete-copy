import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { isTokenGenuine } from '../../shared/wpToken.ts';
import { isSessionRevoked } from '../../shared/deviceAuth.ts';
import { isWalkPublic } from '../../shared/walkPublish.ts';

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

    // --- Fetch all walks, group into families, and determine what this account owns ---
    // Service role: no Base44 user session exists (auth is via WordPress JWT).
    //
    // PUBLISHED-VERSIONS CUTOVER: a family reaches this account's library when it is
    // owned (a non-revoked Purchase on the family's product id, or a free sample) AND
    // customer-visible in at least one language — per (family, language) pair: the
    // pair's ACTIVE PublishedTour snapshot first, the legacy published Walk record
    // (approved original / finished+approved clone) as the fallback, mirroring
    // getWalkCatalog exactly. The teaser fields come from the pair the catalogue would
    // serve (English preference, then alphabetical), so the library never advertises a
    // version customers can't actually open. Output shape is unchanged for the client.
    const allWalks = await base44.asServiceRole.entities.Walk.list('-created_date', 1000);

    const originals = allWalks.filter(w => !w.clone_of);
    const clones = allWalks.filter(w => !!w.clone_of);
    const originalsById = new Map(originals.map(o => [o.id, o]));

    // Active published versions grouped per (family, language) pair — same deterministic
    // winner rule as getWalkCatalog / resolveActiveVersion (latest status_changed_at,
    // then published_at, then id).
    const publishedRows = await base44.asServiceRole.entities.PublishedTour.list('-published_at', 1000);
    const publishedActive = (Array.isArray(publishedRows) ? publishedRows : []).filter(v => v && v.status === 'active');
    const versionsByFamily = new Map(); // familyId -> Map(language -> winning version)
    for (const v of publishedActive) {
      let byLang = versionsByFamily.get(v.family_id);
      if (!byLang) { byLang = new Map(); versionsByFamily.set(v.family_id, byLang); }
      const prev = byLang.get(v.language);
      const t = (x) => new Date(x || 0).getTime();
      const newer = !prev
        || t(v.status_changed_at) > t(prev.status_changed_at)
        || (t(v.status_changed_at) === t(prev.status_changed_at)
          && (t(v.published_at) > t(prev.published_at)
            || (t(v.published_at) === t(prev.published_at) && String(v.id).localeCompare(String(prev.id)) > 0)));
      if (newer) byLang.set(v.language, v);
    }

    // Families: every original, plus families that only exist through clones or versions.
    const families = new Map(); // familyId -> { original, clones }
    for (const o of originals) families.set(o.id, { original: o, clones: [] });
    for (const c of clones) {
      if (!families.has(c.clone_of)) families.set(c.clone_of, { original: null, clones: [] });
      families.get(c.clone_of).clones.push(c);
    }
    for (const fid of versionsByFamily.keys()) {
      if (!families.has(fid)) families.set(fid, { original: null, clones: [] });
    }

    const ownedWalks = [];
    const purchasedCodes = [];

    for (const [familyId, fam] of families) {
      const master = originalsById.get(familyId) || fam.original || null;
      const ownedByPurchase = !!(master?.creem_product_id && ownedProductIds.has(master.creem_product_id))
        || ownedWalkIds.has(familyId);
      const isSample = master?.is_sample_walk === true;
      if (!isSample && !ownedByPurchase) continue;

      // Languages this family is customer-visible in, and the record to serve teasers
      // from: snapshot first, legacy fallback — English preference, then alphabetical,
      // exactly the catalogue's default priority.
      const snapshotLangs = versionsByFamily.get(familyId) || new Map();
      const legacyByLang = new Map();
      const eligibleSorted = [...fam.clones]
        .filter(c => c.finished === true && isWalkPublic(c))
        .sort((a, b) => new Date(b.updated_date || 0).getTime() - new Date(a.updated_date || 0).getTime());
      for (const c of eligibleSorted) {
        const l = String(c.target_language || '').trim();
        if (l && !legacyByLang.has(l)) legacyByLang.set(l, c);
      }
      if (fam.original && isWalkPublic(fam.original) && !legacyByLang.has('English')) {
        legacyByLang.set('English', fam.original);
      }

      const langs = new Set([...snapshotLangs.keys(), ...legacyByLang.keys()]);
      if (langs.size === 0) continue; // owned, but nothing published in any language yet

      let served = null;
      for (const l of ['English', ...[...langs].sort((a, b) => a.localeCompare(b))]) {
        const version = snapshotLangs.get(l);
        if (version) { served = version.content || {}; break; }
        const legacy = legacyByLang.get(l);
        if (legacy) { served = legacy; break; }
      }
      if (!served) continue;

      const code = master?.code || served.code || '';
      ownedWalks.push({
        id: familyId,
        code,
        name: served.name,
        description: served.description,
        tour_category: served.tour_category,
        difficulty: served.difficulty,
        distance_km: served.distance_km,
        duration_hours: served.duration_hours,
        image_url: served.image_url,
        is_sample_walk: isSample,
        region: served.region
      });
      if (code && ownedByPurchase) purchasedCodes.push(code);
    }

    return Response.json({
      owned_codes: purchasedCodes,
      owned_sku_count: ownedProductIds.size,
      walk_count: ownedWalks.length,
      walks: ownedWalks,
      user: {
        id: wpUserId ?? null,
        email: wpUserEmail ?? gateEmail ?? null
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});