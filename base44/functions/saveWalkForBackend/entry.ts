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
import { NARRATOR_WALK_WRITE_FIELDS, NARRATOR_WAYPOINT_WRITE_FIELDS, SYSTEM_MESSAGE_AUDIO_FIELDS } from '../../shared/narratorWalkFields.ts';
// Per Enda's follow-up 146: the moment an English tour is actually published,
// every current admin/narrator gets it for free — see narratorFreeTours.ts for
// the full reasoning.
import { grantTourToAllNarrators } from '../../shared/narratorFreeTours.ts';

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
      // Never taken from a narrator payload, regardless of what's sent.
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

// Audio-readiness of ONE record (the existing one, the incoming patch, or both merged):
// which audio-triggered waypoints still carry the AI draft narration, and which spoken
// system messages (off-route / GPS / speed alerts) still lack their PCV audio. System
// messages only apply to a driving_audio_tour — a plain walk/hike tour has none of those
// alerts, so it is never blocked by that half of the check.
function collectAudioReadinessIssues(record: any) {
  const waypoints = (record && Array.isArray(record.waypoints)) ? record.waypoints : [];
  const notReady = waypoints.filter((wp: any) => wp && wp.trigger_audio && !wp.final_audio_applied);
  const missingSystemAudio = (record && record.route_type === 'driving_audio_tour')
    ? SYSTEM_MESSAGE_AUDIO_FIELDS.filter((f: string) => !record[f])
    : [];
  return { notReady, missingSystemAudio };
}

// Stable identity for comparing "the same waypoint" between the existing record and the
// incoming patch — segment_id is the real key; the index/name fallback only covers legacy
// waypoints that never got one.
function waypointKey(wp: any, index: number) {
  return String(wp.segment_id || `${wp.name || ''}#${index}`);
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
        const wasPublic = existingBeforeSave.approved === true;
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
                error: `Cannot publish — ${issues.notReady.length} waypoint(s) still have the AI draft narration. Use "Update Audio" to replace them with the final PCV narration first.`,
              }, { status: 400 });
            }
            if (issues.missingSystemAudio.length > 0) {
              return Response.json({
                error: `Cannot publish — ${issues.missingSystemAudio.length} system voice message(s) (off-route/GPS/speed alerts) still need PCV audio generated. Open Narration & Simulate to generate them in the narrator's own voice first.`,
              }, { status: 400 });
            }
          } else {
            // Already published and staying published: reject edits that would take
            // ready audio BACKWARDS (draft narration re-applied, a system PCV clip
            // removed). A waypoint that was ALREADY on draft narration (a legacy tour
            // published before final_audio_applied existed) is left alone — only NEW
            // unreadiness is blocked, so old tours keep being editable.
            const existingIssues = collectAudioReadinessIssues(existingBeforeSave);
            const prevUnreadyKeys = new Set(existingIssues.notReady.map((wp: any, i: number) => waypointKey(wp, i)));
            const newUnready = issues.notReady.filter((wp: any, i: number) => !prevUnreadyKeys.has(waypointKey(wp, i)));
            if (newUnready.length > 0) {
              return Response.json({
                error: `This tour is already live — the change would put ${newUnready.length} waypoint(s) back on the AI draft narration. Replace them with the final PCV narration via "Update Audio" first, or unpublish the tour while editing.`,
              }, { status: 400 });
            }
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
          && existingBeforeSave.approved !== true
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
      const createPatch = ('approved' in patch) ? patch : { ...patch, approved: false };
      if (createPatch.approved === true) {
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
    return Response.json({ ok: true, walk: saved });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}