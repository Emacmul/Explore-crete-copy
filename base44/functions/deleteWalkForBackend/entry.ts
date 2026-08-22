import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// Deletes a walk. Full, unrestricted delete stays Admin-only, same as before.
//
// Per Enda: a narrator (or an admin wearing the Narr hat, who already has full
// delete rights below since they resolve as 'admin' — see backendActor.ts)
// needs a way to abandon their own translation clone and start it over from
// scratch, e.g. after a bad mistake. So a narrator actor is now ALSO allowed
// to delete, but only ever their own clone, and only while it's still not yet
// approved/live — never a master tour, never someone else's clone, never a
// tour a customer might already be relying on. Deleting the clone is also
// what makes the master tour clonable again — cloneWalkForBackend's
// "already cloned this once" check only ever looks at LIVE Walk rows, so once
// this row is gone, nothing extra needs doing to unlock a fresh clone.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { id } = body || {};
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    if (actor.kind !== 'admin') {
      const walk = await base44.asServiceRole.entities.Walk.get(String(id));
      if (!walk) {
        return Response.json({ error: 'Tour not found.' }, { status: 404 });
      }
      if (!walk.clone_of) {
        return Response.json({ error: 'Only a translation clone can be deleted here, never a master tour.' }, { status: 403 });
      }
      if ((walk.assigned_narrator_email || '').toLowerCase() !== actor.email.toLowerCase()) {
        return Response.json({ error: 'You can only delete your own translation clone.' }, { status: 403 });
      }
      if (walk.approved) {
        return Response.json({ error: 'This translation is already live for customers — ask an Admin to remove it.' }, { status: 409 });
      }
    }

    const result = await base44.asServiceRole.entities.Walk.delete(String(id));
    if (result && result.success === false) {
      return Response.json({ error: 'The server did not confirm this delete.' }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
