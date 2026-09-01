import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// The shared narration-source depository — per Enda: an admin used to have to email
// every narrator each waypoint's master .odt individually (12-13 emails per tour, and a
// real chance of a narrator working from a stale local copy). Now the admin's master
// Walk carries its own `import_files` list (segment_id -> uploaded file), and a
// narrator's clone reaches it here instead of anyone attaching anything.
//
// Three actions:
//   'upload' — admin only. Stores the file (same base44 file-storage call every other
//              upload in this app already uses) and upserts one entry into the MASTER
//              tour's `import_files` by segment_id (replacing any earlier file for that
//              same waypoint). Fired automatically the moment a waypoint is marked Done
//              (see DrivingTourWaypointEditor.jsx) — no separate admin action needed for
//              the normal case; also callable for a manual re-upload/correction.
//   'remove' — admin only. Drops one segment_id's entry.
//   'get'    — admin OR narrator (their own clone only). Looks up one segment_id's file.
//              If the walk being asked about is itself a translation clone, this reads
//              its MASTER's import_files (that's where an admin uploads originals) —
//              otherwise (asking about a master directly) it reads the walk's own list,
//              so an admin can also pull back something they already uploaded for their
//              own master.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action, walkId } = body || {};

    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }


    if (!walkId) {
      return Response.json({ error: 'Missing walkId' }, { status: 400 });
    }
    const walk = await base44.asServiceRole.entities.Walk.get(String(walkId));
    if (!walk) {
      return Response.json({ error: 'Tour not found' }, { status: 404 });
    }
    // Same ownership boundary every other narrator-facing Walk function uses: an admin
    // can reach any walk; a narrator only ever their own clone.
    if (actor.kind !== 'admin' && (walk.assigned_narrator_email || '').toLowerCase() !== (actor.email || '').toLowerCase()) {
      return Response.json({ error: 'Not authorized for this tour' }, { status: 403 });
    }

    if (action === 'get') {
      const segment_id = body.segment_id ? String(body.segment_id) : '';
      if (!segment_id) return Response.json({ error: 'Missing segment_id' }, { status: 400 });

      let sourceWalk = walk;
      if (walk.clone_of) {
        sourceWalk = await base44.asServiceRole.entities.Walk.get(String(walk.clone_of));
        if (!sourceWalk) return Response.json({ file: null });
      }
      const entry = (sourceWalk.import_files || []).find((f: any) => f.segment_id === segment_id);
      return Response.json({ file: entry ? { file_url: entry.file_url, filename: entry.filename } : null });
    }

    // 'upload' and 'remove' both change the depository itself — admin only. A narrator
    // can READ the master's depository (via 'get' above) but never write to it; the
    // depository is always the admin's own master files, never a narrator's.
    if (actor.kind !== 'admin') {
      return Response.json({ error: 'Only an admin can manage the shared depository.' }, { status: 403 });
    }
    if (walk.clone_of) {
      return Response.json({ error: 'Upload to the master tour, not a translation clone.' }, { status: 400 });
    }

    if (action === 'upload') {
      const segment_id = body.segment_id ? String(body.segment_id) : '';
      const fileBase64 = body.fileBase64 ? String(body.fileBase64) : '';
      if (!segment_id) return Response.json({ error: 'Missing segment_id' }, { status: 400 });
      if (!fileBase64) return Response.json({ error: 'Missing file data' }, { status: 400 });

      let bytes: Uint8Array;
      try {
        const binary = atob(fileBase64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        return Response.json({ error: 'Could not decode the uploaded file.' }, { status: 400 });
      }

      const filename = body.filename ? String(body.filename) : `${segment_id}.odt`;
      const mimeType = body.mimeType ? String(body.mimeType) : 'application/vnd.oasis.opendocument.text';
      const file = new File([bytes], filename, { type: mimeType });
      const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

      const existing = Array.isArray(walk.import_files) ? walk.import_files : [];
      const nextEntry = {
        segment_id,
        file_url: uploadResult.file_url,
        filename,
        uploaded_at: new Date().toISOString(),
      };
      const nextFiles = [...existing.filter((f: any) => f.segment_id !== segment_id), nextEntry];
      await base44.asServiceRole.entities.Walk.update(String(walkId), { import_files: nextFiles });

      return Response.json({ file: nextEntry });
    }

    if (action === 'remove') {
      const segment_id = body.segment_id ? String(body.segment_id) : '';
      if (!segment_id) return Response.json({ error: 'Missing segment_id' }, { status: 400 });

      const existing = Array.isArray(walk.import_files) ? walk.import_files : [];
      const nextFiles = existing.filter((f: any) => f.segment_id !== segment_id);
      await base44.asServiceRole.entities.Walk.update(String(walkId), { import_files: nextFiles });

      return Response.json({ ok: true });
    }

    return Response.json({ error: 'action must be "get", "upload", or "remove"' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
