import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// Creates a translation clone of a master tour. Replaces BackendShell.jsx's
// handleCloneTour, which built the clone object client-side and called
// entities.Walk.create directly — every check below existed there too, but
// only as a client-side convenience; here they're the actual gate.
//
// A Narrator may only have ONE clone in progress at a time (per narrator, not
// per master — a different narrator can clone the same master concurrently
// into a different language). "In progress" means finished !== true — the
// lock releases the moment they mark their clone finished and send it to an
// Admin, not only once an Admin has also approved/published it.
//
// Admins (native, promoted, or wearing the Narr hat) are exempt from that
// limit entirely and may clone at any time.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor) return Response.json({ error: 'Not authorized' }, { status: 403 });

    const { originalId, targetLanguage } = body || {};
    const lang = String(targetLanguage || '').trim();
    if (!originalId || !lang) {
      return Response.json({ error: 'originalId and targetLanguage are required' }, { status: 400 });
    }


    const original = await base44.asServiceRole.entities.Walk.get(String(originalId));
    if (!original) {
      return Response.json({ error: 'Tour not found.' }, { status: 404 });
    }
    // Only a master may be cloned — never clone a clone.
    if (original.clone_of) {
      return Response.json({ error: 'This tour is itself a translation — clone the original instead.' }, { status: 400 });
    }

    // Per Enda: a narrator may only clone a master tour the Admin has explicitly
    // marked "admin completed" — fully finished editing, ready to hand to a
    // narrator. This is deliberately unrelated to `approved` (published/live for
    // customers) — a tour can be ready for translation long before it's ready to
    // go live. cloneableTours in BackendShell.jsx already keeps an unmarked tour
    // out of the "Clone a tour to translate" list; this is the real, unbypassable
    // gate behind that. Admins (native, promoted, or wearing the Narr hat) are
    // exempt, same as the active-clone-limit check below — an Admin may always
    // clone anything, e.g. to test a tour before marking it ready.
    if (actor.kind === 'narrator' && !original.admin_completed) {
      return Response.json({ error: 'This tour is not marked "Admin Completed" yet — ask an Admin to finish editing and mark it ready before it can be translated.' }, { status: 409 });
    }

    // Who does this clone belong to? Prefer the Narr Studio session email
    // (covers both real narrators and admin-wearing-the-Narr-hat); fall back
    // to the caller's real Base44 identity for a native admin.
    let ownerEmail = (body?.email ? String(body.email) : '').trim().toLowerCase();
    if (!ownerEmail) {
      try {
        const me = await base44.auth.me();
        ownerEmail = (me?.email || '').toLowerCase();
      } catch { /* no real Base44 session either — leave unassigned */ }
    }

    const allClonesOfThis = await base44.asServiceRole.entities.Walk.filter({ clone_of: original.id });

    if (actor.kind === 'narrator') {
      // Per narrator, across ANY master — not just this one. A different
      // narrator cloning this same master concurrently is fine; this
      // narrator having any other unfinished clone, of anything, is not.
      const theirClones = await base44.asServiceRole.entities.Walk.filter({
        assigned_narrator_email: actor.email.toLowerCase(),
      });
      const hasActiveClone = theirClones.some((w: any) => w.clone_of && !w.finished);
      if (hasActiveClone) {
        return Response.json({ error: 'Finish your current translation before starting another.' }, { status: 409 });
      }
    }

    const alreadyPublished = allClonesOfThis.some(
      (w: any) => w.finished && w.approved && (w.target_language || '').toLowerCase() === lang.toLowerCase()
    );
    if (alreadyPublished) {
      return Response.json({ error: `A finished, published ${lang} version already exists for this tour.` }, { status: 409 });
    }

    const clone = {
      ...original,
      id: undefined,
      created_date: undefined,
      updated_date: undefined,
      created_by_id: undefined,
      code: `${original.code}-${lang}`,
      name: `${original.name} (${lang})`,
      clone_of: original.id,
      target_language: lang,
      assigned_narrator_email: ownerEmail || undefined,
      finished: false,
      approved: false,
      admin_completed: false,
      requires_review: false,
      is_sample_walk: false,
      creem_product_id: undefined,
      pushback_reason: '',
      trail_path: (original.trail_path || []).map((p: any) => ({ ...p })),
      waypoints: (original.waypoints || []).map((w: any) => ({ ...w })),
      segment_scripts: (original.segment_scripts || []).map((s: any) => ({ ...s })),
    };

    const saved = await base44.asServiceRole.entities.Walk.create(clone);
    return Response.json({ ok: true, walk: saved });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
