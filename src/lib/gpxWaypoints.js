import { buildSegmentId, generateWaypointUid, getRoleColour } from '@/lib/routeExport';
import { MAX_WAYPOINT_IMAGES } from '@/lib/waypointImages';
import { mergeWalkSubPoints } from '@/lib/walkWaypoints';

// Turns the <wpt> elements of an imported GPX into Walk.waypoints. Extracted from
// WalkEditor so the two very different shapes stay side by side and readable:
//  - a driving_audio_tour (WalkAbout / DriveAbout) keeps every point — each one is a
//    real narration stop with a role, a segment number and a geofence;
//  - a plain walk/hike keeps ONE marker per location (see mergeWalkSubPoints), because
//    a tour-style GPX names several points per location ("API1a-PS", "API1b", "API1c"…)
//    and importing each of them separately gave a Key Points list of rows titled "b",
//    "c", "d" that meant nothing (Enda, 2026-11-23).
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

    if (isDrivingAudioTour) {
      const isPS = nameTxt.includes('-PS') || /^\D*\d+a\b/.test(nameTxt);
      const role = isPS ? 'primary_start' : 'secondary';
      const segMatch = nameTxt.match(/^\D*(\d+)/);
      const segNum = segMatch ? String(parseInt(segMatch[1], 10)).padStart(2, '0').slice(-2) : String(i + 1).padStart(2, '0').slice(-2);
      const segId = buildSegmentId(code, segNum) || '';
      return {
        lat: parseFloat(wpt.getAttribute('lat')),
        lng: parseFloat(wpt.getAttribute('lon')),
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

    // Optional extension tags — present when a GPX was exported by this app (Save and
    // Download GPX) or hand-annotated from notes before import. A plain Garmin Explore
    // export has none of these, so every field falls back to its old default and import
    // behaves exactly as it did before.
    const typeTxt = wpt.getElementsByTagName('mc:type')[0]?.textContent?.trim();
    const labelTxt = wpt.getElementsByTagName('mc:label')[0]?.textContent?.trim();
    const imageUrls = Array.from(wpt.getElementsByTagName('mc:imageUrl'))
      .map(el => el.textContent?.trim())
      .filter(Boolean)
      .slice(0, MAX_WAYPOINT_IMAGES);

    return {
      lat: parseFloat(wpt.getAttribute('lat')),
      lng: parseFloat(wpt.getAttribute('lon')),
      segment_id: nameTxt,
      name: labelTxt || '',
      description: descTxt,
      type: typeTxt || 'landmark',
      image_urls: imageUrls,
      ...(ele !== null && !isNaN(ele) ? { elevation: Math.round(ele) } : {}),
    };
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  return isDrivingAudioTour ? built : mergeWalkSubPoints(built, code);
}