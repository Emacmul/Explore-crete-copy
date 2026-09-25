import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { normalizeActiveVersion } from '../../shared/publishedTours.ts';
// Per-(master tour, language) mutual exclusion — see shared/publishLock.ts's header
// for the zero-actives race this closes (concurrency fix, 2026-09-25).
import { acquirePairLock, releasePairLock } from '../../shared/publishLock.ts';

// Roll a (family, language) pair back to a previously retired version (published-versions
// plan). Admins/Super Admins only. Scoped to ONE pair: no other language's active
// version, no source Walk record, no entitlement or offline slot is touched, and the
// rolled-back-FROM version is retired, never deleted.
//
// Interrupt safety (see shared/publishedTours.ts): the target is written ACTIVE first
// (one atomic write), and only then are the pair's other actives retired (one bulk
// write). A crash between the two leaves the target serving (latest status_changed_at) —
// exactly the intended outcome — and the leftover older active is retired by the next
// publish/rollback's normalization.
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor || actor.kind !== 'admin') {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { published_tour_id } = body || {};
    if (!published_tour_id) {
      return Response.json({ error: 'published_tour_id is required.' }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    const target = await svc.entities.PublishedTour.get(String(published_tour_id)).catch(() => null);
    if (!target) {
      return Response.json({ error: 'Published version not found.' }, { status: 404 });
    }
    if (!target.family_id || !target.language) {
      return Response.json({ error: 'This version is missing its family/language pair and cannot be rolled back to.' }, { status: 400 });
    }

    // Concurrency fix (2026-09-25): per-(master tour, language) mutual exclusion —
    // see publishTourVersion's identical block and shared/publishLock.ts. A rollback
    // racing a publish on the same pair could otherwise retire the publish's fresh
    // active row while the publish retired the rollback's target, ending with zero
    // actives; under the lock, one fully completes before the other starts.
    const lockToken = await acquirePairLock(svc, target.family_id, target.language);
    if (!lockToken) {
      return Response.json({
        error: 'Another publish or rollback for this tour and language is still in progress — wait a few seconds and try again.',
      }, { status: 409 });
    }
    try {
      // Rule 1 — activate the target FIRST (single atomic write), stamping a fresh
      // status_changed_at so the tie-break always sees the rollback as the newest state.
      await svc.entities.PublishedTour.update(target.id, {
        status: 'active',
        status_changed_at: new Date().toISOString(),
      });

      // Rule 4 — retire every OTHER active version for this pair only (single bulk write).
      const retired = await normalizeActiveVersion(svc, target.family_id, target.language, target.id);

      return Response.json({
        ok: true,
        rolled_back_to: {
          id: target.id,
          family_id: target.family_id,
          family_code: target.family_code || '',
          language: target.language,
          version_number: target.version_number,
          status: 'active',
        },
        retired_others: retired,
      });
    } finally {
      await releasePairLock(svc, target.family_id, target.language, lockToken);
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}