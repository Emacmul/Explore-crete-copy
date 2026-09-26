import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyEmailFromToken, isTokenGenuine } from '../../shared/wpToken.ts';
// Per Enda / Base44 support: retries a real 429 (pooled rate limit) with a short backoff —
// see withEntityRetry.ts's own header comment for the full reasoning. This is also the
// single most-loaded read in the app (every visitor's every app open), so it's worth this
// protection regardless of the narrator-specific concern that started this.
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';
import { isSessionRevoked } from '../../shared/deviceAuth.ts';
import { isWalkPublic } from '../../shared/walkPublish.ts';

// The walk catalogue, collapsed to one STABLE entry per tour (not per language).
//
// A translated tour is stored as its own Walk record (a "clone") pointing back at the
// original via `clone_of`. But a customer buys the EXPERIENCE once — which narration
// language plays is a preference, not a separate purchase — and their library and offline
// downloads are one slot per tour, never one per language. So this function collapses every
// tour family into a single record keyed by the ORIGINAL's id (the stable identity), filled
// with whichever language record is "active" for this caller right now.
//
// PUBLISHED-VERSIONS CUTOVER (plan §3): for CUSTOMERS, the active record is now served per
// (family, language) PAIR — the pair's ACTIVE PublishedTour snapshot first (the immutable
// customer-facing version), with the legacy published Walk record as a per-pair fallback so
// nothing goes dark if the migration misses a record. Priority across pairs: the caller's
// narration preference, then English, then every other language alphabetically. A snapshot
// is served with the version's publish time as `updated_date` (so a new version
// auto-refreshes offline downloads) and the version id as `_active_id` (so a version change
// replaces the offline copy in the same slot). The admin draft-preview path is deliberately
// UNCHANGED: an admin is testing working records, so they keep seeing the live Walk records
// (masters and clones, current edits included), badged as drafts — the snapshot machinery
// only affects what customers are served.
//
// Protected content is withheld from non-entitled callers (the paywall-is-just-CSS fix):
// teaser fields only for walks the caller doesn't own. The caller is identified from the
// WordPress-issued token (not Base44's session), like syncLibrary / getOwnedProductIds.
//
// Per security finding U1 (2026-09-23 audit): this used to be a delete-list (strip
// trail_path/waypoints/... from inaccessible tours), which silently served every field it
// forgot — import_files' public .odt narration-source URLs, the tour-level PCV system-alert
// audio URLs and their texts, and the assigned narrator's email all leaked to every unpaid
// visitor, and any future Walk field would have leaked the same way by default. It is now
// an explicit ALLOWLIST (PUBLIC_CATALOG_FIELDS below): an unentitled caller gets exactly
// those fields, nothing else, ever.
//
// Admin draft preview (per Enda, follow-up 159): a tour like "Battle of the Rivers" needs
// to be tested inside the REAL customer app — the actual listing, map, paywall unlock and
// driving player — before it is published to everyone. Previously the only way to do that
// was to flip `approved` to true first, which means publishing it. Now, an admin caller
// (AppUser.role 'admin' or 'super_admin' — same definition isAppAdmin/isSuperAdmin use
// elsewhere) additionally sees every draft: an unapproved original, or a clone that isn't
// yet finished/approved. Each such record is tagged `_is_draft_preview: true` so the
// frontend can badge it clearly, and is force-unlocked (bypassing the purchase check below)
// since a draft never has a real Purchase record to check against. A NON-admin caller (a
// customer, or a narrator — Enda was explicit this is admin-only, not narrators) is
// completely unaffected: this only ever ADDS records for admins, never changes what a
// published tour looks like to anyone.
// The exact fields an UNENTITLED caller may see. Deliberately included: the catalog
// machinery this function itself sets, the listing-card/paywall teasers (the customer
// must see what they're buying — same deliberate set as before), and the commerce fields.
// Deliberately excluded (finding U1): the narration depository (import_files), all
// spoken-alert texts AND their PCV audio URLs, the route (trail_path/trail_breaks/
// waypoints), segment scripts, the assigned narrator's email, and anything not on this
// list — including Walk fields added to the schema in the future, which now default to
// withheld instead of default-public.
const PUBLIC_CATALOG_FIELDS = [
  // identity + catalog machinery (set/derived in this function)
  'id', 'created_date', 'updated_date',
  '_family_id', '_active_id', '_active_lang', '_available_langs', '_is_draft_preview',
  'marker_lat', 'marker_lng',
  // listing card + paywall teasers
  'name', 'code', 'description', 'image_url', 'region', 'main_interest', 'difficulty',
  'distance_km', 'duration_hours', 'elevation_gain_m', 'tour_category', 'route_type',
  'buggy_friendly', 'manual_only_tour', 'related_tour_codes', 'announced_at',
  'safety_notes', 'start_lat', 'start_lng',
  // commerce
  'price_eur', 'checkout_url', 'creem_product_id', 'is_sample_walk',
  // status flags the frontend reads for badges/language handling
  'approved', 'finished', 'target_language', 'clone_of',
];

