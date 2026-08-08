/**
 * Driving Audio Tour route export utilities.
 *
 * Handles validation, GPX generation and KML generation for driving audio tours.
 * Both exports are produced from the same edited route data — the user never
 * edits the route twice.
 */

import { getWaypointImages } from './waypointImages';

export const WAYPOINT_ROLE_COLOURS = {
  primary_start: '#22c55e',
  primary_stop: '#ef4444',
  secondary: '#3b82f6',
};

export const WAYPOINT_ROLE_LABELS = {
  primary_start: 'Primary-Start',
  primary_stop: 'Primary-Stop',
  secondary: 'Secondary',
};

export function getRoleColour(role) {
  return WAYPOINT_ROLE_COLOURS[role] || '#6366f1';
}

export function getRoleLabel(role) {
  return WAYPOINT_ROLE_LABELS[role] || role || 'Secondary';
}

/**
 * Build a Segment ID from a tour code and a 2-digit segment number.
 * Returns null if either part is invalid.
 */
export function buildSegmentId(tourCode, segmentNumber) {
  const code = (tourCode || '').trim().toUpperCase();
  const num = parseInt(String(segmentNumber || ''), 10);
  if (!/^[A-Z]{3}$/.test(code)) return null;
  if (isNaN(num) || num < 1) return null;
  return `${code}${num}`;
}

/**
 * Calculate the great-circle bearing (in degrees) from point 1 to point 2.
 * 0° = North, 90° = East, 180° = South, 270° = West.
 *
 * Used at runtime to derive the user's movement direction from successive
 * GPS fixes — NOT from the phone compass.
 */
export function calculateBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const toDeg = r => (r * 180) / Math.PI;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLng = toRad(lng2 - lng1);

  const y = Math.sin(deltaLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng);

  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return bearing;
}

/**
 * Check whether a movement bearing falls within the target bearing ± tolerance.
 *
 * Handles the 0°/360° wrap-around correctly, e.g.:
 *   target=10, tolerance=30 → valid 340° to 40°
 *   target=270, tolerance=30 → valid 240° to 300°
 */
export function isBearingInRange(movementBearing, targetBearing, tolerance) {
  const m = ((movementBearing % 360) + 360) % 360;
  const t = ((targetBearing % 360) + 360) % 360;
  const tol = Math.abs(tolerance);

  let diff = Math.abs(m - t);
  if (diff > 180) diff = 360 - diff;

  return diff <= tol;
}

/**
 * Validate a driving audio tour route.
 * Returns an array of error strings (empty if valid).
 */
