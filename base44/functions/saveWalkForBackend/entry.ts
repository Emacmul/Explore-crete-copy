import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
// Per Enda / Base44 support: this is the single busiest save path in the whole app — every
// narrator's every edit comes through here — so it's first in line for the pooled-rate-limit
// retry protection. See withEntityRetry.ts's own header comment for the full reasoning.
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';
// Per Enda's follow-up 47 report: these two lists now live in one shared
// place alongside the READ-side whitelist getWalksForBackend.ts uses, so the
// two can never quietly drift apart — see narratorWalkFields.ts for the full
// reasoning. Renamed NARRATOR_WALK_FIELDS -> NARRATOR_WALK_WRITE_FIELDS and
// NARRATOR_WAYPOINT_FIELDS -> NARRATOR_WAYPOINT_WRITE_FIELDS to make the
// read/write split explicit at every call site below; behaviour is
// unchanged, only the names and where they're declared.
import { NARRATOR_WALK_WRITE_FIELDS, NARRATOR_WAYPOINT_WRITE_FIELDS, SYSTEM_MESSAGE_AUDIO_FIELDS, pickNarratorReadableWalk } from '../../shared/narratorWalkFields.ts';
// One shared public predicate for read + write paths (audit N2, 2026-09-23) — see its own
// header comment for the mismatch this closes.
import { isWalkPublic } from '../../shared/walkPublish.ts';
// Per Enda's follow-up 146: the moment an English tour is actually published,
// every current admin/narrator gets it for free — see narratorFreeTours.ts for
// the full reasoning.
import { grantTourToAllNarrators } from '../../shared/narratorFreeTours.ts';
// Audio-readiness gate, now shared with the new publishTourVersion function
// (published-versions plan) — one strict definition of "could a customer actually
// play this tour", so a publish and a live-save can never disagree.
import { isUsableAudioUrl, collectAudioReadinessIssues } from '../../shared/walkReadiness.ts';

// Deploy marker 2026-09-25 09:46 — narrator submission lock: fresh re-save to trigger
// redeploy; deployed behavior must reject a submitted narrator's edit with 409.
// Top-level Walk fields a narrator may change on their own clone. Everything
// else (region, difficulty, distance_km, duration_hours, elevation_gain_m,
// start_lat/start_lng, code, default_driving_speed_kmh, trail_path,
// trail_breaks, price_eur, approved, is_sample_walk, creem_product_id,
// checkout_url, ...) is dropped from a narrator payload here — this is the
// real enforcement point. The client-side field gating in WalkEditor.jsx /
// DrivingTourWaypointEditor.jsx is only ever a convenience on top of this,
// never the boundary itself.
const NARRATOR_WALK_FIELDS = NARRATOR_WALK_WRITE_FIELDS;

// Per-waypoint sub-fields a narrator may change. lat, lng, waypoint_role,
// segment_number, segment_title and avg_segment_speed_kmh always come from
// the server's own copy of the waypoint, never the client's — speed in
// particular must never be settable by anyone but an Admin, anywhere.
// final_audio_applied is deliberately absent — see the comment on the admin
// branch below; only the Update Audio tool (an admin-only action) may set it.
const NARRATOR_WAYPOINT_FIELDS = NARRATOR_WAYPOINT_WRITE_FIELDS;

// Narrators can't reorder/add/remove waypoints in the UI today (drag is
// disabled, and the add/delete controls are admin-only) — so waypoint count
// and order are safe invariants to enforce here, not just assume.
function mergeNarratorWaypoints(existingWaypoints: any[], incomingWaypoints: any) {
  const existing = existingWaypoints || [];
  if (!Array.isArray(incomingWaypoints)) return existing;
  if (incomingWaypoints.length !== existing.length) {
    throw new Error('Waypoints cannot be added, removed, or reordered from Narrator Studio.');
  }
  return existing.map((wp: any, i: number) => {
    const incoming = incomingWaypoints[i] || {};
    const merged = { ...wp };
    for (const f of NARRATOR_WAYPOINT_FIELDS) {
      if (f in incoming) merged[f] = incoming[f];
    }
    return merged;
  });
}

