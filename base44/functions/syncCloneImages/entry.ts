// syncCloneImages — one-click image sync for Admins (2026-10-12, Enda).
//
// Pushes the MASTER tour's current waypoint photos into EVERY clone of it —
// in-progress or already finished/submitted — without the Admin having to re-save
// the master to trigger the automatic propagation that fires on every save. This is
// the manual twin of propagateWaypointImages in shared/waypointImageSync.ts; see
// that module for why images are admin-owned master content that propagates to all
// clones regardless of their editing state.
//
// Admin-only (any admin role), like every other master-tour action. Idempotent:
// clones whose images already match the master are skipped, so repeated clicks are
// free. Returns { touched, clone_count } so the UI can say "pushed to N of M
// clones" — touched < clone_count just means the rest already matched.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';
import { propagateWaypointImages } from '../../shared/waypointImageSync.ts';

export default async function(req) {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor) return Response.json({ error: 'Not authorized' }, { status: 403 });
    if (actor.kind !== 'admin') {
      return Response.json({ error: 'Only Admins can sync images to clones.' }, { status: 403 });
    }

    const walkId = String(body?.walk_id || '');
    if (!walkId) return Response.json({ error: 'walk_id is required' }, { status: 400 });

    const master = await base44.asServiceRole.entities.Walk.get(walkId);
    if (!master) return Response.json({ error: 'Tour not found.' }, { status: 404 });
    if (master.clone_of) {
      return Response.json({ error: 'This tour is itself a translation clone — image sync always runs from the master (English original) tour.' }, { status: 400 });
    }

    const clones = await base44.asServiceRole.entities.Walk.filter({ clone_of: master.id });
    const touched = await propagateWaypointImages(base44, master);
    return Response.json({ ok: true, touched, clone_count: clones.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}