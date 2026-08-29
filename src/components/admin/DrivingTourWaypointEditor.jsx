import React, { useState, useEffect, useMemo } from 'react';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash2, ChevronDown, ChevronUp, Info, Loader2,
  Upload, FileCheck, Save, Flag, Square, Circle, GripVertical, Compass,
  ImagePlus, X, Lock, CheckCircle2,
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { getRoleColour, getRoleLabel, buildSegmentId } from '@/lib/routeExport';
import { compressImage, MAX_WAYPOINT_IMAGES, getWaypointImages } from '@/lib/waypointImages';
import { base44 } from '@/api/base44Client';
import AudioTriggerFields from './AudioTriggerFields';
import NarrationTtsEditor from './NarrationTtsEditor';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadScriptAsOdt } from '@/lib/odtExporter';

// Per Enda: once he marks a waypoint's narration text/breaks as finished, its script
// should auto-export as a .odt file — this becomes the master file he hands to
// Narrators via Narrator Scripts & TTS -> Translate Script, instead of him separately
// maintaining a matching .odt file by hand. Naming mirrors how Enda already names his
// own master .odt files: location code + this waypoint's letter position within that
// location (BOR1, BOR1a, BOR1b, ...), its role, and its title, so the file is
// identifiable without opening it.
function sanitizeFilenamePart(str) {
  return (str || '').replace(/[\\/:*?"<>|]/g, '-').trim();
}

function letterForIndexInGroup(index, segGroup) {
  if (!segGroup) return '';
  const pos = index - segGroup.startIndex;
  if (pos < 0) return '';
  if (pos < 26) return String.fromCharCode(97 + pos); // a, b, c, ...
  return `-${pos + 1}`; // extremely long location group — fall back to a number
}

function buildNarrationExportFilename(wp, segGroup, index) {
  const locationLabel = wp.segment_id || (wp.segment_number ? `Location ${wp.segment_number}` : `Waypoint ${index + 1}`);
  const letter = letterForIndexInGroup(index, segGroup);
  const roleLabel = getRoleLabel(wp.waypoint_role);
  const parts = [`${locationLabel}${letter}`, roleLabel, wp.segment_title]
    .filter(Boolean)
    .map(sanitizeFilenamePart);
  return `${parts.join(' - ')}.odt`;
}

const ROLES = [
  { value: 'primary_start', label: 'Primary-Start', icon: Flag },
  { value: 'primary_stop', label: 'Primary-Stop', icon: Square },
  { value: 'secondary', label: 'Secondary', icon: Circle },
];

const EMPTY_WP = {
  lat: '',
  lng: '',
  waypoint_done: false,
  waypoint_role: 'secondary',
  segment_number: '',
  segment_title: '',
  avg_segment_speed_kmh: 50,
  description: '',
  narration_script: '',
  trigger_audio: false,
  audio_clip_url: '',
  trigger_radius_m: 30,
  trigger_once: true,
  use_bearing: false,
  bearing_direction: 0,
  bearing_tolerance: 30,
  image_urls: [],
};

function autoColour(role) {
  return getRoleColour(role);
}

const VALID_ROLES = ['primary_start', 'primary_stop', 'secondary'];

function parseGpxCoords(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const wpts = Array.from(doc.querySelectorAll('wpt'));
  return wpts.map(wpt => {
    const roleTxt = wpt.getElementsByTagName('mc:role')[0]?.textContent?.trim();
    return {
      lat: parseFloat(wpt.getAttribute('lat')),
      lng: parseFloat(wpt.getAttribute('lon')),
      elevation: wpt.querySelector('ele') ? parseFloat(wpt.querySelector('ele').textContent) : null,
      name: wpt.querySelector('name')?.textContent?.trim() || '',
      // Optional extras — present when the file was pre-annotated with the Waypoint GPX Builder
      // tool. A plain Garmin Explore export has neither, so both fall back to their old
      // behaviour: description stays blank, role is inferred from the naming convention.
      description: wpt.querySelector('desc')?.textContent?.trim() || '',
      role: VALID_ROLES.includes(roleTxt) ? roleTxt : null,
    };
  }).filter(wp => !isNaN(wp.lat) && !isNaN(wp.lng));
}

/**
 * Extract the actual route LINE from a GPX file — the dense trkpt/rtept sequence that follows
 * real roads/streets — completely separate from the sparse named <wpt> points parsed above.
 * Garmin Explore writes a proper road-following <trk> or <rte> when a route is drawn along
 * streets, but that was previously being discarded entirely: only the named waypoint pins were
 * ever read, so the map line just cut straight between them regardless of what roads existed
 * between two points. Falls back to the waypoints themselves only if the file truly has no
 * track/route data at all (matches the same trkpt → rtept → wpt fallback order used for
 * Walk/Hike GPX import in WalkEditor.jsx).
 */
function parseGpxTrail(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const toPoints = (els) => Array.from(els).map(el => ({
    lat: parseFloat(el.getAttribute('lat')),
    lng: parseFloat(el.getAttribute('lon')),
  })).filter(pt => !isNaN(pt.lat) && !isNaN(pt.lng));

  const trkpts = toPoints(doc.querySelectorAll('trkpt'));
  if (trkpts.length > 1) return trkpts;
  const rtepts = toPoints(doc.querySelectorAll('rtept'));
  if (rtepts.length > 1) return rtepts;
  return toPoints(doc.querySelectorAll('wpt'));
}

/**
 * Parse a waypoint name following the convention XXX<segment><letter>[-PS]
 * e.g. "BRZ1a-PS Bikakis Bakery" → { segment: 1, letter: 'a', isPrimaryStart: true }
 * e.g. "BRZ12h Old Fountain"     → { segment: 12, letter: 'h', isPrimaryStart: false }
 * The code is extracted from the START of the name; trailing description text is ignored.
 * A point with letter 'a' is always treated as a Primary-Start (segment start).
 * Returns null if the name doesn't match the convention.
 */
function parseWpNameSortKey(name) {
  if (!name) return null;
  const m = name.match(/^([A-Z]{3})(\d+)([a-z])(?:-PS)?(?:\s|$)/);
  if (!m) return null;
  return {
    segment: parseInt(m[2], 10),
    letterOrder: m[3].charCodeAt(0) - 96, // a=1, b=2, …
    isPrimaryStart: m[3] === 'a' || name.includes('-PS'),
  };
}

/**
 * Sort waypoints by their naming convention: segment number first, then letter.
 * Waypoints that don't match the convention are kept at the end in original order.
 */
function sortWaypointsByName(points) {
  return [...points].sort((a, b) => {
    const ka = parseWpNameSortKey(a.name);
    const kb = parseWpNameSortKey(b.name);
    if (ka && kb) {
      if (ka.segment !== kb.segment) return ka.segment - kb.segment;
      return ka.letterOrder - kb.letterOrder;
    }
    if (ka) return -1;
    if (kb) return 1;
    return 0;
  });
}

// Build a road-following polyline between ordered waypoints (OSRM) for a driving tour
// whose GPX import had no recorded track/route line.
const routeWaypoints = async (points) => {
  const res = await base44.functions.invoke('routeWaypoints', { points, ...getNarratorAuthPayload() });
  return res.data.trail;
};

export default function DrivingTourWaypointEditor({ waypoints, onChange, tourCode, tourCategory, onSave, saving, onAutoSave, userRole = 'admin', focusWaypointIndex, onTrailPathChange, defaultDrivingSpeedKmh, targetLanguage }) {
  const isNarrator = userRole === 'narrator';
  // WBT is always fixed at 3.5 km/h. DDV falls back to the Admin-set default
  // driving speed from the Details tab (form.default_driving_speed_kmh) until a
  // Primary-Start waypoint sets its own avg_segment_speed_kmh; 50 is the last-resort
  // fallback only if an Admin hasn't set anything yet.
  const defaultSpeed = tourCategory === 'WBT' ? 3.5 : (defaultDrivingSpeedKmh || 50);
  const [expanded, setExpanded] = useState(focusWaypointIndex != null ? focusWaypointIndex : null);
  const [newWp, setNewWp] = useState({ ...EMPTY_WP, avg_segment_speed_kmh: defaultSpeed });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState('');
  const [gpxImportResult, setGpxImportResult] = useState(null);

  // Group consecutive waypoints by their DISPLAYED location label (segment_id,
  // e.g. "BOR1" — see the bold text on each row), not the raw segment_number.
  // segment_id is always derived via buildSegmentId(), which normalises
  // segment_number through parseInt() — so "01" and "1" both display as
  // "BOR1". Grouping on the raw segment_number string instead would treat
  // those as two different groups even though they show the same label,
  // which is exactly what caused every single waypoint to get its own
  // divider line (see follow-up 67). Falls back to segment_number only for
  // the rare waypoint that has no segment_id yet.
  const segmentGroups = useMemo(() => {
    const groups = {};
    waypoints.forEach((wp, index) => {
      const seg = wp.segment_id || wp.segment_number;
      if (!groups[seg]) groups[seg] = { segmentNumber: seg, startIndex: index, endIndex: index, waypoints: [] };
      groups[seg].endIndex = index;
      groups[seg].waypoints.push(wp);
    });
    return groups;
  }, [waypoints]);

  // Per Enda's report: editing must happen strictly in sequence — if an earlier
  // waypoint (e.g. BOR3c) isn't marked Done, nobody should be able to open a LATER one
  // (BOR3d) at all, whether to write its script or just to look at it. TourSimulator.jsx
  // already enforces exactly this rule for its own "Jump to location…" dropdown
  // (lockedWpIndexes there) — this is the same computation, applied here in the one
  // place waypoints are actually authored and marked Done, which never had it at all.
  // lockedIndexes[i] is true the moment ANY earlier waypoint (0..i-1) isn't done yet;
  // index 0 has no priors, so it's never locked. Recomputed from scratch off
  // `waypoints` every render pass it changes, so ticking/unticking "done" anywhere
  // immediately locks/unlocks everything after it, same as TourSimulator.jsx's own copy.
  const lockedIndexes = useMemo(() => {
    const locked = new Array(waypoints.length).fill(false);
    let allPriorDone = true;
    for (let i = 0; i < waypoints.length; i++) {
      locked[i] = !allPriorDone;
      if (!waypoints[i]?.waypoint_done) allPriorDone = false;
    }
    return locked;
  }, [waypoints]);

  useEffect(() => {
    if (focusWaypointIndex != null) {
      // Defensive only — whatever sends someone here (e.g. "continue where you left
      // off") should always land on a legitimately reachable waypoint already, but
      // never force one open that the sequence itself says isn't reachable yet. Still
      // scrolls to it either way, so it's visible rather than silently doing nothing.
      if (!lockedIndexes[focusWaypointIndex]) setExpanded(focusWaypointIndex);
      const timer = setTimeout(() => {
        const el = document.getElementById(`wp-row-${focusWaypointIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [focusWaypointIndex, lockedIndexes]);

  // Auto-fill missing segment_number and segment_id on mount
  useEffect(() => {
    if (!waypoints || waypoints.length === 0) return;
    const needsUpdate = waypoints.some(wp => !wp.segment_number || (!wp.segment_id && wp.segment_number));
    if (!needsUpdate) return;
    let nextSeg = 1;
    const updated = waypoints.map(wp => {
      let segNum = wp.segment_number;
      if (!segNum) {
        segNum = String(nextSeg).padStart(2, '0');
        nextSeg++;
      } else {
        nextSeg = Math.max(nextSeg, parseInt(segNum, 10) + 1);
      }
      const segId = wp.segment_id || buildSegmentId(tourCode, segNum) || '';
      return { ...wp, segment_number: segNum, segment_id: segId };
    });
    onChange(updated);
  }, []);

  const nextSegmentNumber = () => {
    const used = waypoints
      .map(wp => parseInt(wp.segment_number, 10))
      .filter(n => !isNaN(n));
    const max = used.length > 0 ? Math.max(...used) : 0;
    return String(max + 1).padStart(2, '0');
  };

  const addWaypoint = () => {
    setAddError('');
    const lat = parseFloat(String(newWp.lat).replace(',', '.'));
    const lng = parseFloat(String(newWp.lng).replace(',', '.'));

    if (isNaN(lat) || String(newWp.lat).trim() === '') {
      setAddError('Please enter a valid latitude.');
      return;
    }
    if (isNaN(lng) || String(newWp.lng).trim() === '') {
      setAddError('Please enter a valid longitude.');
      return;
    }
    if (!newWp.segment_title.trim()) {
      setAddError('Location Title is required.');
      return;
    }
    if (newWp.waypoint_role === 'primary_start') {
      const speed = parseFloat(newWp.avg_segment_speed_kmh);
      if (isNaN(speed) || speed <= 0) {
        setAddError('Average Segment Speed is required for Primary-Start waypoints.');
        return;
      }
    }

    const segNum = newWp.segment_number || nextSegmentNumber();
    const segId = buildSegmentId(tourCode, segNum) || '';
    const role = newWp.waypoint_role;

    const wp = {
      lat,
      lng,
      waypoint_role: role,
      segment_number: segNum,
      segment_id: segId,
      segment_title: newWp.segment_title.trim(),
      avg_segment_speed_kmh: newWp.avg_segment_speed_kmh ? parseFloat(newWp.avg_segment_speed_kmh) : null,
      description: newWp.description.trim(),
      narration_script: newWp.narration_script || '',
      trigger_audio: newWp.trigger_audio || false,
      audio_clip_url: newWp.audio_clip_url || '',
      trigger_radius_m: newWp.trigger_radius_m != null ? Number(newWp.trigger_radius_m) : 150,
      trigger_once: newWp.trigger_once !== false,
      use_bearing: newWp.use_bearing || false,
      bearing_direction: Number(newWp.bearing_direction) || 0,
      bearing_tolerance: Number(newWp.bearing_tolerance) || 30,
      waypoint_colour: autoColour(role),
      name: newWp.segment_title.trim(),
      type: role,
    };

    onChange([...waypoints, wp]);
    setNewWp({ ...EMPTY_WP, avg_segment_speed_kmh: defaultSpeed, segment_number: nextSegmentNumber() });
    setShowAddForm(false);
    setExpanded(null);
  };

  const removeWaypoint = (index) => {
    onChange(waypoints.filter((_, i) => i !== index));
    if (expanded === index) setExpanded(null);
  };

  // Per Enda's follow-up 53 report: this is the actual cause of BOR1a-PS's audio
  // going missing after a clean re-record — traced from a DevTools Network tab
  // screenshot showing uploadNarrationAudio and saveWalkForBackend BOTH succeeding
  // (200s, a real URL came back), which ruled out a network/save failure and
  // pointed upstream, into how the three fields below get applied to `form` before
  // any save ever fires.
  //
  // `updateWaypoint(index, field, value)` used to always rebuild the FULL waypoints
  // array from this component's own `waypoints` PROP — fine for a single call, but
  // "Finalize Narration Audio" makes THREE calls back-to-back in one synchronous
  // handler (audio_clip_url, then trigger_audio, then waypoint_done — see
  // onAudioChange below), and `waypoints` doesn't change between them: this
  // component hasn't re-rendered yet, so all three calls read the exact same
  // snapshot. Each one computed a brand-new full array from that SAME stale
  // snapshot and handed it to `onChange` — so the SECOND call's array has
  // trigger_audio set but was built from a version of the waypoint that never had
  // audio_clip_url on it yet, and the THIRD call's array (waypoint_done) was built
  // from that same original snapshot too. Whichever call's array reaches WalkEditor
  // LAST wins outright for this waypoint (nothing merges them) — so the actual
  // audio_clip_url and trigger_audio changes from calls one and two were silently
  // overwritten back to nothing by call three's own snapshot, the moment the
  // waypoint_done call went out. waypoint_done itself DID stick (it was the last
  // call), which is exactly why the waypoint could look "done" while its audio
  // stayed missing — the save that followed faithfully persisted this already-wrong
  // form, which is why the network trace showed nothing failing.
  //
  // Fix: `updateWaypoint` now also accepts an object of several field:value pairs,
  // applied together in ONE array rebuild — so a caller that needs to change more
  // than one field on the same waypoint (like onAudioChange below) does it in a
  // single call instead of several racing ones. The old (index, field, value) form
  // still works unchanged for every other caller in this file.
  const updateWaypoint = (index, fieldOrFields, value) => {
    const fields = (fieldOrFields && typeof fieldOrFields === 'object')
      ? fieldOrFields
      : { [fieldOrFields]: value };
    const updated = waypoints.map((wp, i) => {
      if (i !== index) return wp;
      const next = { ...wp, ...fields };
      if ('waypoint_role' in fields) {
        next.waypoint_colour = autoColour(fields.waypoint_role);
        next.type = fields.waypoint_role;
      }
      if ('segment_number' in fields || 'waypoint_role' in fields) {
        next.segment_id = buildSegmentId(tourCode, next.segment_number) || '';
        next.name = next.segment_title || next.name;
      }
      if ('segment_title' in fields) {
        next.name = fields.segment_title;
      }
      // Any audio_clip_url change made through the normal editing flow — a fresh
      // TTS render, a manual re-upload, clearing it — means whatever is now
      // attached is no longer the vetted PCV (Professional Cloned Voice) replacement. Only the
      // Update Audio tool (a separate screen, outside this editor) is allowed
      // to set final_audio_applied back to true.
      if ('audio_clip_url' in fields) {
        next.final_audio_applied = false;
      }
      return next;
    });
    onChange(updated);
  };

  const [uploadingImageIndex, setUploadingImageIndex] = useState(null);

  const handleImageUpload = async (file, index) => {
    setUploadingImageIndex(index);
    const compressed = await compressImage(file);
    const { file_url } = await base44.integrations.Core.UploadFile({ file: compressed });
    const current = getWaypointImages(waypoints[index]);
    if (current.length < MAX_WAYPOINT_IMAGES) {
      updateWaypoint(index, 'image_urls', [...current, file_url]);
    }
    setUploadingImageIndex(null);
  };

  const removeImage = (index, imgIndex) => {
    const current = getWaypointImages(waypoints[index]);
    updateWaypoint(index, 'image_urls', current.filter((_, i) => i !== imgIndex));
  };

  const onDragEnd = (result) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const updated = [...waypoints];
    const [moved] = updated.splice(result.source.index, 1);
    updated.splice(result.destination.index, 0, moved);
    onChange(updated);
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text');
    const match = text.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (match) {
      e.preventDefault();
      setNewWp(prev => ({ ...prev, lat: match[1], lng: match[2] }));
    }
  };

  const handleGpxImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (waypoints.length > 0) {
      if (!window.confirm(`This will replace all ${waypoints.length} existing waypoints with the ones from the GPX file. Continue?`)) {
        e.target.value = '';
        return;
      }
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const parsed = parseGpxCoords(ev.target.result);
      if (parsed.length === 0) {
        setGpxImportResult({ error: 'No waypoints found in this GPX file.' });
        return;
      }

      // Sort by naming convention: XXX<segment><letter>[-PS]
      const sorted = sortWaypointsByName(parsed);

      const imported = sorted.map((pt) => {
        const key = parseWpNameSortKey(pt.name);
        const isPS = key ? key.isPrimaryStart : false;
        const segNum = key
          ? String(key.segment).padStart(2, '0').slice(-2)
          : '01';
        const segId = buildSegmentId(tourCode, segNum) || '';
        // An explicit role from the file (set via the Waypoint GPX Builder tool) always wins —
        // it's unambiguous. Otherwise fall back to the naming-convention guess, same as before.
        const role = pt.role || (isPS ? 'primary_start' : 'secondary');
        return {
          lat: pt.lat,
          lng: pt.lng,
          elevation: pt.elevation,
          waypoint_role: role,
          segment_number: segNum,
          segment_id: segId,
          segment_title: pt.name || `Segment ${segNum}`,
          avg_segment_speed_kmh: defaultSpeed,
          description: pt.description || '',
          narration_script: '',
          trigger_audio: false,
          audio_clip_url: '',
          trigger_radius_m: 30,
          trigger_once: true,
          use_bearing: false,
          bearing_direction: 0,
          bearing_tolerance: 30,
          waypoint_colour: autoColour(role),
          name: pt.name || (segId ? `${segId} — Segment ${segNum}` : `Segment ${segNum}`),
          type: role,
          image_urls: [],
        };
      });
      onChange(imported);

      // Import the actual road-following route line too, separately from the sparse named
      // waypoints above — this is what was missing, causing the map to draw straight lines
      // between waypoints instead of following real streets.
      let trailPointCount = 0;
      let trailIsRealTrack = false;
      if (onTrailPathChange) {
        const trail = parseGpxTrail(ev.target.result);
        if (trail.length > 1) {
          onTrailPathChange(trail);
          trailPointCount = trail.length;
          // A real track/route has far more points than there are named waypoints — a sparse
          // fallback (waypoints-as-trail) will have roughly the same count as `imported`.
          trailIsRealTrack = trail.length > imported.length * 1.5;
        }
      }

      setGpxImportResult({ count: imported.length, trailPointCount, trailIsRealTrack, routing: false });

      // No real track in the file — route along roads between the ordered waypoints so a
      // driving tour doesn't render as straight lines between sparse pins.
      if (onTrailPathChange && !trailIsRealTrack && imported.length >= 2) {
        setGpxImportResult({ count: imported.length, trailPointCount, trailIsRealTrack, routing: true });
        try {
          const ordered = imported.map(wp => ({ lat: wp.lat, lng: wp.lng }));
          const routed = await routeWaypoints(ordered);
          if (routed && routed.length > 1) {
            onTrailPathChange(routed);
            trailPointCount = routed.length;
            trailIsRealTrack = true;
            setGpxImportResult({ count: imported.length, trailPointCount, trailIsRealTrack, routing: false, routed: true });
          } else {
            setGpxImportResult({ count: imported.length, trailPointCount, trailIsRealTrack, routing: false, routeError: true });
          }
        } catch (err) {
          console.warn('Road routing failed:', err);
          setGpxImportResult({ count: imported.length, trailPointCount, trailIsRealTrack, routing: false, routeError: true });
        }
      }
      setTimeout(() => setGpxImportResult(null), 5000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-white font-semibold mb-1">Tour Waypoints</h3>
        <div className="flex items-start gap-2 bg-purple-900/30 border border-purple-700/50 rounded-lg p-3 text-sm text-purple-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {isNarrator
              ? 'Edit narration scripts and audio triggers for each waypoint below. All other fields are managed by the admin.'
              : `Define Primary-Start, Primary-Stop and Secondary points. Location IDs are built from the Tour Code (${tourCode || '—'}) + the segment number (e.g. BRZ1, BRZ2).`}
          </span>
        </div>
      </div>

      {/* GPX Import - admin only */}
      {!isNarrator && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 rounded-lg px-4 py-2 text-blue-300 hover:text-blue-100 transition-colors text-sm font-medium">
            <Upload className="w-4 h-4" />
            Import GPX Waypoints
            <input type="file" accept=".gpx,application/gpx+xml" className="hidden" onChange={handleGpxImport} />
          </label>
          {gpxImportResult && (
            gpxImportResult.error
              ? <span className="text-red-400 text-sm">{gpxImportResult.error}</span>
              : (
                <span className="flex items-center gap-1 text-green-400 text-sm">
                  {gpxImportResult.routing
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <FileCheck className="w-4 h-4" />} {gpxImportResult.count} waypoint{gpxImportResult.count !== 1 ? 's' : ''} imported
                  {gpxImportResult.routing ? (
                    <span className="text-slate-400 ml-1">— building road-following route…</span>
                  ) : gpxImportResult.routed ? (
                    <span className="text-slate-400 ml-1">— route follows roads ({gpxImportResult.trailPointCount} points)</span>
                  ) : gpxImportResult.routeError ? (
                    <span className="text-amber-400 ml-1">— ⚠ road routing failed, route connects waypoints in a straight line. Use the Trail tab to trace it.</span>
                  ) : gpxImportResult.trailIsRealTrack ? (
                    <span className="text-slate-400 ml-1">— route line follows the recorded track ({gpxImportResult.trailPointCount} points)</span>
                  ) : gpxImportResult.trailPointCount > 0 ? (
                    <span className="text-amber-400 ml-1">— ⚠ no track/route found in this file, route line just connects the waypoints in a straight line. Use the Trail tab to trace the real streets if needed.</span>
                  ) : null}
                </span>
              )
          )}
        </div>
      )}

      {/* Add new waypoint form - admin only */}
      {!isNarrator && (
        <div className="bg-slate-700/50 rounded-lg border border-slate-600 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAddForm(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-purple-400" />
              Add New Waypoint
            </span>
            {showAddForm ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {showAddForm && (
            <div className="px-4 pb-4 pt-1 border-t border-slate-600 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-400 text-xs mb-1 block">Latitude *</Label>
                  <Input
                    type="number" step="0.000001"
                    value={newWp.lat}
                    onChange={e => setNewWp(p => ({ ...p, lat: e.target.value }))}
                    onPaste={handlePaste}
                    placeholder="35.301900"
                    className="bg-slate-700 border-slate-500 text-white font-mono"
                  />
                </div>
                <div>
                  <Label className="text-slate-400 text-xs mb-1 block">Longitude *</Label>
                  <Input
                    type="number" step="0.000001"
                    value={newWp.lng}
                    onChange={e => setNewWp(p => ({ ...p, lng: e.target.value }))}
                    placeholder="23.963300"
                    className="bg-slate-700 border-slate-500 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-400 text-xs mb-1 block">Waypoint Role *</Label>
                  <Select value={newWp.waypoint_role} onValueChange={v => setNewWp(p => ({ ...p, waypoint_role: v }))}>
                    <SelectTrigger className="bg-slate-700 border-slate-500 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-400 text-xs mb-1 block">Segment Number</Label>
                  <Input
                    type="number" min="1"
                    value={newWp.segment_number}
                    onChange={e => setNewWp(p => ({ ...p, segment_number: e.target.value }))}
                    placeholder={nextSegmentNumber()}
                    className="bg-slate-700 border-slate-500 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <Label className="text-slate-400 text-xs mb-1 block">Location Title *</Label>
                <Input
                  value={newWp.segment_title}
                  onChange={e => setNewWp(p => ({ ...p, segment_title: e.target.value }))}
                  placeholder="e.g. Leaving Chania Old Town"
                  className="bg-slate-700 border-slate-500 text-white"
                />
              </div>

              <div>
                <Label className="text-slate-400 text-xs mb-1 block">
                  Average Segment Speed (km/h)
                  <span className="ml-1 text-purple-400">defaults to {defaultSpeed}</span>
                </Label>
                <Input
                  type="number" step="0.1"
                  value={newWp.avg_segment_speed_kmh}
                  onChange={e => setNewWp(p => ({ ...p, avg_segment_speed_kmh: e.target.value }))}
                  placeholder={String(defaultSpeed)}
                  className="bg-slate-700 border-slate-500 text-white"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Segment ID:</span>
                <code className="bg-slate-800 px-2 py-0.5 rounded text-purple-300 font-mono">
                  {buildSegmentId(tourCode, newWp.segment_number || nextSegmentNumber()) || '—'}
                </code>
                <span className="ml-2">Colour:</span>
                <span
                  className="inline-block w-4 h-4 rounded-full border border-slate-500"
                  style={{ backgroundColor: autoColour(newWp.waypoint_role) }}
                />
                <span className="text-slate-500">auto-assigned</span>
              </div>

              {addError && (
                <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
                  {addError}
                </div>
              )}
              <Button onClick={addWaypoint} className="bg-purple-600 hover:bg-purple-700 gap-2 w-full text-white font-semibold">
                <Plus className="w-4 h-4" /> Save Waypoint
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Existing waypoints */}
      {waypoints.length === 0 ? (
        <div className="text-center py-8 text-slate-500 border border-dashed border-slate-600 rounded-lg">
          {isNarrator ? 'No waypoints assigned to this tour yet.' : 'No waypoints yet. Add tour points above.'}
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="waypoints">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
           {waypoints.map((wp, index) => {
             const colour = wp.waypoint_colour || autoColour(wp.waypoint_role);
             const segGroup = segmentGroups[wp.segment_id || wp.segment_number];
             // Per Enda: a colour dot alone doesn't read as "new location" at a
             // glance — draw a visible divider line above the first waypoint of
             // every location group after the first, labelled with that
             // location's code, so the list doesn't look like one continuous
             // run of waypoints.
             const isNewLocation = segGroup && index === segGroup.startIndex && index > 0;
             return (
              <React.Fragment key={index}>
              {isNewLocation && (
                <div className="flex items-center gap-3 pt-4 pb-1 px-1">
                  <div className="h-px flex-1 bg-amber-500/70" />
                  <span className="text-xs font-semibold text-amber-400 tracking-wider uppercase shrink-0">
                    {wp.segment_id || `Location ${wp.segment_number}`}
                  </span>
                  <div className="h-px flex-1 bg-amber-500/70" />
                </div>
              )}
              <Draggable draggableId={`wp-${index}`} index={index} isDragDisabled={isNarrator}>
                {(dragProvided, snapshot) => (
              <div
                id={`wp-row-${index}`}
                ref={dragProvided.innerRef}
                {...dragProvided.draggableProps}
                className={`bg-slate-700/50 rounded-lg border border-slate-600 overflow-hidden ${snapshot.isDragging ? 'shadow-2xl shadow-purple-900/50 ring-2 ring-purple-500' : ''} ${focusWaypointIndex === index ? 'ring-2 ring-amber-500' : ''}`}
              >
                <div
                  className={`flex items-center gap-3 px-3 py-3 hover:bg-slate-700/80 ${(wp.waypoint_done || lockedIndexes[index]) && expanded !== index ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={() => {
                    if (wp.waypoint_done && expanded !== index) return;
                    // Sequential lock — see lockedIndexes above. A not-yet-done
                    // waypoint that sits after an unfinished earlier one can't be
                    // opened at all, same as an already-Done one can't be re-opened
                    // without unticking it first.
                    if (lockedIndexes[index] && expanded !== index) return;
                    setExpanded(expanded === index ? null : index);
                  }}
                  title={lockedIndexes[index] && !wp.waypoint_done && expanded !== index ? 'Locked — finish every earlier waypoint first' : undefined}
                >
                  {!isNarrator && (
                    <div
                      {...dragProvided.dragHandleProps}
                      onClick={e => e.stopPropagation()}
                      className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 touch-none"
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-5 h-5" />
                    </div>
                  )}
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 border border-slate-400"
                    style={{ backgroundColor: colour }}
                    title={getRoleLabel(wp.waypoint_role)}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-white font-medium">{wp.segment_id || '—'}</span>
                    <span className="ml-2 text-xs text-slate-400">{wp.segment_title}</span>
                    {wp.elevation != null && (
                      <span className="ml-2 text-xs text-amber-400 font-medium">{Math.round(wp.elevation)} m</span>
                    )}
                    {wp.avg_segment_speed_kmh != null && (
                      <span className="ml-2 text-xs text-slate-500">{wp.avg_segment_speed_kmh} km/h</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">{getRoleLabel(wp.waypoint_role)}</span>
                  <span
                    className="flex items-center gap-1 shrink-0"
                    onClick={e => e.stopPropagation()}
                    title={wp.waypoint_done ? 'Done — untick to edit again' : 'Mark as done from inside the waypoint editor'}
                  >
                    <Checkbox
                      checked={!!wp.waypoint_done}
                      disabled={!wp.waypoint_done}
                      onCheckedChange={(checked) => {
                        if (!checked) {
                          updateWaypoint(index, 'waypoint_done', false);
                          // Per Enda's follow-up 47 report: a narrator can no longer
                          // reach this checkbox at all (no Waypoints tab access) if
                          // they lock a segment by mistake — the admin unlocking it
                          // for them here is now the only way. Same rule as every
                          // other "sounds final" action fixed today: request a real
                          // save immediately, so unlocking a waypoint doesn't quietly
                          // sit unsaved until someone remembers to click Save Route.
                          onAutoSave?.();
                        }
                      }}
                      className="border-amber-400 data-[state=checked]:bg-amber-400 data-[state=checked]:border-amber-400 data-[state=checked]:text-slate-900 disabled:opacity-100"
                    />
                  </span>
                  {wp.waypoint_done && expanded !== index ? (
                    <Lock className="w-4 h-4 text-amber-400" />
                  ) : lockedIndexes[index] && expanded !== index ? (
                    // Distinct grey (not the amber "Done" lock) — this one isn't
                    // finished, it's just not reachable YET because something earlier
                    // in the sequence still needs finishing first.
                    <Lock className="w-4 h-4 text-slate-500" />
                  ) : (
                    expanded === index ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                  {!isNarrator && (
                    <Button
                      variant="ghost" size="icon"
                      onClick={e => { e.stopPropagation(); removeWaypoint(index); }}
                      className="text-slate-500 hover:text-red-400 w-7 h-7"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>

                {expanded === index && (
                  <div className="px-4 pb-4 border-t border-slate-600 pt-4 space-y-3">
                    {isNarrator ? (
                      <>
                        {/* Read-only context for narrators */}
                        <div className="grid grid-cols-2 gap-3">

                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Role</Label>
                            <Input value={getRoleLabel(wp.waypoint_role)} readOnly className="bg-slate-800 border-slate-600 text-slate-400 h-8 text-sm" />
                          </div>
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Elevation (m)</Label>
                            <Input
                              value={wp.elevation != null ? Math.round(wp.elevation) : '—'}
                              readOnly
                              className="bg-slate-800 border-slate-600 text-amber-400 font-medium h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-slate-400 text-xs mb-1 block">Location Title</Label>
                          <Input value={wp.segment_title || ''} readOnly className="bg-slate-800 border-slate-600 text-slate-300 h-8 text-sm" />
                        </div>
                        {wp.description && (
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Description</Label>
                            <Input value={wp.description} readOnly className="bg-slate-800 border-slate-600 text-slate-300 h-8 text-sm" />
                          </div>
                        )}
                        {getWaypointImages(wp).length > 0 && (
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Photos</Label>
                            <div className="flex flex-wrap gap-2">
                              {getWaypointImages(wp).map((url, i) => (
                                <div key={i} className="w-16 h-16 rounded-lg overflow-hidden border border-slate-600 shrink-0">
                                  <img src={url} alt="waypoint" className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Editable: Narration Script & TTS */}
                        <NarrationTtsEditor
                          script={wp.narration_script || ''}
                          audioUrl={wp.audio_clip_url || ''}
                          onScriptChange={(val) => updateWaypoint(index, 'narration_script', val)}
                          onAudioChange={(val) => {
                            // Per Enda's follow-up 53 report: these three fields are set
                            // atomically in ONE updateWaypoint call now — see the long
                            // comment on updateWaypoint above for why three SEPARATE calls
                            // here used to silently discard audio_clip_url and
                            // trigger_audio, keeping only waypoint_done (the last call).
                            updateWaypoint(index, val
                              // Per Enda's follow-up 44 report: "finished narrating this
                              // waypoint" and "waypoint marked as done" are the same
                              // moment in practice, not two separate steps — this fires
                              // only once, right when Finalize Narration Audio actually
                              // succeeds (a real url comes back), same as TourSimulator.jsx.
                              ? { audio_clip_url: val, trigger_audio: true, waypoint_done: true }
                              : { audio_clip_url: val });
                          }}
                          onAutoSave={onAutoSave}
                          fixedLanguage={targetLanguage}
                          waypointSegmentId={wp.segment_id}
                          waypointSegmentTitle={wp.segment_title}
                        />

                        {/* Editable: Audio Trigger Fields */}
                        <AudioTriggerFields
                          wp={wp}
                          onChange={(field, value) => updateWaypoint(index, field, value)}
                        />
                      </>
                    ) : (
                      <>
                        {/* Admin: all fields except narration_script; simple audio upload */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Latitude</Label>
                            <Input
                              type="number" step="0.000001"
                              value={wp.lat}
                              onChange={e => updateWaypoint(index, 'lat', parseFloat(e.target.value))}
                              className="bg-slate-700 border-slate-500 text-white font-mono h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Longitude</Label>
                            <Input
                              type="number" step="0.000001"
                              value={wp.lng}
                              onChange={e => updateWaypoint(index, 'lng', parseFloat(e.target.value))}
                              className="bg-slate-700 border-slate-500 text-white font-mono h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Elevation (m)</Label>
                            <Input
                              value={wp.elevation != null ? Math.round(wp.elevation) : '—'}
                              readOnly
                              className="bg-slate-800 border-slate-600 text-amber-400 font-medium h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Waypoint Role</Label>
                            <Select value={wp.waypoint_role} onValueChange={v => updateWaypoint(index, 'waypoint_role', v)}>
                              <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLES.map(r => (
                                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-slate-400 text-xs mb-1 block">Segment Number</Label>
                            <Input
                              type="number" min="1"
                              value={wp.segment_number || ''}
                              onChange={e => updateWaypoint(index, 'segment_number', e.target.value)}
                              className="bg-slate-700 border-slate-500 text-white font-mono h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-slate-400 text-xs mb-1 block">Location Title</Label>
                          <Input
                            value={wp.segment_title || ''}
                            onChange={e => updateWaypoint(index, 'segment_title', e.target.value)}
                            className="bg-slate-700 border-slate-500 text-white h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-slate-400 text-xs mb-1 block">Average Segment Speed (km/h)</Label>
                          <Input
                            type="number" step="0.1"
                            value={wp.avg_segment_speed_kmh ?? defaultSpeed}
                            onChange={e => updateWaypoint(index, 'avg_segment_speed_kmh', e.target.value === '' ? null : parseFloat(e.target.value))}
                            className="bg-slate-700 border-slate-500 text-white h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-slate-400 text-xs mb-1 block">Photos ({getWaypointImages(wp).length}/{MAX_WAYPOINT_IMAGES})</Label>
                          <div className="flex flex-wrap gap-2">
                            {getWaypointImages(wp).map((url, i) => (
                              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-600 shrink-0">
                                <img src={url} alt="waypoint" className="w-full h-full object-cover" />
                                <button
                                  onClick={() => removeImage(index, i)}
                                  className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            {getWaypointImages(wp).length < MAX_WAYPOINT_IMAGES && (
                              <label className="flex flex-col items-center justify-center gap-1 cursor-pointer bg-slate-700 border border-dashed border-slate-500 rounded-lg w-20 h-20 shrink-0 text-slate-400 hover:text-white hover:border-slate-400 transition-colors text-xs text-center">
                                {uploadingImageIndex === index ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                                {uploadingImageIndex !== index && 'Add'}
                                <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && handleImageUpload(e.target.files[0], index)} disabled={uploadingImageIndex !== null} />
                              </label>
                            )}
                          </div>
                        </div>

                        {/* Narration Script & TTS generation */}
                        <NarrationTtsEditor
                          script={wp.narration_script || ''}
                          audioUrl={wp.audio_clip_url || ''}
                          onScriptChange={(val) => updateWaypoint(index, 'narration_script', val)}
                          onAudioChange={(val) => {
                            // Per Enda's follow-up 53 report: these three fields are set
                            // atomically in ONE updateWaypoint call now — see the long
                            // comment on updateWaypoint above for why three SEPARATE calls
                            // here used to silently discard audio_clip_url and
                            // trigger_audio, keeping only waypoint_done (the last call).
                            updateWaypoint(index, val
                              // Per Enda's follow-up 44 report: "finished narrating this
                              // waypoint" and "waypoint marked as done" are the same
                              // moment in practice, not two separate steps — this fires
                              // only once, right when Finalize Narration Audio actually
                              // succeeds (a real url comes back), same as TourSimulator.jsx.
                              ? { audio_clip_url: val, trigger_audio: true, waypoint_done: true }
                              : { audio_clip_url: val });
                          }}
                          onAutoSave={onAutoSave}
                          fixedLanguage={targetLanguage}
                          waypointSegmentId={wp.segment_id}
                          waypointSegmentTitle={wp.segment_title}
                        />

                        {/* Audio activation radius and bearing */}
                        <div className="bg-slate-800/50 rounded-lg border border-red-600/30 p-3 space-y-3">
                          <div className="flex items-center gap-2">
                            <Compass className="w-4 h-4 text-red-400" />
                            <Label className="text-slate-300 text-sm font-medium">Audio Activation Radius & Bearing</Label>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-slate-400 text-xs mb-1 block">Trigger Radius (m)</Label>
                              <Input
                                type="number" min="10" max="2000" step="5"
                                value={wp.trigger_radius_m ?? 30}
                                onChange={e => updateWaypoint(index, 'trigger_radius_m', e.target.value === '' ? 30 : Number(e.target.value))}
                                className="bg-slate-700 border-slate-500 text-white h-8 text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-slate-400 text-xs mb-1 block">Bearing Direction (0–359°)</Label>
                              <Input
                                type="number" min="0" max="359"
                                value={wp.bearing_direction ?? 0}
                                onChange={e => updateWaypoint(index, 'bearing_direction', e.target.value === '' ? 0 : Math.max(0, Math.min(359, Number(e.target.value))))}
                                className="bg-slate-700 border-slate-500 text-white h-8 text-sm font-mono"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-slate-400 text-xs mb-1 block">Bearing Tolerance (°)</Label>
                              <Input
                                type="number" min="0" max="180"
                                value={wp.bearing_tolerance ?? 30}
                                onChange={e => updateWaypoint(index, 'bearing_tolerance', e.target.value === '' ? 30 : Math.max(0, Math.min(180, Number(e.target.value))))}
                                className="bg-slate-700 border-slate-500 text-white h-8 text-sm font-mono"
                              />
                            </div>
                            <div className="flex items-center justify-between pt-4">
                              <Label className="text-slate-400 text-xs">Use Bearing</Label>
                              <Switch
                                checked={wp.use_bearing ?? false}
                                onCheckedChange={v => updateWaypoint(index, 'use_bearing', v)}
                              />
                            </div>
                          </div>
                          <p className="text-xs text-slate-500">
                            Radius and bearing are also editable in the simulator — drag the white arrow to rotate bearing, drag the circle edge to resize radius.
                          </p>
                        </div>
                      </>
                    )}

                    <div className="pt-2 border-t border-slate-600">
                      <Button
                        onClick={() => {
                          updateWaypoint(index, 'waypoint_done', true);
                          // Per follow-up 40: this used to only flip the flag in this
                          // component's own in-memory form — request a real server save
                          // right now instead of relying on the narrator to separately
                          // remember to click Save Route afterwards.
                          onAutoSave?.();
                          // Per Enda (follow-up 72): auto-export the finished script as
                          // a .odt the moment a waypoint is marked done — see
                          // buildNarrationExportFilename/downloadScriptAsOdt above.
                          // !isNarrator guards this even though this button only ever
                          // renders for an admin today (the Waypoints tab itself is
                          // hidden from narrators in WalkEditor.jsx) — cheap insurance
                          // against this component ever being reused for a narrator
                          // view later. Skipped entirely when there's no script text
                          // yet, so marking a GPS-only waypoint (no narration) done
                          // never downloads an empty file.
                          if (!isNarrator && (wp.narration_script || '').trim()) {
                            downloadScriptAsOdt(wp.narration_script, buildNarrationExportFilename(wp, segGroup, index));
                          }
                          setExpanded(null);
                        }}
                        variant="outline"
                        className="w-full bg-blue-700/30 hover:bg-blue-700/50 border-blue-600/50 text-amber-400 hover:text-amber-300 gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Mark Waypoint as Done
                      </Button>
                    </div>

                    {onSave && (
                      <div className="pt-2 border-t border-slate-600">
                        <Button
                          onClick={onSave}
                          disabled={saving}
                          className="w-full bg-amber-500 hover:bg-amber-600 gap-2"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Save Route
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
                )}
              </Draggable>
              </React.Fragment>
              );
              })}
                {provided.placeholder}
              </div>
              )}
              </Droppable>
              </DragDropContext>
              )}

              {/* Per Enda: the old Segment Script Manager/Editor combined several waypoints'
                  scripts into one script that was never actually wired back onto any
                  waypoint's own audio — editing break tags there didn't change what the
                  simulator or the real tour played. It's been removed from here. Break
                  tags and audio are now edited directly per waypoint above. Testing
                  against real narration pacing is done in the "Narrate & Simulate" tab,
                  which every Admin and Narrator uses for that purpose — see follow-up 65
                  in the changelog for why the separate "Test Location in Simulator"
                  popup that used to live here was removed. */}
              </div>
              );
              }