export function validateDrivingTour(walk) {
  const errors = [];
  const tourCode = (walk.code || '').trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(tourCode)) {
    errors.push('Tour Code must be exactly 3 uppercase letters (A–Z).');
  }

  if (!walk.name?.trim()) {
    errors.push('Tour Name is required.');
  }

  const waypoints = walk.waypoints || [];

  if (waypoints.length === 0) {
    errors.push('At least one waypoint is required.');
    return errors;
  }

  // Collect all segment IDs to check the 99-segment limit
  const segmentIds = waypoints
    .map(wp => wp.segment_id)
    .filter(id => id);
  const uniqueSegments = new Set(segmentIds);

  if (uniqueSegments.size > 99) {
    errors.push('A tour cannot contain more than 99 narrated segments.');
  }

  let hasPrimaryStart = false;

  waypoints.forEach((wp, i) => {
    const idx = i + 1;
    const prefix = `Waypoint ${idx}`;

    if (isNaN(Number(wp.lat)) || wp.lat == null) {
      errors.push(`${prefix}: Latitude is required.`);
    }
    if (isNaN(Number(wp.lng)) || wp.lng == null) {
      errors.push(`${prefix}: Longitude is required.`);
    }

    if (!wp.waypoint_role) {
      errors.push(`${prefix}: Waypoint Role is required.`);
    } else if (wp.waypoint_role === 'primary_start') {
      hasPrimaryStart = true;
    }

    // Validate segment ID format
    if (wp.segment_id) {
      if (!/^[A-Z]{3}\d{2}$/.test(wp.segment_id)) {
        errors.push(`${prefix}: Segment ID "${wp.segment_id}" must be Tour Code + 2-digit number (e.g. BOR03).`);
      } else if (tourCode && !wp.segment_id.startsWith(tourCode)) {
        errors.push(`${prefix}: Segment ID "${wp.segment_id}" does not start with Tour Code "${tourCode}".`);
      }
    }

    // Average segment speed required on Primary-Start
    if (wp.waypoint_role === 'primary_start') {
      const speed = Number(wp.avg_segment_speed_kmh);
      if (isNaN(speed) || speed <= 0) {
        errors.push(`${prefix}: Average Segment Speed is required on Primary-Start waypoints.`);
      }
    }

    if (!wp.segment_title?.trim()) {
      errors.push(`${prefix}: Segment Title is required.`);
    }

    // Validate audio trigger configuration
    if (wp.trigger_audio) {
      if (!wp.audio_clip_url) {
        errors.push(`${prefix}: Audio Clip is required when Trigger Audio is enabled.`);
      }
      if (wp.trigger_radius_m != null && (Number(wp.trigger_radius_m) < 10 || Number(wp.trigger_radius_m) > 2000)) {
        errors.push(`${prefix}: Trigger Radius must be between 10 and 2000 metres.`);
      }
      if (wp.use_bearing) {
        const bd = Number(wp.bearing_direction);
        if (isNaN(bd) || bd < 0 || bd > 359) {
          errors.push(`${prefix}: Bearing Direction must be between 0 and 359 degrees.`);
        }
        const bt = Number(wp.bearing_tolerance);
        if (isNaN(bt) || bt < 0 || bt > 180) {
          errors.push(`${prefix}: Bearing Tolerance must be between 0 and 180 degrees.`);
        }
      }
    }
  });

  if (!hasPrimaryStart) {
    errors.push('At least one Primary-Start waypoint is required.');
  }

  return errors;
}

function xmlEscape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate a Magical Crete GPX file for a driving audio tour.
 *
 * Includes Segment ID, Segment Title, Waypoint Role, Waypoint Colour and
 * Average Segment Speed (where present).
 */
export function generateGpx(walk) {
  const tourCode = (walk.code || '').trim().toUpperCase();
  const tourName = walk.name || 'Driving Audio Tour';
  const description = walk.description || '';
  const trailPath = walk.trail_path || [];
  const waypoints = walk.waypoints || [];

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="Magical Crete Route Editor"');
  lines.push('  xmlns="http://www.topografix.com/GPX/1/1"');
  lines.push('  xmlns:mc="https://magicalcrete.com/gpx/extensions">');

  // Metadata
  lines.push('  <metadata>');
  lines.push(`    <name>${xmlEscape(tourName)}</name>`);
  if (description) {
    lines.push(`    <desc>${xmlEscape(description)}</desc>`);
  }
  lines.push('  </metadata>');

  // Route track from trail_path — one <trkseg> per run, so cut/break gaps are preserved
  if (trailPath.length > 0) {
    lines.push('  <trk>');
    lines.push(`    <name>${xmlEscape(tourName)}</name>`);
    for (const run of splitTrailRuns(trailPath, walk.trail_breaks)) {
      if (run.length === 0) continue;
      lines.push('    <trkseg>');
      for (const [lat, lng] of run) {
        lines.push(`      <trkpt lat="${lat}" lon="${lng}">`);
        lines.push('      </trkpt>');
      }
      lines.push('    </trkseg>');
    }
    lines.push('  </trk>');
  }

  // Waypoints with driving-tour extension data
  for (const wp of waypoints) {
    const ele = wp.elevation != null ? `\n    <ele>${wp.elevation}</ele>` : '';
    const wpName = wp.segment_id
      ? `${wp.segment_id} — ${wp.segment_title || ''}`.trim()
      : (wp.name || wp.segment_title || '');

    lines.push(`  <wpt lat="${wp.lat}" lon="${wp.lng}">${ele}`);

    if (wpName) {
      lines.push(`    <name>${xmlEscape(wpName)}</name>`);
    }
    if (wp.description) {
      lines.push(`    <desc>${xmlEscape(wp.description)}</desc>`);
    }

    // Driving tour extension data
    lines.push('    <extensions>');
    if (wp.waypoint_role) {
      lines.push(`      <mc:role>${xmlEscape(wp.waypoint_role)}</mc:role>`);
    }
    if (wp.segment_id) {
      lines.push(`      <mc:segmentId>${xmlEscape(wp.segment_id)}</mc:segmentId>`);
    }
    if (wp.segment_title) {
      lines.push(`      <mc:segmentTitle>${xmlEscape(wp.segment_title)}</mc:segmentTitle>`);
    }
    if (wp.waypoint_colour) {
      lines.push(`      <mc:colour>${xmlEscape(wp.waypoint_colour)}</mc:colour>`);
    }
    if (wp.avg_segment_speed_kmh != null && !isNaN(Number(wp.avg_segment_speed_kmh))) {
      lines.push(`      <mc:avgSpeedKmh>${Number(wp.avg_segment_speed_kmh)}</mc:avgSpeedKmh>`);
    }
    if (wp.trigger_audio) {
      lines.push('      <mc:triggerAudio>true</mc:triggerAudio>');
      if (wp.audio_clip_url) {
        lines.push(`      <mc:audioClipUrl>${xmlEscape(wp.audio_clip_url)}</mc:audioClipUrl>`);
      }
      if (wp.trigger_radius_m != null) {
        lines.push(`      <mc:triggerRadiusM>${Number(wp.trigger_radius_m)}</mc:triggerRadiusM>`);
      }
      lines.push(`      <mc:triggerOnce>${wp.trigger_once !== false}</mc:triggerOnce>`);
      if (wp.use_bearing) {
        lines.push('      <mc:useBearing>true</mc:useBearing>');
        lines.push(`      <mc:bearingDirection>${Number(wp.bearing_direction) || 0}</mc:bearingDirection>`);
        lines.push(`      <mc:bearingTolerance>${Number(wp.bearing_tolerance) || 30}</mc:bearingTolerance>`);
      }
    }
    lines.push('    </extensions>');

    lines.push('  </wpt>');
  }

  lines.push('</gpx>');
  return lines.join('\n');
}

