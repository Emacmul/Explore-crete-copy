// --- Waypoint-image propagation (2026-10-12, Enda) ---------------------------------
// Images are a language-neutral visual navigation aid (see image_urls in the Walk
// schema): the SAME photo helps a German narrator and an English customer alike, so
// they are Admin-managed master content, never per-language narrator work. Narrators
// cannot write image fields at all (NARRATOR_WAYPOINT_WRITE_FIELDS excludes them —
// checked), so overwriting a clone's images from the master can never destroy
// narrator work.
//
// The problem this solves: a clone copies the master's images only AT CLONE TIME.
// Enda releases tours to narrators as soon as the text/audio is ready — often before
// the reference photos are gathered — so clones exist that pre-date images the Admin
// adds later, and narrators should never have to wait for (or re-enter) them.
//
// propagateWaypointImages runs on every admin save of a MASTER (non-clone) tour —
// and on demand via the syncCloneImages function (the "Push Images to Clones"
// button) — and pushes each waypoint's image_urls/image_url into every clone of that
// master, matched by waypointKey (segment_id first — identical between master and
// clones because cloning preserves it). Clones in ANY state are updated —
// in-progress AND finished/submitted-locked ones (the submission lock in
// saveWalkForBackend's narrator branch only binds narrator saves; this is an
// admin-initiated server-side write, the same authority handlePushBackClone already
// uses to flip finished on a locked clone).
//
// Rules of thumb:
//  - Only waypoints the master actually HAS images for are propagated. A master
//    waypoint with no images at all never clears anything from a clone (so a clone
//    can never lose images it somehow has and the master doesn't).
//  - Idempotent: a clone whose images already match the master is skipped entirely
//    (no write), so repeated runs / saves cost zero extra writes for unchanged
//    images, and a retry after a partial failure only touches what was missed.
//  - Best-effort at every call site: callers wrap it in try/catch — a propagation
//    failure must never block or fail the master save itself.

// Stable identity for comparing "the same waypoint" between the existing record and the
// incoming patch — segment_id is the real key; the index/name fallback only covers legacy
// waypoints that never got one, and always uses the waypoint's ORIGINAL position in its
// OWN array (audit N3, 2026-09-23): the live-tour gate used to build these keys from the
// filtered list of unready waypoints, so an insertion or deletion anywhere shifted every
// fallback key and made two different waypoints compare as the same one.
export function waypointKey(wp: any, index: number) {
  return String(wp.segment_id || `${wp.name || ''}#${index}`);
}

// The image-bearing state of one waypoint — identity alone can't tell whether a clone's
// photos already match the master's; this is the comparison key for "same images".
function waypointImagesKey(wp: any) {
  return JSON.stringify([wp.image_urls ?? [], wp.image_captions ?? [], wp.image_url ?? '']);
}

export async function propagateWaypointImages(base44: any, master: any) {
  const clones = await base44.asServiceRole.entities.Walk.filter({ clone_of: master.id });
  // Master waypoint -> images, keyed the same way the live-tour gate in
  // saveWalkForBackend keys waypoints (segment_id, name#index fallback). Only
  // waypoints that actually carry images make it into this map.
  const masterImages = new Map<string, any>();
  (Array.isArray(master.waypoints) ? master.waypoints : []).forEach((wp: any, i: number) => {
    if (!wp) return;
    const hasImages = (Array.isArray(wp.image_urls) && wp.image_urls.length > 0) || (typeof wp.image_url === 'string' && wp.image_url);
    if (!hasImages) return;
    masterImages.set(waypointKey(wp, i), wp);
  });
  if (masterImages.size === 0) return 0;

  let touched = 0;
  for (const clone of clones) {
    const cloneWaypoints = Array.isArray(clone.waypoints) ? clone.waypoints : [];
    let changed = false;
    const next = cloneWaypoints.map((wp: any, i: number) => {
      const masterWp = masterImages.get(waypointKey(wp, i));
      if (!masterWp) return wp;
      if (waypointImagesKey(wp) === waypointImagesKey(masterWp)) return wp;
      changed = true;
      return {
        ...wp,
        image_urls: masterWp.image_urls ?? [],
        image_captions: masterWp.image_captions ?? [],
        image_url: masterWp.image_url ?? '',
      };
    });
    if (changed) {
      await base44.asServiceRole.entities.Walk.update(clone.id, { waypoints: next });
      touched += 1;
    }
  }
  return touched;
}