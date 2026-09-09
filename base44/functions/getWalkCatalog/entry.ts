import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyEmailFromToken } from '../../shared/wpToken.ts';
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
const PROTECTED_FIELDS = [
  'trail_path',
  'trail_breaks',
  'waypoints',
  'segment_scripts',
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
    if (email) {
      const appUserRows = await base44.asServiceRole.entities.AppUser.filter({ email });
      const role = (Array.isArray(appUserRows) ? appUserRows[0] : null)?.role;
      isAdmin = role === 'admin' || role === 'super_admin';
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
      const active =
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

      // A draft never has a real Purchase record (nothing to buy yet), so without this an
      // admin previewing their own unpublished tour would hit the paywall and lose
      // trail_path/waypoints — exactly the content they need to actually test it.
      const accessible = out.is_sample_walk === true
        || !!(out.creem_product_id && ownedSet.has(out.creem_product_id))
        || isDraftPreview;
      if (!accessible) {
        for (const f of PROTECTED_FIELDS) delete out[f];
      }
      out._accessible = accessible;
      walks.push(out);
    }

    return Response.json({ walks });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}