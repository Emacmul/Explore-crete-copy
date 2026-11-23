import { buildSegmentId, generateWaypointUid, getRoleColour } from '@/lib/routeExport';
import { MAX_WAYPOINT_IMAGES } from '@/lib/waypointImages';
import { cleanWaypointTitle, parseWaypointName } from '@/lib/walkWaypoints';

// Turns the <wpt> elements of an imported GPX into Walk.waypoints.
//
// Every tour type — Walk/Hike (WHT), WalkAbout (WBT) and DriveAbout (DDV) — now gets the
// SAME waypoint shape: a waypoint role, a segment (location) number, a segment id built
// from the tour code + that number, the raw GPX point name as the location title, and an
// average segment speed. The only difference between a walk and the two tour types is
// that a walk carries no audio and has no simulator (Enda, 2026-11-23) — the data model
// itself is identical, so the same Waypoints editor serves all three.
//
// Per Enda (2026-11-23): an earlier attempt folded each location's sub-points
// ("API1a-PS", "API1b", "API1c"…) down to one marker per location, which silently threw
// away most of the file — importing a full waypoints GPX produced 6 markers instead of
// the full set. Every point in the file is imported now.
export function buildImportedWaypoints(wpts, {
  code,
  isDrivingAudioTour,
  defaultSegmentSpeedKmh,
  defaultTriggerRadiusM,
}) {
  const built = wpts.map((wpt, i) => {
    const eleTxt = wpt.querySelector('ele')?.textContent;
    const ele = (eleTxt && parseFloat(eleTxt) > 0) ? parseFloat(eleTxt) : null;
    const nameTxt = wpt.querySelector('name')?.textContent || `Waypoint ${i + 1}`;
    const descTxt = wpt.querySelector('desc')?.textContent || '';
    const lat = parseFloat(wpt.getAttribute('lat'));
    const lng = parseFloat(wpt.getAttribute('lon'));

    // Optional extension tags — present when a GPX was exported by this app (Save and
    // Download GPX) or hand-annotated from notes before import. A plain Garmin Explore
    // export has none of these, so every field falls back to its old default.
    const typeTxt = wpt.getElementsByTagName('mc:type')[0]?.textContent?.trim();
    const labelTxt = wpt.getElementsByTagName('mc:label')[0]?.textContent?.trim();
    const imageUrls = Array.from(wpt.getElementsByTagName('mc:imageUrl'))
      .map(el => el.textContent?.trim())
      .filter(Boolean)
      .slice(0, MAX_WAYPOINT_IMAGES);

    // The GPX point name IS the location code ("API1a-PS", "API1b", "WAR1a-PS Car park"),
    // so it becomes the location title verbatim, and the number inside it the segment
    // (location) number every point at that stop shares.
    const parsed = parseWaypointName(nameTxt);
    const segNum = parsed.number != null ? String(parsed.number) : String(i + 1);
    const segId = buildSegmentId(code, segNum) || '';
    const role = parsed.isPS ? 'primary_start' : 'secondary';

    if (isDrivingAudioTour) {
      return {
        lat,
        lng,
        waypoint_uid: generateWaypointUid(),
        waypoint_role: role,
        segment_number: segNum,
        segment_id: segId,
        segment_title: nameTxt,
        avg_segment_speed_kmh: role === 'primary_start' ? defaultSegmentSpeedKmh : null,
        description: descTxt,
        narration_script: '',
        trigger_audio: false,
        audio_clip_url: '',
        trigger_radius_m: defaultTriggerRadiusM,
        trigger_once: true,
        use_bearing: false,
        bearing_direction: 0,
        bearing_tolerance: 30,
        waypoint_colour: getRoleColour(role),
        name: nameTxt,
        type: role,
        ...(ele !== null && !isNaN(ele) ? { elevation: Math.round(ele) } : {}),
      };
    }

    // Walk/Hike: identical shape, minus everything audio-related.
    return {
      lat,
      lng,
      waypoint_role: role,
      segment_number: segNum,
      segment_id: segId || nameTxt,
      segment_title: nameTxt,
      avg_segment_speed_kmh: defaultSegmentSpeedKmh ?? null,
      waypoint_colour: getRoleColour(role),
      // The descriptive words only ("Car park"), never the bare code — the code is
      // already the segment id / location title above.
      name: labelTxt || cleanWaypointTitle(nameTxt),
      description: descTxt,
      type: typeTxt || 'landmark',
      image_urls: imageUrls,
      ...(ele !== null && !isNaN(ele) ? { elevation: Math.round(ele) } : {}),
    };
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  return built;
}