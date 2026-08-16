import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getEmailFromToken } from '../../shared/wpToken.ts';

// The walk catalogue, collapsed to one STABLE entry per tour (not per language).
//
// A translated tour is stored as its own Walk record (a "clone") pointing back to the
// original via `clone_of`. A customer buys the EXPERIENCE once — which narration language
// plays is a preference, not a separate purchase — and their library and offline downloads
// are one slot per tour, never one per language.
//
// IMPORTANT — language selection is opt-in, never automatic. Earlier versions of this
// function picked whichever language best matched the customer's narration preference and
// served it silently, re-deciding on every load. That's no longer how this works: once a
// customer has ever seen a tour, their language choice is locked in a TourLanguagePref
// record and stays exactly as it is, indefinitely, until they explicitly accept a swap —
// never presented as a fait accompli. If a better-matching language becomes available later,
// this function reports it as a *pending offer* (`_swap_offer`), for the front end to ask
// the customer directly. Nothing changes until they say yes.
//
// The very first time a customer ever accesses a given tour, there is nothing to swap FROM
// yet — a starting default is picked (narration preference match, else English, else
// alphabetical) and locked in immediately as their `accepted_language`. That one-time default
// pick is not a "swap" in the opt-in sense; there's no prior state being silently overridden.

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
    const narrationLang = body.narrationLang || 'English';

    // Owned product ids by email. Entitlement is decided HERE, by the ORIGINAL's product id
    // — a clone is never a separate sellable product, so owning the original grants every
    // language version of it.
    let ownedSet = new Set();
    if (email) {
      const purchases = await base44.asServiceRole.entities.Purchase.filter({ buyer_email: email });
      ownedSet = new Set(purchases.map(p => p.creem_product_id).filter(Boolean));
    }

    // This customer's locked language choice per tour family, keyed by walk_id. Loaded once,
    // up front, so resolving each family below doesn't need a query per tour.
    const prefsByWalkId = new Map();
    if (email) {
      const prefs = await base44.asServiceRole.entities.TourLanguagePref.filter({ buyer_email: email });
      for (const p of prefs) prefsByWalkId.set(p.walk_id, p);
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
    // so a family can survive on its published clones alone.
    const families = new Map(); // familyId -> { original, clones: [] }
    for (const o of approvedOriginals) families.set(o.id, { original: o, clones: [] });
    for (const c of eligibleClones) {
      const fid = c.clone_of;
      if (!families.has(fid)) families.set(fid, { original: null, clones: [] });
      families.get(fid).clones.push(c);
    }

    // Pending TourLanguagePref writes, applied after the read pass (never mutate while
    // iterating the map we're reading from).
    const prefWrites = [];

    const walks = [];
    for (const [familyId, fam] of families) {
      const byLanguage = new Map();
      if (fam.original) byLanguage.set('English', fam.original);
      for (const c of fam.clones) {
        if (c.target_language) byLanguage.set(c.target_language, c);
      }
      if (byLanguage.size === 0) continue; // nothing published in any language at all

      const otherClones = [...fam.clones].sort((a, b) =>
        (a.target_language || '').localeCompare(b.target_language || ''));
      // The default pick if this customer has no locked choice yet, or if their locked
      // choice is no longer available (e.g. temporarily unpublished) — same priority order
      // as before, just now only used as a fallback, never a silent override of an existing
      // choice.
      const defaultPick =
        fam.clones.find(c => c.target_language === narrationLang) ||
        fam.original ||
        otherClones[0] ||
        null;
      if (!defaultPick) continue;

      const existingPref = prefsByWalkId.get(familyId);
      let active;
      let swapOffer = null;

      if (existingPref && existingPref.accepted_language && byLanguage.has(existingPref.accepted_language)) {
        // Locked choice exists and is still available — always honored, regardless of
        // narration preference. This is the entire point: nothing changes without consent.
        active = byLanguage.get(existingPref.accepted_language);

        // Is there something better to OFFER (not apply)? Only if it's a genuinely different
        // language than what they're locked to, and not something they've already declined.
        const declined = new Set((existingPref.declined_languages || '').split(',').map(s => s.trim()).filter(Boolean));
        const candidate = byLanguage.get(narrationLang);
        if (candidate && narrationLang !== existingPref.accepted_language && !declined.has(narrationLang)) {
          swapOffer = { language: narrationLang };
        }
      } else if (existingPref && existingPref.accepted_language) {
        // Their locked language exists as a record but isn't currently available (e.g. the
        // clone was unpublished again) — fall back for THIS load only. Their actual stored
        // choice is left untouched; if that language comes back, they'll see it again with
        // no action needed, since nothing about their real preference was changed.
        active = defaultPick;
      } else {
        // First time this customer has ever reached this tour — nothing to swap from yet,
        // so there's no consent question to ask. Pick the sensible default and lock it in
        // as their starting point.
        active = defaultPick;
        const startingLang = active === fam.original ? 'English' : (active.target_language || 'English');
        prefWrites.push({ buyer_email: email, walk_id: familyId, accepted_language: startingLang });
      }

      const metaOriginal = originalsById.get(familyId) || null;

      const out = { ...active };
      out.id = familyId;
      out._family_id = familyId;
      out._active_id = active.id;
      out._active_lang = active === fam.original ? 'English' : (active.target_language || 'English');
      out._available_langs = Array.from(byLanguage.keys());
      out._swap_offer = swapOffer;

      // Pricing, checkout and product id belong to the ORIGINAL — a clone is never a separate
      // sellable product (one purchase per tour, not per language).
      out.creem_product_id = metaOriginal?.creem_product_id ?? active.creem_product_id ?? null;
      out.price_eur = metaOriginal?.price_eur ?? active.price_eur;
      out.checkout_url = metaOriginal?.checkout_url ?? active.checkout_url;
      out.is_sample_walk = metaOriginal?.is_sample_walk ?? active.is_sample_walk ?? false;

      const accessible = out.is_sample_walk === true || !!(out.creem_product_id && ownedSet.has(out.creem_product_id));
      if (!accessible) {
        for (const f of PROTECTED_FIELDS) delete out[f];
        out._swap_offer = null; // never offer a language swap on something they don't own
      }
      out._accessible = accessible;
      walks.push(out);
    }

    // Apply the first-time-default locks now, after the read pass — only for tours the
    // customer actually owns (or is a free sample of), so browsing the public catalogue
    // before ever buying anything doesn't create preference records for things not owned.
    if (email && prefWrites.length) {
      const accessibleFamilyIds = new Set(walks.filter(w => w._accessible).map(w => w.id));
      for (const w of prefWrites) {
        if (accessibleFamilyIds.has(w.walk_id)) {
          await base44.asServiceRole.entities.TourLanguagePref.create(w);
        }
      }
    }

    return Response.json({ walks });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
