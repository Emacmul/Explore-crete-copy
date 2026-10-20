// --- Waypoint-image propagation (2026-10-12, Enda) ---------------------------------
// Images are a language-neutral visual navigation aid (see image_urls in the Walk
// schema): the SAME photo helps a German narrator and an English customer alike, so
// they are Admin-managed master content, never per-language narrator work. Narrators
// cannot write image fields at all (NARRATOR_WAYPOINT_WRITE_FIELDS excludes
// image_urls/image_url — checked), so overwriting a clone's images from the master
// can never destroy narrator work.
//
// Captions (image_captions), by contrast, ARE per-language narrator work: a clone
// inherits the master's English captions at clone time, then the narrator translates
// them. So propagation must NEVER copy the master's caption text into a clone — that
// would clobber a finished translation. Instead, when the master's PHOTOS change
// (added/removed/reordered), propagation realigns the clone's caption array to the
// new image_urls length: it keeps the clone's existing caption at every index that
// still has a photo, pads with '' for newly added photos, and drops the caption for
// any removed photo. The master's caption text only ever reaches a clone at CLONE
// time (cloneWalkForBackend copies waypoints wholesale), never through this path.
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
//  - Idempotent on the master-managed fields: a clone whose image_urls/image_url
//    already match the master (and whose caption array is already the right length)
//    is skipped entirely (no write), so repeated runs / saves cost zero extra writes
//    for unchanged images, and a retry after a partial failure only touches what was
//    missed. A clone whose captions differ from the master's is NOT re-touched —
//    captions are narrator work, not a propagation target.
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

// The master-managed image-bearing state of one waypoint — the comparison key for "same
// photos". Captions are deliberately EXCLUDED: a clone whose captions differ from the
// master's (because the narrator translated them) must not count as "different" here,
// or every admin save would rewrite every translated clone's caption array to the
// master's English text and destroy the translation.
function waypointImagesKey(wp: any) {
  return JSON.stringify([wp.image_urls ?? [], wp.image_url ?? '']);
}

// The caption array a clone should hold once its photos match the master's: the clone's
// existing caption kept at every index that still has a photo, '' padded for any new
// photo index, and the tail dropped for any removed photo. Never copies master text.
function alignCaptions(cloneCaptions: any[], desiredLen: number) {
  const cur = Array.isArray(cloneCaptions) ? cloneCaptions : [];
  const aligned: string[] = [];
  for (let k = 0; k < desiredLen; k++) {
    aligned.push(typeof cur[k] === 'string' ? cur[k] : '');
  }
  return aligned;
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
      const desiredLen = (Array.isArray(masterWp.image_urls) && masterWp.image_urls.length > 0)
        ? masterWp.image_urls.length
        : (typeof masterWp.image_url === 'string' && masterWp.image_url ? 1 : 0);
      const samePhotos = waypointImagesKey(wp) === waypointImagesKey(masterWp);
      const curCaptions = Array.isArray(wp.image_captions) ? wp.image_captions : [];
      const captionsAlreadyAligned = curCaptions.length === desiredLen;
      if (samePhotos && captionsAlreadyAligned) return wp;
      // Photos changed, OR the caption array drifted out of length with the photos.
      // Carry the master's image fields, but PRESERVE the clone's existing captions
      // (never copy master caption text) — only realign the array to the new length.
      changed = true;
      return {
        ...wp,
        image_urls: masterWp.image_urls ?? [],
        image_url: masterWp.image_url ?? '',
        image_captions: alignCaptions(wp.image_captions, desiredLen),
      };
    });
    if (changed) {
      await base44.asServiceRole.entities.Walk.update(clone.id, { waypoints: next });
      touched += 1;
    }
  }
  return touched;
}