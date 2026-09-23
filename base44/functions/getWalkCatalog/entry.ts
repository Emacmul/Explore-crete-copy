import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyEmailFromToken, isTokenGenuine } from '../../shared/wpToken.ts';
// Per Enda / Base44 support: retries a real 429 (pooled rate limit) with a short backoff —
// see withEntityRetry.ts's own header comment for the full reasoning. This is also the
// single most-loaded read in the app (every visitor's every app open), so it's worth this
// protection regardless of the narrator-specific concern that started this.
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';

// The walk catalogue, collapsed to one STABLE entry per tour (not per language).
//
// A translated tour is stored as its own Walk record (a "clone") pointing back to the
// original via `clone_of`. But a customer buys the EXPERIENCE once — which narration
// language plays is a preference, not a separate purchase — and their library and offline
// downloads are one slot per tour, never one per language. So this function collapses every
// tour family into a single record keyed by the ORIGINAL's id (the stable identity), filled
// with whichever language record is "active" for this caller right now:
//   1. a published clone (finished + approved) whose target_language matches the caller's
//      narration preference, if one exists; otherwise
//   2. the approved English original (only if it's currently published — a tour is never
//      hidden just because its English version is paused for edits); otherwise
//   3. every other published clone, alphabetically by language; otherwise
//   4. nothing — the tour is dropped ONLY if genuinely nothing is published in any language.
// The active record's CONTENT (name, narration, audio, route) is served; the original's
// identity, price, checkout link and creem product id are attached, so entitlement is "do you
// own the original of this family" and a language swap is a genuine replacement at the same
// stable id (downloads overwrite into the same slot, they don't orphan a second copy beside
// the first).
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
// driving player — before it's published to everyone. Previously the only way to do that
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
    const email = await verifyEmailFromToken(body.token, Deno.env.get('WC_SITE_URL'));
    const narrationLang = body.narrationLang || 'English';

    // Admin-only draft preview gate. Same AppUser.role lookup ensureAppUserOnboarding and
    // isAppAdmin/isSuperAdmin already use elsewhere — kept deliberately narrow to 'admin' and
    // 'super_admin' only, NOT 'narrator', per Enda's explicit instruction (follow-up 159).
    let isAdmin = false;
    let emailMatchedRow = false;
    if (email) {
      const appUserRows = await base44.asServiceRole.entities.AppUser.filter({ email });
      emailMatchedRow = Array.isArray(appUserRows) && appUserRows.length > 0;
      const role = (Array.isArray(appUserRows) ? appUserRows[0] : null)?.role;
      isAdmin = role === 'admin' || role === 'super_admin';
    }
    // Per Enda (2026-09-20): the Admin button (ensureAppUserOnboarding) finds an admin by WordPress
    // USER ID first, but this function only ever looked the caller up by the email inside the token.
    // If the token carries no email (or one that matches no AppUser row), a genuine admin was treated
    // as a customer and every draft tour was withheld ("0 of 0 DriveAbouts"). Fallback, only when the
    // email found no AppUser row, and only for a token WordPress itself confirms as genuine: identify
    // the AppUser by the user id in that token, the same way ensureAppUserOnboarding does. Ordinary
    // customers (whose email matches their row) skip this, so it adds no extra call for them.
    if (!isAdmin && body.token && !emailMatchedRow) {
      try {
        if (await isTokenGenuine(body.token, Deno.env.get('WC_SITE_URL'))) {
          const parts = String(body.token).split('.');
          const payload = parts.length === 3
            ? JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
            : null;
          const wpId = payload?.data?.user?.id || payload?.user_id || payload?.sub || null;
          if (wpId) {
            const byId = await base44.asServiceRole.entities.AppUser.filter({ user_id: String(wpId) });
            const role = (Array.isArray(byId) ? byId[0] : null)?.role;
            isAdmin = role === 'admin' || role === 'super_admin';
          }
        }
      } catch {
        // Could not confirm - stay non-admin (fail closed).
      }
    }

    // Owned product ids by email. Entitlement is decided HERE, by the ORIGINAL's product id
    // — a clone is never a separate sellable product, so owning the original grants every
    // language version of it.
    let ownedSet = new Set();
    if (email) {
      // A revoked purchase (refund/chargeback — see accessRevoker.ts) is kept in the table
      // but must not count as owned, or a refunded customer would keep the protected fields
      // below. Records from before that field existed have no status and are treated as active.
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: email });
      ownedSet = new Set(purchases.filter(p => p.status !== 'revoked').map(p => p.creem_product_id).filter(Boolean));
    }

    const all = await base44.asServiceRole.entities.Walk.list('-created_date', 1000);

    const originals = all.filter(w => !w.clone_of);
    const clones = all.filter(w => !!w.clone_of);
    const originalsById = new Map(originals.map(o => [o.id, o]));

    // A record reaches a customer when:
    //  - original: approved !== false
    //  - clone: finished === true AND approved !== false (only swap once finished + published)
    // An admin additionally sees every draft (see the header comment above) — every original
    // and every clone, regardless of approved/finished — so they can open and test it in the
    // real app before it's published to anyone else.
    const approvedOriginals = isAdmin ? originals : originals.filter(w => w.approved !== false);
    const eligibleClones = isAdmin ? clones : clones.filter(w => w.finished === true && w.approved !== false);

    // Group into families keyed by the original's id (the stable identity). `original` holds
    // the APPROVED original only — null when the English source is paused for edits or gone —
    // so a family can survive on its published clones alone. A tour never vanishes just
    // because its English version is mid-edit while another language is live and published.
    const families = new Map(); // familyId -> { original, clones: [] }
    for (const o of approvedOriginals) families.set(o.id, { original: o, clones: [] });
    for (const c of eligibleClones) {
      const fid = c.clone_of;
      if (!families.has(fid)) families.set(fid, { original: null, clones: [] });
      families.get(fid).clones.push(c);
    }

    const walks = [];
    for (const [familyId, fam] of families) {
      // Real priority list — never stop at the second step:
      //   1. a published clone matching the caller's narration preference
      //   2. the approved English original
      //   3. every other published clone, alphabetically by language
      //   4. give up ONLY if nothing is published in any language at all
      const otherClones = [...fam.clones].sort((a, b) =>
        (a.target_language || '').localeCompare(b.target_language || ''));
      // Per Enda (2026-09-20): a narrator's English "clone" of an English tour is a second English
      // version of the same tour, and it used to win over the master, so an admin testing the master
      // was shown the old copy. For an ADMIN asking for English, the master (when it exists) now wins.
      // Customers and every other language are unchanged.
      const adminWantsMaster = isAdmin && fam.original && String(narrationLang).toLowerCase() === 'english';
      const active =
        (adminWantsMaster ? fam.original : null) ||
        fam.clones.find(c => c.target_language === narrationLang) ||
        fam.original ||
        otherClones[0] ||
        null;
      if (!active) continue;

      const metaOriginal = originalsById.get(familyId) || null;

      const out = { ...active };
      // Stable identity: the catalog record's id IS the original's id, so the library, the
      // offline downloads and the "is it downloaded" check all key on a value that never
      // changes when the active language record swaps. The active record's own id is kept
      // aside in _active_id.
      out.id = familyId;
      out._family_id = familyId;
      out._active_id = active.id;
      out._active_lang = active.target_language || 'English';
      out._available_langs = Array.from(new Set([
        ...(fam.original ? ['English'] : []),
        ...fam.clones.map(c => c.target_language).filter(Boolean),
      ]));

      // Pricing, checkout and product id belong to the ORIGINAL — a clone is never a separate
      // sellable product (point 1: one purchase per tour, not per language).
      out.creem_product_id = metaOriginal?.creem_product_id ?? active.creem_product_id ?? null;
      out.price_eur = metaOriginal?.price_eur ?? active.price_eur;
      out.checkout_url = metaOriginal?.checkout_url ?? active.checkout_url;
      out.is_sample_walk = metaOriginal?.is_sample_walk ?? active.is_sample_walk ?? false;

      // Would this exact active record have made it through the normal, non-admin gate
      // above? If not, it's only here because the caller is an admin — mark it so the
      // frontend can badge it clearly as a draft, not a real published tour.
      const passesNormalGate = active.clone_of
        ? (active.finished === true && active.approved !== false)
        : (active.approved !== false);
      const isDraftPreview = isAdmin && !passesNormalGate;
      out._is_draft_preview = isDraftPreview;

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

    return Response.json({ walks });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}