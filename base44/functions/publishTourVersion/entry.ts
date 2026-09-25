import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';
// The strict audio-readiness gate, shared with saveWalkForBackend — one definition, so
// a publish and a live save can never disagree about "could a customer play this".
import { collectAudioReadinessIssues } from '../../shared/walkReadiness.ts';
import {
  buildVersionContent, isLanguageSupported, normalizeActiveVersion, nextVersionNumber,
} from '../../shared/publishedTours.ts';

// Publish a new customer-facing version of one tour in one language (published-versions
// plan). Admins/Super Admins only. Takes a SOURCE Walk record (the English master, or a
// narrator's submitted translation clone), validates it, and freezes an immutable
// snapshot into a new PublishedTour version that becomes the active one for its
// (family, language) pair.
//
// Writes NOTHING to any Walk record — the source stays a working copy for its editor.
//
// Interrupt safety (see shared/publishedTours.ts): the new version is created ACTIVE
// first, and only then are the pair's other active versions retired (one bulk write).
// A crash between the two can only ever leave the NEW version serving (the latest
// status_changed_at — exactly the intended outcome); the leftover older active is
// retired by the normalization that opens the next publish/rollback.
//
// The real-app preview stays a human step: preview_confirmed is required (the publish
// dialog records it), and it is stored with the version's notes.
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor || actor.kind !== 'admin') {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const { source_walk_id, preview_confirmed } = body || {};
    if (!source_walk_id) {
      return Response.json({ error: 'source_walk_id is required.' }, { status: 400 });
    }
    if (preview_confirmed !== true) {
      return Response.json({
        error: 'The real-app preview must be confirmed before publishing — open the tour in the app, test it, then confirm in the publish dialog.',
      }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    const source = await svc.entities.Walk.get(String(source_walk_id)).catch(() => null);
    if (!source) {
      return Response.json({ error: 'Walk not found.' }, { status: 404 });
    }

    let familyId: string;
    let language: string;
    if (source.clone_of) {
      // Translation version: the clone must be submitted (finished) and assigned.
      const original = await svc.entities.Walk.get(String(source.clone_of)).catch(() => null);
      if (!original) {
        return Response.json({ error: 'The original tour of this clone no longer exists.' }, { status: 400 });
      }
      familyId = original.id;
      language = String(source.target_language || '').trim();
      if (!language) {
        return Response.json({ error: 'This clone has no target language set.' }, { status: 400 });
      }
      if (source.finished !== true) {
        return Response.json({ error: 'This translation clone has not been submitted for review yet (not marked finished).' }, { status: 400 });
      }
      if (!source.assigned_narrator_email) {
        return Response.json({ error: 'This clone has no assigned narrator.' }, { status: 400 });
      }
    } else {
      // English version: the master must be admin-completed.
      familyId = source.id;
      language = 'English';
      if (source.admin_completed !== true) {
        return Response.json({ error: 'The English master must be marked Admin Completed before it can be published.' }, { status: 400 });
      }
    }

    if (!isLanguageSupported(language)) {
      return Response.json({ error: `"${language}" is not one of the app's supported languages.` }, { status: 400 });
    }

    // The strict publish gate — final PCV audio on every triggered waypoint, and every
    // spoken system alert for driving tours. Nothing reaches customers failing it.
    const issues = collectAudioReadinessIssues(source);
    if (issues.notReady.length > 0) {
      return Response.json({
        error: `Cannot publish — ${issues.notReady.length} waypoint(s) still have the AI draft narration or no usable final audio clip. Use "Update Audio" to replace them with the final PCV narration first.`,
      }, { status: 400 });
    }
    if (issues.missingSystemAudio.length > 0) {
      return Response.json({
        error: `Cannot publish — ${issues.missingSystemAudio.length} system voice message(s) (off-route/GPS/speed alerts) still need their PCV audio file imported.`,
      }, { status: 400 });
    }

    const version_number = await nextVersionNumber(svc, familyId, language);
    const now = new Date().toISOString();
    const publisher = String(body?.email || 'admin (Base44 session)');

    // Rule 1 — activate before retire: the new version is born ACTIVE (one atomic write).
    const created = await svc.entities.PublishedTour.create({
      source_walk_id: source.id,
      family_id: familyId,
      family_code: source.code || '',
      language,
      version_number,
      status: 'active',
      status_changed_at: now,
      published_at: now,
      published_by_email: publisher,
      content: buildVersionContent(source),
      description: `Published by ${publisher}; real-app preview confirmed before publishing.`,
    });

    // Rule 4 — retire every other active version for THIS pair only (single bulk write).
    // Also self-heals any leftover anomaly from a previously interrupted action.
    const retired = await normalizeActiveVersion(svc, familyId, language, created.id);

    return Response.json({
      ok: true,
      published: {
        id: created.id,
        family_id: familyId,
        family_code: created.family_code,
        language,
        version_number,
        status: 'active',
      },
      retired_previous: retired,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}