/**
 * Generate a GPX file for a plain Walk/Hike tour (as opposed to a driving audio
 * tour — see generateGpx above). Used by the "Save and Download GPX" button in
 * the waypoint editor so an admin/narrator can keep a local backup of the full
 * amended route (track line + every waypoint's name, description, type, photo).
 *
 * <name> on each <wpt> is set to the waypoint's segment_id (e.g. "MXR3") because
 * that's what the existing GPX import matches on when re-importing a file — the
 * admin's own free-text name/description/type are also written into <mc:...>
 * extension tags so no data is lost even though today's importer doesn't yet
 * read them back in.
 */
export function generateWalkGpx(walk) {
  const tourName = walk.name || 'Walk / Hike';
  const description = walk.description || '';
  const trailPath = walk.trail_path || [];
  const waypoints = walk.waypoints || [];

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="Magical Crete Route Editor"');
  lines.push('  xmlns="http://www.topografix.com/GPX/1/1"');
  lines.push('  xmlns:mc="https://magicalcrete.com/gpx/extensions">');

  // Metadata
  lines.push('  <metadata>');
  lines.push(`    <name>${xmlEscape(tourName)}</name>`);
  if (description) {
    lines.push(`    <desc>${xmlEscape(description)}</desc>`);
  }
  lines.push('  </metadata>');

  // Route track from trail_path — one <trkseg> per run, so cut/break gaps are preserved
  if (trailPath.length > 0) {
    lines.push('  <trk>');
    lines.push(`    <name>${xmlEscape(tourName)}</name>`);
    for (const run of splitTrailRuns(trailPath, walk.trail_breaks)) {
      if (run.length === 0) continue;
      lines.push('    <trkseg>');
      for (const [lat, lng] of run) {
        lines.push(`      <trkpt lat="${lat}" lon="${lng}">`);
        lines.push('      </trkpt>');
      }
      lines.push('    </trkseg>');
    }
    lines.push('  </trk>');
  }

  // Waypoints
  for (const wp of waypoints) {
    const ele = wp.elevation != null ? `\n    <ele>${wp.elevation}</ele>` : '';
    const wptName = wp.segment_id || wp.name || 'Waypoint';

    lines.push(`  <wpt lat="${wp.lat}" lon="${wp.lng}">${ele}`);
    lines.push(`    <name>${xmlEscape(wptName)}</name>`);
    if (wp.description) {
      lines.push(`    <desc>${xmlEscape(wp.description)}</desc>`);
    }

    lines.push('    <extensions>');
    if (wp.type) {
      lines.push(`      <mc:type>${xmlEscape(wp.type)}</mc:type>`);
    }
    if (wp.name) {
      lines.push(`      <mc:label>${xmlEscape(wp.name)}</mc:label>`);
    }
    for (const url of getWaypointImages(wp)) {
      lines.push(`      <mc:imageUrl>${xmlEscape(url)}</mc:imageUrl>`);
    }
    lines.push('    </extensions>');

    lines.push('  </wpt>');
  }

  lines.push('</gpx>');
  return lines.join('\n');
}

