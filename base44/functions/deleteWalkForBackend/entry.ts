import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// Deletes a walk. Admin-only — narrators have never had a delete control in
// the UI, and this is where that actually gets enforced rather than assumed.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor || actor.kind !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { id } = body || {};
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
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