export default async function(req) {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    // ONE verified identity first (audit N6, 2026-09-23): the token's email when it
    // carries one; otherwise — for a genuine token carrying only a WordPress user id —
    // the AppUser that id resolves to (the same shape ensureAppUserOnboarding matches).
    // Every gate below (admin role, session revocation, purchase entitlement) then uses
    // that single resolved email, so an email-free admin token can no longer skip the
    // revocation check that the email-bearing path goes through.
    let email = await verifyEmailFromToken(body.token, Deno.env.get('WC_SITE_URL'));
    const narrationLang = body.narrationLang || 'English';

    // Fallback for the email-free / unmatched-email token shapes (per Enda, 2026-09-20):
    // identify the AppUser by the WordPress user id inside a token WordPress itself
    // confirms as genuine — the same way ensureAppUserOnboarding does.
    const resolveByWpUserId = async () => {
      if (!body.token) return null;
      try {
        if (!(await isTokenGenuine(body.token, Deno.env.get('WC_SITE_URL')))) return null;
        const parts = String(body.token).split('.');
        const payload = parts.length === 3
          ? JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
          : null;
        const wpId = payload?.data?.user?.id || payload?.user_id || payload?.sub || null;
        if (!wpId) return null;
        const byId = await base44.asServiceRole.entities.AppUser.filter({ user_id: String(wpId) });
        return (Array.isArray(byId) ? byId[0] : null) || null;
      } catch {
        return null; // could not confirm — stay unresolved (fail closed)
      }
    };

    // Admin-only draft preview gate. Same AppUser.role lookup ensureAppUserOnboarding and
    // isAppAdmin/isSuperAdmin already use elsewhere — kept deliberately narrow to 'admin' and
    // 'super_admin' only, NOT 'narrator', per Enda's explicit instruction (follow-up 159).
    let isAdmin = false;
    if (email) {
      const appUserRows = await base44.asServiceRole.entities.AppUser.filter({ email });
      if (Array.isArray(appUserRows) && appUserRows.length > 0) {
        isAdmin = appUserRows[0].role === 'admin' || appUserRows[0].role === 'super_admin';
      } else {
        // The token's email matched no AppUser row — fall back to the id lookup.
        const byId = await resolveByWpUserId();
        if (byId) {
          email = byId.email || email;
          isAdmin = byId.role === 'admin' || byId.role === 'super_admin';
        }
      }
    } else {
      // Email-free token: resolve the whole identity by WordPress user id so revocation
      // and entitlement apply below, exactly as for an email-bearing token.
      const byId = await resolveByWpUserId();
      if (byId) {
        email = byId.email || null;
        isAdmin = byId.role === 'admin' || byId.role === 'super_admin';
      }
    }

    // Session-revocation gate (audits N5 + N6, 2026-09-23): a session explicitly ended by
    // forceLogoutAdmin or the customer's own logout must actually revoke the content a
    // still-valid WordPress token would otherwise keep serving — including for an admin
    // whose token had to be identified by user id instead of email. A revoked caller keeps
    // browsing the anonymous teaser catalogue (exactly like a visitor with no token),
    // they just no longer get owned/draft content. See isSessionRevoked for why this is
    // not heartbeat-based.
    const sessionRevoked = email
      ? await isSessionRevoked(base44.asServiceRole, email, body.token)
      : false;
    if (sessionRevoked) isAdmin = false;

    // Owned product ids by email. Entitlement is decided HERE, by the ORIGINAL's product id
    // — a clone is never a separate sellable product, so owning the original grants every
    // language version of it.
    let ownedSet = new Set();
    if (email && !sessionRevoked) {
      // A revoked purchase (refund/chargeback — see accessRevoker.ts) is kept in the table
      // but must not count as owned, or a refunded customer would keep the protected fields
      // below. Records from before that field existed have no status and are treated as active.
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: email });
      ownedSet = new Set(purchases.filter(p => p.status !== 'revoked').map(p => p.creem_product_id).filter(Boolean));
    }

    const all = await base44.asServiceRole.entities.Walk.list('-created_date', 1000);

    // ---- Active published versions, grouped per (family, language) pair ----
    // One deterministic winner per pair (same total order as resolveActiveVersion in
    // shared/publishedTours.ts: latest status_changed_at, then latest published_at, then
    // id) — with more than one active row, every read deterministically serves the same
    // version, and the anomaly is logged to DebugCatalogLog so it's visible, never silent.
    const publishedRows = await base44.asServiceRole.entities.PublishedTour.list('-published_at', 1000);
    const publishedActive = (Array.isArray(publishedRows) ? publishedRows : []).filter(v => v && v.status === 'active');
    const versionsByFamily = new Map(); // familyId -> Map(language -> winning version)
    const pairActiveCounts = new Map(); // "familyId||language" -> active row count
    for (const v of publishedActive) {
      const pairKey = `${v.family_id}||${v.language}`;
      pairActiveCounts.set(pairKey, (pairActiveCounts.get(pairKey) || 0) + 1);
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
    for (const [pairKey, count] of pairActiveCounts) {
      if (count > 1) {
        try {
          await base44.asServiceRole.entities.DebugCatalogLog.create({
            note: `PublishedTour anomaly: ${count} active versions for pair ${pairKey} — serving the latest status_changed_at (getWalkCatalog read).`,
          });
        } catch { /* logging must never break serving */ }
      }
    }

    const originals = all.filter(w => !w.clone_of);
    const clones = all.filter(w => !!w.clone_of);
    const originalsById = new Map(originals.map(o => [o.id, o]));

    // A legacy Walk record reaches a customer when (one shared predicate — see walkPublish.ts,
    // audit N2): original: isWalkPublic (explicitly approved === true); clone: finished ===
    // true AND public. An admin additionally sees every draft (see the header comment
    // above) — every original and every clone, regardless of approved/finished — so they
    // can open and test it in the real app before it's published to anyone.
    const approvedOriginals = isAdmin ? originals : originals.filter(w => isWalkPublic(w));
    const eligibleClones = isAdmin ? clones : clones.filter(w => w.finished === true && isWalkPublic(w));

    // Group into families keyed by the original's id (the stable identity). For customers,
    // a family is also created for any family with an ACTIVE published version even when
    // its Walk sources are currently unpublished — the snapshot, not the source's flag, is
    // what decides a customer ever sees.
    const families = new Map(); // familyId -> { original, clones: [] }
    for (const o of approvedOriginals) families.set(o.id, { original: o, clones: [] });
    for (const c of eligibleClones) {
      const fid = c.clone_of;
      if (!families.has(fid)) families.set(fid, { original: null, clones: [] });
      families.get(fid).clones.push(c);
    }
    if (!isAdmin) {
      for (const fid of versionsByFamily.keys()) {
        if (!families.has(fid)) families.set(fid, { original: null, clones: [] });
      }
    }

    // Legacy-fallback visibility (plan §3): pairs still served from the legacy record
    // rather than a snapshot — logged once per call so the transition is observable and
    // the fallback can later be retired once DebugCatalogLog shows nobody needs it.
    const legacyFallbackPairs = [];
    const walks = [];
    for (const [familyId, fam] of families) {
      const metaOriginal = originalsById.get(familyId) || null;

      let out;
      let isDraftPreview = false;
      let served = null; // customer path: { lang, kind, content, version }

      if (isAdmin) {
        // ---- Admin draft preview: UNCHANGED behaviour (see header) — working records,
        // current edits included, drafts badged. Priority as before: a published clone
        // matching the caller's narration preference, then the approved English original,
        // then every other published clone alphabetically; for an ADMIN asking English the
        // master wins (so an admin testing the master is never shown an old English clone).
        const otherClones = [...fam.clones].sort((a, b) =>
          (a.target_language || '').localeCompare(b.target_language || ''));
        const adminWantsMaster = isAdmin && fam.original && String(narrationLang).toLowerCase() === 'english';
        const active =
          (adminWantsMaster ? fam.original : null) ||
          fam.clones.find(c => c.target_language === narrationLang) ||
          fam.original ||
          otherClones[0] ||
          null;
        if (!active) continue;
        out = { ...active };

        // Would this exact active record have made it through the normal, non-admin gate
        // above? If not, it's only here because the caller is an admin — mark it so the
        // frontend can badge it clearly as a draft, not a real published tour.
        const passesNormalGate = active.clone_of
          ? (active.finished === true && isWalkPublic(active))
          : isWalkPublic(active);
        isDraftPreview = isAdmin && !passesNormalGate;

        out._active_id = active.id;
        out._active_lang = active.target_language || 'English';
        out._available_langs = Array.from(new Set([
          ...(fam.original ? ['English'] : []),
          ...fam.clones.map(c => c.target_language).filter(Boolean),
        ]));
      } else {
        // ---- Customer: per-(family, language) pair, snapshot first, legacy fallback ----
        const snapshotLangs = versionsByFamily.get(familyId) || new Map();
        // The legacy records that would be served today, per language: published clones
        // newest-first (an English clone wins the English pair over the master, matching
        // both the pre-cutover catalogue and the migration), else the approved original.
        const legacyByLang = new Map();
        const eligibleSorted = [...fam.clones].sort((a, b) =>
          new Date(b.updated_date || 0).getTime() - new Date(a.updated_date || 0).getTime());
        for (const c of eligibleSorted) {
          const l = String(c.target_language || '').trim();
          if (l && !legacyByLang.has(l)) legacyByLang.set(l, c);
        }
        if (fam.original && !legacyByLang.has('English')) legacyByLang.set('English', fam.original);

        const langs = new Set([...snapshotLangs.keys(), ...legacyByLang.keys()]);
        if (langs.size === 0) continue;
        // Real priority list, same as before the cutover: the caller's narration
        // preference, then English, then every other available language alphabetically —
        // give up ONLY if nothing is published in any language at all.
        const order = [];
        for (const l of [narrationLang, 'English', ...[...langs].sort((a, b) => a.localeCompare(b))]) {
          if (!order.includes(l)) order.push(l);
        }
        for (const l of order) {
          const version = snapshotLangs.get(l);
          if (version) { served = { lang: l, kind: 'published', content: version.content || {}, version }; break; }
          const legacy = legacyByLang.get(l);
          if (legacy) { served = { lang: l, kind: 'legacy', content: legacy, version: null }; break; }
        }
        if (!served) continue;
        if (served.kind === 'legacy') {
          legacyFallbackPairs.push(`${metaOriginal ? (metaOriginal.code || familyId) : familyId}/${served.lang}`);
        }

        out = { ...served.content };
        out._active_lang = served.lang;
        if (served.kind === 'published') {
          // A published version is live by definition, whatever its source record's flags
          // say now (the source may have been edited or unpublished since) — this is what
          // keeps Home's listing filter and the frontend badges correct for customers.
          out.approved = true;
          // A new version auto-refreshes offline downloads: updated_date is the version's
          // publish time, and _active_id the version id, so an offline copy made from v1 is
          // replaced in the same slot the moment v2 is served (see offlineStorage.jsx's
          // marker-swap check).
          out.updated_date = served.version.published_at || served.version.status_changed_at || null;
          out._active_id = served.version.id;
        } else {
          out._active_id = served.content.id;
        }
        out._available_langs = [...langs].sort((a, b) => a.localeCompare(b));
      }

      // Stable identity: the catalog record's id IS the original's id, so the library, the
      // offline downloads and the "is it downloaded" check all key on a value that never
      // changes when the active language record swaps. The active record's own id is kept
      // aside in _active_id.
      out.id = familyId;
      out._family_id = familyId;
      out._is_draft_preview = isDraftPreview;

      // Pricing, checkout and product id belong to the ORIGINAL — a clone is never a separate
      // sellable product (point 1: one purchase per tour, not per language), and commerce is
      // always read live so a price change needs no republish.
      out.creem_product_id = metaOriginal?.creem_product_id ?? out.creem_product_id ?? null;
      out.price_eur = metaOriginal?.price_eur ?? out.price_eur;
      out.checkout_url = metaOriginal?.checkout_url ?? out.checkout_url;
      out.is_sample_walk = metaOriginal?.is_sample_walk ?? out.is_sample_walk ?? false;

      // Per Enda (follow-up 180): the map "icon"/marker for a walk must sit at WP1 (the
      // walk's own first waypoint), not at the free-typed/auto-derived start_lat/start_lng.
      // Those two fields can drift out of sync with the real route — handleRetryRouting
      // regenerates trail_path from the waypoints but never re-syncs start_lat/start_lng,
      // and the General tab also lets an admin free-type start_lat/start_lng directly — and
      // a stale value can put the marker on completely the wrong side of the island (the
      // concrete case that prompted this: "Kria Vrisi Flower Walk"). Enda judged that as
      // worse than the theoretical risk of a single start-point coordinate, and made this a
      // deliberate, explicit exception to the "no route data before purchase" rule: expose
      // ONLY this one computed point — never the full waypoints/trail_path arrays — for
      // every walk regardless of purchase status. Computed here, BEFORE the accessible gate
      // below, and deliberately kept off PROTECTED_FIELDS so it always survives that gate.
      const wp1 = (Array.isArray(out.waypoints) && out.waypoints[0])
        || (Array.isArray(out.trail_path) && out.trail_path[0])
        || null;
      out.marker_lat = wp1 ? wp1.lat : out.start_lat;
      out.marker_lng = wp1 ? wp1.lng : out.start_lng;

      // A draft never has a real Purchase record (nothing to buy yet), so without this an
      // admin previewing their own unpublished tour would hit the paywall and lose
      // trail_path/waypoints — exactly the content they need to actually test it.
      const accessible = out.is_sample_walk === true
        || !!(out.creem_product_id && ownedSet.has(out.creem_product_id))
        || isDraftPreview;
      if (!accessible) {
        // Allowlist enforcement (finding U1): drop everything not explicitly public —
        // never a delete-list again, so a future forgotten field can't re-open the leak.
        const allowed = new Set(PUBLIC_CATALOG_FIELDS);
        for (const k of Object.keys(out)) {
          if (!allowed.has(k)) delete out[k];
        }
      }
      out._accessible = accessible;
      walks.push(out);
    }

    if (!isAdmin && legacyFallbackPairs.length > 0) {
      try {
        await base44.asServiceRole.entities.DebugCatalogLog.create({
          note: `Legacy fallback serving (no active published version): ${legacyFallbackPairs.join(', ')}`,
        });
      } catch { /* logging must never break serving */ }
    }

    return Response.json({ walks });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}