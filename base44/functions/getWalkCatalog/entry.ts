import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyEmailFromToken } from '../../shared/wpToken.ts';

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
    const email = await verifyEmailFromToken(body.token);
    const narrationLang = body.narrationLang || 'English';

    // Owned product ids by email. Entitlement is decided HERE, by the ORIGINAL's product id
    // — a clone is never a separate sellable product, so owning the original grants every
    // language version of it.
    let ownedSet = new Set();
    if (email) {
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: email });
      ownedSet = new Set(purchases.map(p => p.creem_product_id).filter(Boolean));
    }

    const all = await base44.asServiceRole.entities.Walk.list('-created_date', 1000);

    const originals = all.filter(w => !w.clone_of);
    const clones = all.filter(w => !!w.clone_of);
    const originalsById = new Map(originals.map(o => [o.id, o]));

    // A record reaches a customer when:
    //  - original: approved !== false
    //  - clone: finished === true AND approved !== false (only swap once finished + published)
    const approvedOriginals = originals.filter(w => w.approved !== false);
    const eligibleClones = clones.filter(w => w.finished === true && w.approved !== false);

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

      const accessible = out.is_sample_walk === true || !!(out.creem_product_id && ownedSet.has(out.creem_product_id));
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