/**
 * Generate a KML file for a driving audio tour.
 *
 * Contains one LineString for the complete route and one Placemark per
 * waypoint. Coordinates are in KML order: longitude, latitude, elevation.
 */
export function generateKml(walk) {
  const tourName = walk.name || 'Driving Audio Tour';
  const description = walk.description || '';
  const trailPath = walk.trail_path || [];
  const waypoints = walk.waypoints || [];

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  lines.push('  <Document>');
  lines.push(`    <name>${xmlEscape(tourName)}</name>`);
  if (description) {
    lines.push(`    <description>${xmlEscape(description)}</description>`);
  }

  // Route LineString(s) — one per run, so cut/break gaps are preserved (MultiGeometry)
  const kmlRuns = splitTrailRuns(trailPath, walk.trail_breaks).filter(r => r.length > 1);
  if (kmlRuns.length > 0) {
    lines.push('    <Placemark>');
    lines.push(`      <name>${xmlEscape(tourName)} — Route</name>`);
    lines.push('      <MultiGeometry>');
    for (const run of kmlRuns) {
      lines.push('        <LineString>');
      lines.push('          <tessellate>1</tessellate>');
      const coords = run.map(([lat, lng]) => `${lng},${lat},0`).join(' ');
      lines.push(`          <coordinates>${coords}</coordinates>`);
      lines.push('        </LineString>');
    }
    lines.push('      </MultiGeometry>');
    lines.push('    </Placemark>');
  }

  // Waypoint Placemarks
  for (const wp of waypoints) {
    const wpName = wp.segment_id
      ? `${wp.segment_id} — ${wp.segment_title || ''}`.trim()
      : (wp.name || wp.segment_title || 'Waypoint');

    const descParts = [];
    if (wp.segment_title) descParts.push(`Segment: ${wp.segment_title}`);
    if (wp.waypoint_role) descParts.push(`Role: ${getRoleLabel(wp.waypoint_role)}`);
    if (wp.description) descParts.push(wp.description);
    const kmlDesc = descParts.join(' — ');

    lines.push('    <Placemark>');
    lines.push(`      <name>${xmlEscape(wpName)}</name>`);
    if (kmlDesc) {
      lines.push(`      <description>${xmlEscape(kmlDesc)}</description>`);
    }
    lines.push('      <Point>');
    lines.push(`        <coordinates>${wp.lng},${wp.lat},${wp.elevation || 0}</coordinates>`);
    lines.push('      </Point>');
    lines.push('    </Placemark>');
  }

  lines.push('  </Document>');
  lines.push('</kml>');
  return lines.join('\n');
}

/**
 * Trigger a browser download of a text file.
 */
/**
 * Split a trail path into consecutive runs at the given break indices.
 * A break at index b means NO line is drawn between point b and point b+1.
 * Returns an array of runs; each run is an array of [lat, lng] pairs.
 */
export function splitTrailRuns(trailPath, breaks) {
  const breakSet = new Set((breaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1));
  const runs = [];
  let run = [];
  for (let i = 0; i < trailPath.length; i++) {
    run.push([trailPath[i].lat, trailPath[i].lng]);
    if (breakSet.has(i) || i === trailPath.length - 1) {
      runs.push(run);
      run = [];
    }
  }
  return runs;
}

export function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}