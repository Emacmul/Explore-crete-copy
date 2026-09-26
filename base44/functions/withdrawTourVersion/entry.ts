import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';
// Per-(master tour, language) mutual exclusion — see shared/publishLock.ts. A withdraw
// racing a publish/rollback on the same pair must serialize, exactly like every other
// state change for the pair.
import { acquirePairLock, releasePairLock } from '../../shared/publishLock.ts';

// Withdraw one (family, language) pair from customers (published-versions plan): retires
// the pair's ACTIVE published version(s) — the Admin panel's "Unpublish" for the new
// snapshot model. Admins/Super Admins only.
//
// Scoped to ONE pair, exactly like rollback: no other language's active version is
// touched, no Walk record is written (the caller keeps the source record's display flags
// in sync separately, which also closes the legacy fallback so a withdrawn pair doesn't
// reappear through the pre-cutover path), and no version row is ever deleted — a
// withdrawn version stays retired, so it can be rolled back to (or re-published over)
// later. Under the pair lock, a crash mid-way can only leave too many actives (repaired
// by the next publish/rollback normalization), never a silent half-state.
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor || actor.kind !== 'admin') {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { family_id, language } = body || {};
    if (!family_id || !language) {
      return Response.json({ error: 'family_id and language are required.' }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    const lockToken = await acquirePairLock(svc, String(family_id), String(language));
    if (!lockToken) {
      return Response.json({
        error: 'Another publish or rollback for this tour and language is still in progress — wait a few seconds and try again.',
      }, { status: 409 });
    }
    try {
      const actives = await svc.entities.PublishedTour.filter({
        family_id: String(family_id),
        language: String(language),
        status: 'active',
      });
      const rows = Array.isArray(actives) ? actives : [];
      if (rows.length === 0) {
        return Response.json({
          ok: true,
          withdrawn: 0,
          note: 'No active published version for this tour and language — nothing to withdraw.',
        });
      }
      const now = new Date().toISOString();
      await svc.entities.PublishedTour.bulkUpdate(
        rows.map((v: any) => ({ id: v.id, status: 'retired', status_changed_at: now })),
      );
      return Response.json({
        ok: true,
        withdrawn: rows.length,
        withdrawn_versions: rows.map((v: any) => ({ id: v.id, version_number: v.version_number })),
      });
    } finally {
      await releasePairLock(svc, String(family_id), String(language), lockToken);
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}