// Segment scripts are keyed by segment_number (falling back to segment_id),
// not fragile to array order the way waypoints are. A narrator may freely
// rewrite the draft/finalized workflow fields — combine, edit break tags,
// regenerate draft TTS, as many times as needed — but can never push a
// segment straight to 'accepted', revert it FROM accepted, or attach
// finished_audio_url themselves. Per Enda: accepting a segment and uploading
// the final PCV (Professional Cloned Voice) audio is the Admin's "final check
// and final audio editing" step, done once the whole clone is marked finished
// and handed over — not something the narrator does themselves.
function mergeNarratorSegmentScripts(existingScripts: any[], incomingScripts: any) {
  const existing = existingScripts || [];
  if (!Array.isArray(incomingScripts)) return existing;

  const byKey = new Map(existing.map((s: any) => [s.segment_number ?? s.segment_id, s]));

  return incomingScripts.map((incoming: any) => {
    const key = incoming.segment_number ?? incoming.segment_id;
    const current: any = byKey.get(key) || {};

    const merged: any = {
      segment_number: incoming.segment_number ?? current.segment_number,
      segment_id: incoming.segment_id ?? current.segment_id,
      combined_script: 'combined_script' in incoming ? incoming.combined_script : current.combined_script,
      combined_audio_url: 'combined_audio_url' in incoming ? incoming.combined_audio_url : current.combined_audio_url,
      final_script: 'final_script' in incoming ? incoming.final_script : current.final_script,
      final_audio_url: 'final_audio_url' in incoming ? incoming.final_audio_url : current.final_audio_url,
      // Never taken from a narrator payload, regardless of what is sent.
      finished_audio_url: current.finished_audio_url,
      status: current.status ?? 'draft',
    };

    // status may only move between draft/finalized from a narrator. Once a
    // segment is already 'accepted', a narrator's payload can't change its
    // status at all (an admin revoking acceptance is a separate, admin-only
    // action, not something this narrator-facing path needs to allow).
    if (current.status !== 'accepted' && incoming.status && incoming.status !== 'accepted') {
      merged.status = incoming.status;
    }

    return merged;
  });
}

// Audio-readiness (isUsableAudioUrl + collectAudioReadinessIssues) moved to
// shared/walkReadiness.ts — see the import at the top.

// Stable identity for comparing "the same waypoint" between the existing record and the
// incoming patch — segment_id is the real key; the index/name fallback only covers legacy
// waypoints that never got one, and always uses the waypoint's ORIGINAL position in its
// OWN array (audit N3, 2026-09-23): the live-tour gate used to build these keys from the
// filtered list of unready waypoints, so an insertion or deletion anywhere shifted every
// fallback key and made two different waypoints compare as the same one.
function waypointKey(wp: any, index: number) {
  return String(wp.segment_id || `${wp.name || ''}#${index}`);
}

// The audio-bearing state of one waypoint (audit N3): identity alone can't tell whether an
// edit actually changed the audio a live tour is serving — the same waypoint with a
// different clip is a NEW unresolved problem, not the same grandfathered old one.
function waypointAudioKey(wp: any) {
  return JSON.stringify([wp.audio_clip_url ?? null, wp.trigger_audio === true, wp.final_audio_applied === true]);
}

