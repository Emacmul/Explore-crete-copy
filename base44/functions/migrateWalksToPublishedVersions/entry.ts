import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';
import { isWalkPublic } from '../../shared/walkPublish.ts';
import {
  buildVersionContent, hashRecord, isLanguageSupported,
  normalizeActiveVersion, nextVersionNumber, resolveActiveVersion, sha256Hex,
} from '../../shared/publishedTours.ts';

// One-time idempotent backfill (published-versions plan): creates a v1 PublishedTour
// snapshot for every (tour, language) pair that is live for customers TODAY, so the
// cutover of readers can switch to snapshots with zero change in what anyone sees.
// Admins only. Re-runnable: a pair that already has an active version is skipped.
//
// PER TOUR AND PER LANGUAGE: each pair is snapshotted independently — the English pair
// from the published original (or the newest published English clone, matching today's
// customer priority), each translation pair from its own published clone. One language's
// snapshot never touches another's.
//
// Snapshots CURRENT REALITY — no readiness gate here, by design: legacy tours carry
// grandfathered draft audio that customers are served today, and the backfill must
// reproduce exactly what is live (the strict gate applies to every FUTURE publish via
// publishTourVersion, not to describing the present).
//
// Writes NOTHING to any Walk record — proven by hashing every Walk record before and
// after and returning both hashes in the response (equal = untouched).
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor || actor.kind !== 'admin') {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }
    const svc = base44.asServiceRole;

    const before = await svc.entities.Walk.list('-created_date', 1000);
    const beforeRows = Array.isArray(before) ? before : [];

    const originals = beforeRows.filter((w: any) => !w.clone_of);
    const clones = beforeRows.filter((w: any) => !!w.clone_of);
    const families = new Map(); // familyId -> { original, clones }
    for (const o of originals) families.set(o.id, { original: o, clones: [] });
    for (const c of clones) {
      if (!families.has(c.clone_of)) families.set(c.clone_of, { original: null, clones: [] });
      families.get(c.clone_of).clones.push(c);
    }

    const created: any[] = [];
    const skipped: any[] = [];
    const migrated = new Set(); // "familyId||language" pairs that got a v1 this run

    for (const [familyId, fam] of families) {
      // Build the per-pair source list: every language that has a live record today.
      const pairs = new Map(); // language -> source Walk record
      const eligibleClones = (fam.clones || []).filter((c: any) => c && c.finished === true && isWalkPublic(c));
      for (const c of eligibleClones) {
        const lang = String(c.target_language || '').trim();
        if (!lang) continue;
        const current = pairs.get(lang);
        if (!current || new Date(c.updated_date || 0).getTime() > new Date(current.updated_date || 0).getTime()) {
          pairs.set(lang, c);
        }
      }
      if (fam.original && isWalkPublic(fam.original) && !pairs.has('English')) {
        pairs.set('English', fam.original); // an eligible English clone already won the pair above
      }

      for (const [language, source] of pairs) {
        if (!isLanguageSupported(language)) {
          skipped.push({ family_id: familyId, language, reason: 'language not supported by the app' });
          continue;
        }
        const existing = await resolveActiveVersion(svc, familyId, language);
        if (existing.version) {
          skipped.push({
            family_id: familyId, language,
            reason: 'already has an active published version',
            existing: { id: existing.version.id, version_number: existing.version.version_number },
          });
          continue;
        }
        const version_number = await nextVersionNumber(svc, familyId, language);
        const now = new Date().toISOString();
        const rec = await svc.entities.PublishedTour.create({
          source_walk_id: source.id,
          family_id: familyId,
          family_code: source.code || '',
          language,
          version_number,
          status: 'active',
          status_changed_at: now,
          published_at: now,
          published_by_email: String(body?.email || 'admin (Base44 session)'),
          content: buildVersionContent(source),
          description: 'Backfilled v1 snapshot of the live record at migration time.',
        });
        // Rule 4 defensive normalization: exactly one active for the pair even if a
        // previously interrupted run had left a stray.
        const retired_extra = await normalizeActiveVersion(svc, familyId, language, rec.id);
        created.push({ family_id: familyId, family_code: rec.family_code, language, version_number, id: rec.id, retired_extra });
        migrated.add(`${familyId}||${language}`);
      }
    }

    // Proof the source records are untouched: hash every Walk record again and compare.
    const after = await svc.entities.Walk.list('-created_date', 1000);
    const afterRows = Array.isArray(after) ? after : [];
    const beforeHashes = (await Promise.all(beforeRows.map((w: any) => hashRecord(w)))).sort();
    const afterHashes = (await Promise.all(afterRows.map((w: any) => hashRecord(w)))).sort();
    const walk_hash_before = await sha256Hex(beforeHashes.join('\n'));
    const walk_hash_after = await sha256Hex(afterHashes.join('\n'));

    return Response.json({
      ok: true,
      walk_records: beforeRows.length,
      families_total: families.size,
      versions_created: created,
      versions_created_count: created.length,
      skipped,
      walk_hash_before,
      walk_hash_after,
      walks_unchanged: walk_hash_before === walk_hash_after && beforeRows.length === afterRows.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}