// Per Enda's follow-up 47 report: hiding General/Route Path/Waypoints as TABS
// (WalkEditor.jsx, follow-up 46) only ever stopped a narrator navigating to
// them through the normal UI. It did nothing about what data actually reaches
// their browser in the first place — getWalksForBackend.ts was already
// sending a narrator's own clone back COMPLETE, every field, specifically so
// the old client-side-only gating had something to hide/show from. Enda asked
// directly for "no way to see" to hold up against that too (e.g. opening
// browser dev tools), which means the real fix has to live on the read side
// of the backend, not just in which tabs render.
//
// This file is the single source of truth for BOTH directions of narrator
// access to a Walk, specifically so they can never drift apart the way two
// independently-hand-written lists eventually would:
//   - the WRITE whitelist (what a narrator's save patch is allowed to touch)
//     — used by saveWalkForBackend.ts, unchanged in substance from before,
//     just moved here out of that file.
//   - the READ whitelist (what a narrator's own clone is allowed to send
//     back to their browser at all) — new, used by getWalksForBackend.ts.
//
// The read list is intentionally broader than the write list — a narrator
// needs to SEE far more than they're allowed to CHANGE (e.g. lat/lng,
// waypoint_role, and segment_id are all read-only for them but still have to
// reach the map and the script editor to render at all) — but it excludes
// everything that traced to zero use anywhere in the two screens a narrator
// can still reach (Narration & Simulate, Preview): pricing/checkout fields,
// publish/approval state, route-planning metrics (distance/duration/
// elevation — never displayed on either screen, and already stripped by the
// WRITE whitelist regardless of what a save patch contains), and the
// admin-only `final_audio_applied` PCV-audio-is-really-final flag.
//
// IMPORTANT — two fields below (`region`, `difficulty`) are NOT used by
// anything a narrator's screens display. They're included anyway because
// WalkEditor.jsx's `canSave` check reads them directly off `form` to decide
// whether Save Route is even enabled — leaving them out would silently
// disable saving entirely for every narrator (a blank `region`/`difficulty`
// fails that check), which is a far worse outcome than the low-sensitivity
// cost of a narrator seeing their own tour's region/difficulty label.

export const NARRATOR_WALK_WRITE_FIELDS = ['name', 'description', 'safety_notes', 'finished'];

export const NARRATOR_WAYPOINT_WRITE_FIELDS = [
  'narration_script', 'audio_clip_url', 'trigger_audio',
  'trigger_radius_m', 'trigger_once', 'use_bearing',
  'bearing_direction', 'bearing_tolerance', 'waypoint_done',
];

export const NARRATOR_WALK_READ_FIELDS = [
  'id', 'code', 'name', 'description', 'safety_notes', 'finished',
  'clone_of', 'target_language', 'route_type', 'tour_category',
  'start_lat', 'start_lng', 'region', 'difficulty',
  'default_driving_speed_kmh', 'trail_path', 'trail_breaks',
];

export const NARRATOR_WAYPOINT_READ_FIELDS = [
  'lat', 'lng', 'waypoint_role', 'segment_id', 'segment_title', 'segment_number', 'name',
  'narration_script', 'audio_clip_url', 'trigger_audio', 'trigger_once',
  'trigger_radius_m', 'use_bearing', 'bearing_direction', 'bearing_tolerance',
  'avg_segment_speed_kmh', 'waypoint_done', 'description', 'image_url', 'type',
];

// Trims one full Walk record (as stored) down to exactly what a narrator's
// own clone may send back to their browser. Only ever call this for a clone
// that's actually theirs — it doesn't check ownership itself, that's
// getWalksForBackend.ts's job (same split as saveWalkForBackend.ts, which
// checks ownership before ever touching the write whitelist).
export function pickNarratorReadableWalk(walk: any) {
  const picked: any = {};
  for (const f of NARRATOR_WALK_READ_FIELDS) {
    if (f in walk) picked[f] = walk[f];
  }
  picked.waypoints = (walk.waypoints || []).map((wp: any) => {
    const wpPicked: any = {};
    for (const f of NARRATOR_WAYPOINT_READ_FIELDS) {
      if (f in wp) wpPicked[f] = wp[f];
    }
    return wpPicked;
  });
  return picked;
}