// Single save entry point for the back end. Replaces the direct
// entities.Walk.create/update calls BackendShell.jsx used to make for
// handleSave, handleToggleFree, handleMarkChecked, handlePublishClone,
// handlePushBackClone and handleToggleFinished — all of those are admin-only
// actions today and simply pass an unrestricted patch through when the actor
// resolves to 'admin'.
export default async function(req) {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor) return Response.json({ error: 'Not authorized' }, { status: 403 });

    const { id, patch } = body || {};
    if (!patch || typeof patch !== 'object') {
      return Response.json({ error: 'patch is required' }, { status: 400 });
    }

    // --- Admin: unrestricted, matches today's direct-SDK behaviour ---
    if (actor.kind === 'admin') {
      // Per Enda: a tour must NEVER become publicly purchasable while any of its
      // audio-triggered waypoints still carries the AI-generated draft narration —
      // only the Update Audio tool (UpdateAudioTool.jsx) may set
      // final_audio_applied:true, once the real PCV (Professional Cloned Voice)
      // audio has replaced it. Applies to a Narrator's clone AND to a master tour
      // an Admin builds directly — same rule, same check, both go through this one
      // saveWalkForBackend admin branch either way.
      if (id) {
        // Fetched once for EVERY admin update now (audit finding U2): the readiness gate
        // below validates the RESULTING record (existing + patch merged) whenever the
        // tour is or stays public, and the free-tour grant further down still needs the
        // pre-save state to spot the actual moment a tour goes live.
        const existingBeforeSave = await base44.asServiceRole.entities.Walk.get(String(id));
        if (!existingBeforeSave) {
          return Response.json({ error: 'Walk not found.' }, { status: 404 });
        }

        // Public-record invariant (audit finding U2): the old gate fired ONLY on the
        // approved false->true transition, so an edit to an already-published tour could
        // quietly swap ready PCV audio back for missing/draft audio with no check at all.
        // Now every save that leaves the tour public is validated instead.
        // Boundary validation (audit N2): `approved` may only ever be a real boolean —
        // a null/undefined/other value would create a third "sort of public" state the
        // catalog read path and this gate could disagree about (see walkPublish.ts).
        if ('approved' in patch && typeof patch.approved !== 'boolean') {
          return Response.json({ error: 'approved must be true or false.' }, { status: 400 });
        }
        const wasPublic = isWalkPublic(existingBeforeSave);
        const willBePublic = ('approved' in patch) ? patch.approved === true : wasPublic;
        if (willBePublic) {
          const merged = { ...existingBeforeSave, ...patch };
          const issues = collectAudioReadinessIssues(merged);
          if (!wasPublic) {
            // The (re)publish moment: full strict gate, same rule as before — just no
            // longer tied to the false->true transition, so an update that doesn't
            // mention `approved` can no longer sneak a draft tour public, and a published
            // tour can't have its readiness quietly downgraded.
            if (issues.notReady.length > 0) {
              return Response.json({
                error: `Cannot publish — ${issues.notReady.length} waypoint(s) still have the AI draft narration or no usable final audio clip. Use "Update Audio" to replace them with the final PCV narration first.`,
              }, { status: 400 });
            }
            if (issues.missingSystemAudio.length > 0) {
              return Response.json({
                error: `Cannot publish — ${issues.missingSystemAudio.length} system voice message(s) (off-route/GPS/speed alerts) still need their PCV audio file imported. Open Narration & Simulate to import the finished .wav for each in the narrator's own voice first.`,
              }, { status: 400 });
            }
          } else {
            // Already published and staying published: reject edits that would take
            // ready audio BACKWARDS (draft narration re-applied, a system PCV clip
            // removed). The legacy exception is deliberately NARROW (audit N3,
            // 2026-09-23): a waypoint that was ALREADY on draft narration (a tour
            // published before final_audio_applied existed) is tolerated only while
            // its audio is completely untouched — its identity key AND its audio state
            // must both match what's stored. Swapping the draft clip on such a waypoint,
            // or shifting its position via an insert/delete around it, is new
            // unreadiness on a live tour and is blocked like any other; unpublish the
            // tour while its audio is being edited.
            const prevUnreadyAudioByKey = new Map();
            (Array.isArray(existingBeforeSave.waypoints) ? existingBeforeSave.waypoints : []).forEach((wp: any, i: number) => {
              if (wp && wp.trigger_audio && (!wp.final_audio_applied || !isUsableAudioUrl(wp.audio_clip_url))) {
                prevUnreadyAudioByKey.set(waypointKey(wp, i), waypointAudioKey(wp));
              }
            });
            const newUnready: any[] = [];
            (Array.isArray(merged.waypoints) ? merged.waypoints : []).forEach((wp: any, i: number) => {
              // Same readiness predicate as collectAudioReadinessIssues above, so a live
              // tour can't swap in a missing/invalid clip under a still-set flag either.
              if (!(wp && wp.trigger_audio && (!wp.final_audio_applied || !isUsableAudioUrl(wp.audio_clip_url)))) return;
              const prevAudio = prevUnreadyAudioByKey.get(waypointKey(wp, i));
              // Not previously unready at all, or previously unready but its audio
              // changed: either way, a new unresolved problem on a live tour.
              if (prevAudio === undefined || prevAudio !== waypointAudioKey(wp)) {
                newUnready.push(wp);
              }
            });
            if (newUnready.length > 0) {
              return Response.json({
                error: `This tour is already live — the change would put ${newUnready.length} waypoint(s) on (or back on) the AI draft narration, or leave them without a usable final audio clip. Replace them with the final PCV narration via "Update Audio" first, or unpublish the tour while editing.`,
              }, { status: 400 });
            }
            const existingIssues = collectAudioReadinessIssues(existingBeforeSave);
            const prevMissingSys = new Set(existingIssues.missingSystemAudio);
            const newMissingSys = issues.missingSystemAudio.filter((f: string) => !prevMissingSys.has(f));
            if (newMissingSys.length > 0) {
              return Response.json({
                error: `This tour is already live — the change would remove the PCV audio for ${newMissingSys.length} system voice message(s) (off-route/GPS/speed alerts). Restore it, or unpublish the tour while editing.`,
              }, { status: 400 });
            }
          }
        }
        const saved = await base44.asServiceRole.entities.Walk.update(String(id), patch);

        // Per Enda (follow-up 146): the moment an English tour (never a translation
        // clone) actually goes live for purchase, every current admin/narrator gets
        // it added to their own library for free — same mechanism as the manual
        // "gift a tour" action — so they can experience it themselves before
        // translating. Best-effort: a problem here must never block the tour from
        // actually publishing.
        const isFreshPublish = patch.approved === true
          && existingBeforeSave
          && !isWalkPublic(existingBeforeSave)
          && !existingBeforeSave.clone_of;
        if (isFreshPublish) {
          try {
            await grantTourToAllNarrators(base44, saved);
          } catch (grantError) {
            console.error('Free-tour grant to narrators/admins failed (tour is still published):', grantError);
          }
        }

        return Response.json({ ok: true, walk: saved });
      }
      // Brand-new tour (master or otherwise) — the entity schema itself still
      // defaults `approved` to true, but a fresh tour has had no chance to run
      // through the audio check above yet (there's nothing to check against
      // before it exists). Default it to a draft here instead unless the caller
      // explicitly set it, closing that gap: every new tour now needs an explicit
      // Publish action once it's actually ready, same as a Narrator's clone always
      // has. WalkEditor.jsx never sends `approved` on creation today, so this is
      // the effective default for every new tour from here on.
      // Audit finding U2: explicitly creating WITH approved:true used to skip the
      // readiness gate entirely (the gate only ever ran on updates) — now the new
      // tour's own content is validated before it can be born public.
      // Boundary validation (audit N2) — same rule as the update path above: `approved`
      // may only ever be a real boolean.
      if ('approved' in patch && typeof patch.approved !== 'boolean') {
        return Response.json({ error: 'approved must be true or false.' }, { status: 400 });
      }
      const createPatch = ('approved' in patch) ? patch : { ...patch, approved: false };
      if (isWalkPublic(createPatch)) {
        const issues = collectAudioReadinessIssues(createPatch);
        if (issues.notReady.length > 0) {
          return Response.json({
            error: `Cannot publish — ${issues.notReady.length} waypoint(s) still have the AI draft narration. Use "Update Audio" to replace them with the final PCV narration first.`,
          }, { status: 400 });
        }
        if (issues.missingSystemAudio.length > 0) {
          return Response.json({
            error: `Cannot publish — ${issues.missingSystemAudio.length} system voice message(s) (off-route/GPS/speed alerts) still need PCV audio generated. Open Narration & Simulate to generate them in the narrator's own voice first.`,
          }, { status: 400 });
        }
      }
      const saved = await base44.asServiceRole.entities.Walk.create(createPatch);
      return Response.json({ ok: true, walk: saved });
    }

    // --- Narrator: can only ever touch their own clone, and only whitelisted fields ---
    if (!id) {
      return Response.json({ error: 'Narrators cannot create a walk directly — clone one instead.' }, { status: 403 });
    }

    const existing = await base44.asServiceRole.entities.Walk.get(String(id));
    if (!existing || !existing.clone_of) {
      return Response.json({ error: 'Not found, or not a clone.' }, { status: 404 });
    }
    if ((existing.assigned_narrator_email || '').toLowerCase() !== actor.email.toLowerCase()) {
      return Response.json({ error: 'This clone belongs to a different narrator.' }, { status: 403 });
    }

    // Narrator clone submission lock (published-versions plan): once a clone is
    // submitted for review (finished: true) it is READ-ONLY for its narrator — every
    // save through this narrator branch is rejected until an Admin pushes it back
    // (finished: false, set through the unrestricted admin branch above — the same
    // pushback the Admin panel already uses, which re-opens the clone for exactly
    // this assigned narrator). Submission itself is unaffected: the save that flips
    // finished false->true lands while the record is still unlocked. Backend-enforced
    // here for every field, whatever the payload touches — the Studio UI's lock is
    // only a convenience on top of this.
    if (existing.finished === true) {
      return Response.json({ error: 'This clone is submitted for review and locked — an Admin must push it back before it can be edited again.' }, { status: 409 });
    }

    const allowed: any = {};
    for (const f of NARRATOR_WALK_FIELDS) {
      if (f in patch) allowed[f] = patch[f];
    }
    if ('waypoints' in patch) {
      allowed.waypoints = mergeNarratorWaypoints(existing.waypoints, patch.waypoints);
    }
    if ('segment_scripts' in patch) {
      allowed.segment_scripts = mergeNarratorSegmentScripts(existing.segment_scripts, patch.segment_scripts);
    }

    const saved = await base44.asServiceRole.entities.Walk.update(String(id), allowed);
    // Read-side twin of the write whitelist (2026-09-24 review, "narrator data leak"):
    // getWalksForBackend trims a narrator's own clone down to NARRATOR_WALK_READ_FIELDS,
    // but this save used to return the full stored record — every field deliberately
    // withheld there (pricing/checkout, publish state, route metrics,
    // final_audio_applied, ...) went straight back to the narrator's browser on every
    // save. The response now goes through the exact same allowlist, so the boundary
    // holds in both directions. Admins take the admin branch above and are unaffected.
    return Response.json({ ok: true, walk: pickNarratorReadableWalk(saved) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}