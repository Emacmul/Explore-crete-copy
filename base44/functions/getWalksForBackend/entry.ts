import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { pickNarratorReadableWalk } from '../../shared/narratorWalkFields.ts';

// Returns the walk list for the back end (Admin Panel / Narr Studio), scoped to
// who's actually asking. Replaces the old client-side entities.Walk.list() call,
// which sent the ENTIRE table — every master, every narrator's clone, every
// field including trail_path/waypoints/segment_scripts — to any narrator's
// browser and relied on React alone to hide the rest.
//
// admin actor (native, promoted, or admin-wearing-the-Narr-hat) -> the full
//   list, unrestricted — same as before.
// narrator actor -> three groups merged into one array so the existing
//   client-side derived state (cloneableTours / myClones / publishedLanguagesByMaster
//   in BackendShell.jsx) keeps working unchanged:
//   - cloneable masters, trimmed to just enough for the "pick a tour to
//     clone" list — no trail_path/waypoints/segment_scripts for tours they
//     don't own.
//   - their own clone(s) — trimmed to NARRATOR_WALK_READ_FIELDS /
//     NARRATOR_WAYPOINT_READ_FIELDS (see narratorWalkFields.ts), not sent in
//     full any more. Per Enda's follow-up 47 report: hiding General/Route
//     Path/Waypoints as TABS (follow-up 46) never stopped this function
//     itself sending a narrator's own clone back COMPLETE — every field,
//     including region/difficulty/distance_km/price_eur/approved/etc. — so
//     the old tab-hiding was only ever hiding a UI button, not the
//     underlying data, and it was sitting in the browser regardless (visible
//     to anyone who opened dev tools). This is the actual boundary; the tabs
//     are just what stops a narrator navigating to it in the normal UI.
//   - every OTHER clone, redacted to just the fields needed to compute
//     "which languages already have a published translation of this master"
//     (clone_of/target_language/finished/approved/id) — enough to keep that
//     dedupe check correct without leaking other narrators' unpublished work.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor) return Response.json({ error: 'Not authorized' }, { status: 403 });

    const all = await base44.asServiceRole.entities.Walk.list('-created_date');

    if (actor.kind === 'admin') {
      return Response.json({ walks: all });
    }

    const email = actor.email.toLowerCase();

    const masters = all
      .filter((w) => !w.clone_of)
      .map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        tour_category: w.tour_category,
        region: w.region,
        // Without this, a narrator's own "Clone a tour to translate" list
        // (cloneableTours in BackendShell.jsx, which filters on this field) would
        // always come back empty — every master tour would look un-clonable to
        // every real narrator, even one an Admin has genuinely marked ready. An
        // admin-wearing-the-Narr-hat session never hit this bug, since it takes
        // the `actor.kind === 'admin'` branch above and gets the full,
        // unredacted `all` list instead.
        admin_completed: w.admin_completed,
      }));

    const ownClones = all
      .filter((w) => w.clone_of && (w.assigned_narrator_email || '').toLowerCase() === email)
      .map(pickNarratorReadableWalk);

    const otherClonesMeta = all
      .filter((w) => w.clone_of && (w.assigned_narrator_email || '').toLowerCase() !== email)
      .map((w) => ({
        id: w.id,
        clone_of: w.clone_of,
        target_language: w.target_language,
        finished: w.finished,
        approved: w.approved,
      }));

    return Response.json({ walks: [...masters, ...ownClones, ...otherClonesMeta] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
