import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

// Top-level Walk fields a narrator may change on their own clone. Everything
// else (region, difficulty, distance_km, duration_hours, elevation_gain_m,
// start_lat/start_lng, code, default_driving_speed_kmh, trail_path,
// trail_breaks, price_eur, approved, is_sample_walk, creem_product_id,
// checkout_url, ...) is dropped from a narrator payload here — this is the
// real enforcement point. The client-side field gating in WalkEditor.jsx /
// DrivingTourWaypointEditor.jsx is only ever a convenience on top of this,
// never the boundary itself.
const NARRATOR_WALK_FIELDS = ['name', 'description', 'safety_notes', 'finished'];

// Per-waypoint sub-fields a narrator may change. lat, lng, waypoint_role,
// segment_number, segment_title and avg_segment_speed_kmh always come from
// the server's own copy of the waypoint, never the client's — speed in
// particular must never be settable by anyone but an Admin, anywhere.
const NARRATOR_WAYPOINT_FIELDS = [
  'narration_script', 'audio_clip_url', 'trigger_audio',
  'trigger_radius_m', 'trigger_once', 'use_bearing',
  'bearing_direction', 'bearing_tolerance',
];

// Narrators can't reorder/add/remove waypoints in the UI today (drag is
// disabled, and the add/delete controls are admin-only) — so waypoint count
// and order are safe invariants to enforce here, not just assume.
function mergeNarratorWaypoints(existingWaypoints: any[], incomingWaypoints: any) {
  const existing = existingWaypoints || [];
  if (!Array.isArray(incomingWaypoints)) return existing;
  if (incomingWaypoints.length !== existing.length) {
    throw new Error('Waypoints cannot be added, removed, or reordered from Narr Studio.');
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
// the final ElevenLabs audio is the Admin's "final check and final audio
// editing" step, done once the whole clone is marked finished and handed
// over — not something the narrator does themselves.
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

// Single save entry point for the back end. Replaces the direct
// entities.Walk.create/update calls BackendShell.jsx used to make for
// handleSave, handleToggleFree, handleMarkChecked, handlePublishClone,
// handlePushBackClone and handleToggleFinished — all of those are admin-only
// actions today and simply pass an unrestricted patch through when the actor
// resolves to 'admin'.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveActor(base44, body);
    if (!actor) return Response.json({ error: 'Not authorized' }, { status: 403 });

    const { id, patch } = body || {};
    if (!patch || typeof patch !== 'object') {
      return Response.json({ error: 'patch is required' }, { status: 400 });
    }

    // --- Admin: unrestricted, matches today's direct-SDK behaviour ---
    if (actor.kind === 'admin') {
      if (id) {
        const saved = await base44.asServiceRole.entities.Walk.update(String(id), patch);
        return Response.json({ ok: true, walk: saved });
      }
      const saved = await base44.asServiceRole.entities.Walk.create(patch);
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
