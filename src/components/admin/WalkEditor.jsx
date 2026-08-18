import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Loader2, Pencil, Check, X, Upload, FileUp, CheckCircle2, Download, AlertTriangle, FileDown, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import FitParser from 'fit-file-parser';
import WaypointEditor from './WaypointEditor';
import DrivingTourWaypointEditor from './DrivingTourWaypointEditor';
import DrivingTourExportPanel from './DrivingTourExportPanel';
import TourSimulator from './TourSimulator';
import TrailPathEditor from './TrailPathEditor';
import TrailPathMapEditor from './TrailPathMapEditor';
import AdminPreviewMap from './AdminPreviewMap';
import { validateDrivingTour, generateGpx, generateWalkGpx, generateKml, downloadTextFile, buildSegmentId, getRoleColour } from '@/lib/routeExport';
import { getRouteTypeForCategory, defaultPriceForCategory } from '@/lib/tourCategories';
import { MAX_WAYPOINT_IMAGES } from '@/lib/waypointImages';
import { toast } from '@/components/ui/use-toast';

const DEFAULT_INTERESTS = ['Wild Flowers', 'History', 'Mythology', 'Archaeology', 'Photography', 'Routes of Faith'];

const EMPTY_WALK = {
  tour_category: '', // WHT | WBT | DDV — no silent default, must be chosen
  route_type: 'walk', // 'walk' | 'driving_audio_tour'
  code: '',
  name: '',
  description: '',
  difficulty: 'moderate',
  is_sample_walk: false,
  distance_km: '',
  duration_hours: '',
  elevation_gain_m: '',
  start_lat: '',
  start_lng: '',
  region: '',
  main_interest: '',
  trail_path: [],
  trail_breaks: [],
  waypoints: [],
  segment_scripts: [],
};

function SaveButton({ onSave, saving, canSave }) {
  return (
    <div className="border-t border-slate-700 pt-4 flex flex-col items-end gap-1.5">
      <Button onClick={onSave} disabled={saving || !canSave} className="bg-amber-500 hover:bg-amber-600 gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save Route
      </Button>
      {!canSave && !saving && (
        <p className="text-xs text-slate-500">Fill in Code, Name, Route Type, Region, Difficulty (where shown), and the Starting Point coordinates to enable saving.</p>
      )}
    </div>
  );
}

export default function WalkEditor({ walk, onSave, onCancel, userRole = 'admin', focusWaypointIndex, onToggleFinished }) {
  const isNarrator = userRole === 'narrator';
  console.log('WalkEditor mounted/rendering');
  const [form, setForm] = useState({ ...EMPTY_WALK, ...walk });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(isNarrator ? 'waypoints' : (walk?.id ? 'waypoints' : 'details'));
  const [interests, setInterests] = useState(DEFAULT_INTERESTS);
  const [editingInterests, setEditingInterests] = useState(false);
  const [newInterest, setNewInterest] = useState('');
  const fileInputRef = useRef(null);

  // helpers for multi-select interests (stored as comma-separated string)
  const selectedInterests = form.main_interest
    ? form.main_interest.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const toggleInterest = (value) => {
    const current = selectedInterests;
    if (current.includes(value)) {
      set('main_interest', current.filter(i => i !== value).join(', '));
    } else if (current.length < 3) {
      set('main_interest', [...current, value].join(', '));
    }
  };

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const isDrivingAudioTour = form.route_type === 'driving_audio_tour';

  const [gpxImporting, setGpxImporting] = useState(false);
  const [gpxImportDone, setGpxImportDone] = useState(false);
  const [elevFetching, setElevFetching] = useState(false);
  const [routeFetching, setRouteFetching] = useState(false);
  const gpxInputRef = useRef(null);
  const canImportGpx = !!(form.code?.trim() && form.name?.trim() && form.tour_category);
  const isDrivingAudioTourForGate = form.route_type === 'driving_audio_tour';
  const canSave = !!(
    form.code?.trim() &&
    form.name?.trim() &&
    form.tour_category &&
    form.start_lat !== '' && form.start_lat != null && !isNaN(Number(form.start_lat)) &&
    form.start_lng !== '' && form.start_lng != null && !isNaN(Number(form.start_lng)) &&
    form.region?.trim() &&
    (isDrivingAudioTourForGate || !!form.difficulty)
  );

  // Shared helper: compute distance + elevation from a trailPath array + elevations array
  const computeStats = (trailPath, elevations, breaks = []) => {
    const breakSet = new Set(breaks);
    let distanceKm = 0;
    for (let i = 1; i < trailPath.length; i++) {
      if (breakSet.has(i - 1)) continue; // skip cut segments — they aren't walked
      const R = 6371;
      const dLat = (trailPath[i].lat - trailPath[i-1].lat) * Math.PI / 180;
      const dLon = (trailPath[i].lng - trailPath[i-1].lng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(trailPath[i-1].lat * Math.PI/180) * Math.cos(trailPath[i].lat * Math.PI/180) * Math.sin(dLon/2)**2;
      distanceKm += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
    let elevGain = 0;
    for (let i = 1; i < elevations.length; i++) {
      if (i - 1 < trailPath.length && breakSet.has(i - 1)) continue;
      if (elevations[i] > elevations[i-1]) elevGain += elevations[i] - elevations[i-1];
    }
    return { distanceKm, elevGain };
  };

  const generateIntermediateWaypoints = (trailPath) => {
    // If no waypoints from file, auto-generate start, end, and ~5 intermediate points
    if (trailPath.length < 3) return [];

    if (isDrivingAudioTour) {
      const wps = [];
      const makeDrivingWp = (lat, lng, role, segNum) => {
        const segId = buildSegmentId(form.code, segNum) || '';
        return {
          lat, lng,
          waypoint_role: role,
          segment_number: segNum,
          segment_id: segId,
          segment_title: role === 'primary_start' ? 'Start' : role === 'primary_stop' ? 'End' : `Point ${segNum}`,
          avg_segment_speed_kmh: null,
          description: '',
          narration_script: '',
          trigger_audio: false,
          audio_clip_url: '',
          trigger_radius_m: 150,
          trigger_once: true,
          use_bearing: false,
          bearing_direction: 0,
          bearing_tolerance: 30,
          waypoint_colour: getRoleColour(role),
          name: segId ? `${segId} — ${role === 'primary_start' ? 'Start' : role === 'primary_stop' ? 'End' : `Point ${segNum}`}` : (role === 'primary_start' ? 'Start' : role === 'primary_stop' ? 'End' : `Point ${segNum}`),
          type: role,
        };
      };

      wps.push(makeDrivingWp(trailPath[0].lat, trailPath[0].lng, 'primary_start', '01'));

      const step = Math.max(1, Math.floor(trailPath.length / 6));
      let segIdx = 2;
      for (let i = step; i < trailPath.length - step; i += step) {
        const segNum = String(segIdx).padStart(2, '0').slice(-2);
        wps.push(makeDrivingWp(trailPath[i].lat, trailPath[i].lng, 'secondary', segNum));
        segIdx++;
      }

      const endSegNum = String(segIdx).padStart(2, '0').slice(-2);
      wps.push(makeDrivingWp(trailPath[trailPath.length - 1].lat, trailPath[trailPath.length - 1].lng, 'primary_stop', endSegNum));
      return wps;
    }

    const wps = [];
    wps.push({
      lat: trailPath[0].lat,
      lng: trailPath[0].lng,
      name: 'Start',
      description: '',
      type: 'start',
    });

    // Add intermediate waypoints every ~100 points or fewer if trail is short
    const step = Math.max(1, Math.floor(trailPath.length / 6));
    for (let i = step; i < trailPath.length - step; i += step) {
      wps.push({
        lat: trailPath[i].lat,
        lng: trailPath[i].lng,
        name: `Waypoint ${wps.length}`,
        description: '',
        type: 'landmark',
      });
    }

    wps.push({
      lat: trailPath[trailPath.length - 1].lat,
      lng: trailPath[trailPath.length - 1].lng,
      name: 'End',
      description: '',
      type: 'end',
    });

    return wps;
  };

  const applyImportedData = (trailPath, waypoints, elevations) => {
    const startPt = trailPath[0] || waypoints[0];
    const { distanceKm, elevGain } = computeStats(trailPath, elevations);
    const finalWaypoints = waypoints.length > 0 ? waypoints : generateIntermediateWaypoints(trailPath);
    setForm(prev => ({
      ...prev,
      trail_path: trailPath,
      trail_breaks: [], // fresh import — no cuts yet
      waypoints: finalWaypoints.length > 0 ? finalWaypoints : prev.waypoints,
      start_lat: startPt ? startPt.lat : prev.start_lat,
      start_lng: startPt ? startPt.lng : prev.start_lng,
      distance_km: distanceKm > 0 ? Math.round(distanceKm * 10) / 10 : prev.distance_km,
      elevation_gain_m: elevGain > 0 ? Math.round(elevGain) : prev.elevation_gain_m,
    }));
    setGpxImporting(false);
    setGpxImportDone(true);
    setActiveTab('details');
    setTimeout(() => setGpxImportDone(false), 4000);
  };

  const fetchElevations = async (points) => {
    const res = await base44.functions.invoke('fetchElevations', { points });
    return res.data.elevations;
  };

  // Build a road-following polyline between ordered waypoints (OSRM) for driving tours
  // whose GPX import had no recorded track/route line.
  const routeWaypoints = async (points, profile) => {
    const res = await base44.functions.invoke('routeWaypoints', { points, profile });
    return res.data.trail;
  };

  // Re-runs road routing on the waypoints already loaded in the form — for when the free
  // routing service fails (a real, known possibility, not hypothetical — this hit twice in
  // a row on a 124-point tour) and produces the straight-line fallback. Lets that be retried
  // directly, without needing to re-import the whole GPX file from scratch.
  const handleRetryRouting = async () => {
    if (!form.waypoints || form.waypoints.length < 2) return;
    setRouteFetching(true);
    try {
      const profile = form.tour_category === 'DDV' ? 'driving' : 'foot';
      const ordered = form.waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }));
      const routed = await routeWaypoints(ordered, profile);
      if (routed && routed.length > 1) {
        set('trail_path', routed);
        toast({ title: 'Route rebuilt', description: 'The road-following path has been regenerated from the current waypoints.' });
      } else {
        toast({ variant: 'destructive', title: 'Road routing returned no path', description: 'Still falling back to straight lines. Try again in a moment.' });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Road routing failed', description: err?.message || 'Could not reach the routing service. Try again in a moment.' });
    }
    setRouteFetching(false);
  };

  // Accepts 1 or 2 GPX files. With 2 (an Activity file with the recorded track, and a
  // separate Waypoints file with named points — exactly what an eTrex produces as two
  // files), their track points and waypoints are combined before anything else happens,
  // so the rest of this function — sorting, segment building, elevation, everything below
  // — runs completely unchanged, exactly as it always has for a single file. This is what
  // used to require manually merging the two files outside the app first.
  const handleGpxImport = (files) => {
    const fileList = Array.from(files).filter(Boolean);
    if (fileList.length === 0) return;
    setGpxImporting(true);

    Promise.all(fileList.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    }))).then(async (texts) => {
      const parser = new DOMParser();
      const docs = texts.map(text => parser.parseFromString(text, 'application/xml'));

      // Combine across however many files were given — normally 1, or 2 when an eTrex's
      // separate Activity and Waypoints files are both selected at once.
      const trkpts = docs.flatMap(doc => Array.from(doc.querySelectorAll('trkpt')));
      const rtepts = docs.flatMap(doc => Array.from(doc.querySelectorAll('rtept')));
      const wpts = docs.flatMap(doc => Array.from(doc.querySelectorAll('wpt')));

      // Sort waypoints by naming convention (XXX<segment><letter>[-PS]) so that
      // BOTH the route line and the waypoint list follow the correct sequence
      // (1a, 1b, 1c, 2a, 2b, ...). This prevents the route from being drawn in
      // GPX file order, which may differ from the intended tour sequence.
      wpts.sort((a, b) => {
        const na = a.querySelector('name')?.textContent?.trim() || '';
        const nb = b.querySelector('name')?.textContent?.trim() || '';
        // Letter suffix is optional: WRC1a (driving/WalkAbout) and MXR1 (plain walk/hike) both match
        const ka = na.match(/^\D*(\d+)([a-z]?)/i);
        const kb = nb.match(/^\D*(\d+)([a-z]?)/i);
        if (ka && kb) {
          const sa = parseInt(ka[1], 10), sb = parseInt(kb[1], 10);
          if (sa !== sb) return sa - sb;
          return (ka[2] || '').localeCompare(kb[2] || '');
        }
        if (ka) return -1;
        if (kb) return 1;
        return 0;
      });

      const pts = trkpts.length > 0 ? trkpts : rtepts.length > 0 ? rtepts : wpts;

      let trailPath = pts.map(pt => ({
        lat: parseFloat(pt.getAttribute('lat')),
        lng: parseFloat(pt.getAttribute('lon')),
      })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

      const waypoints = wpts.map((wpt, i) => {
        const eleTxt = wpt.querySelector('ele')?.textContent;
        const ele = (eleTxt && parseFloat(eleTxt) > 0) ? parseFloat(eleTxt) : null;
        const nameTxt = wpt.querySelector('name')?.textContent || `Waypoint ${i + 1}`;
        const descTxt = wpt.querySelector('desc')?.textContent || '';

        if (isDrivingAudioTour) {
          const isPS = nameTxt.includes('-PS') || /^\D*\d+a\b/.test(nameTxt);
          const role = isPS ? 'primary_start' : 'secondary';
          const segMatch = nameTxt.match(/^\D*(\d+)/);
          const segNum = segMatch ? String(parseInt(segMatch[1], 10)).padStart(2, '0').slice(-2) : String(i + 1).padStart(2, '0').slice(-2);
          const segId = buildSegmentId(form.code, segNum) || '';
          return {
            lat: parseFloat(wpt.getAttribute('lat')),
            lng: parseFloat(wpt.getAttribute('lon')),
            waypoint_role: role,
            segment_number: segNum,
            segment_id: segId,
            segment_title: nameTxt,
            avg_segment_speed_kmh: null,
            description: descTxt,
            narration_script: '',
            trigger_audio: false,
            audio_clip_url: '',
            trigger_radius_m: 150,
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

      // If the GPX had no recorded track/route (only sparse waypoints), build a
      // path-following line between the ordered waypoints instead of straight lines.
      // Walks and Walkabouts use the foot router; driving tours use the driving router.
      if (trkpts.length === 0 && rtepts.length === 0 && waypoints.length >= 2) {
        const profile = form.tour_category === 'DDV' ? 'driving' : 'foot';
        setGpxImporting(false);
        setRouteFetching(true);
        try {
          const ordered = waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng }));
          const routed = await routeWaypoints(ordered, profile);
          if (routed && routed.length > 1) {
            trailPath = routed;
          } else {
            toast({ variant: 'destructive', title: 'Road routing returned no path', description: 'Falling back to straight lines between waypoints. Check that the waypoints are on or near drivable roads.' });
          }
        } catch (err) {
          console.warn('Road routing failed:', err);
          toast({ variant: 'destructive', title: 'Road routing failed', description: err?.message || 'Could not reach the routing service. Falling back to straight lines between waypoints.' });
        }
        setRouteFetching(false);
      }

      // Try embedded elevations first, otherwise fetch from Open Topo Data
      let elevations = pts.map(pt => parseFloat(pt.querySelector('ele')?.textContent || 'NaN')).filter(e => !isNaN(e));
      // Treat all-zero elevations (Garmin Explore placeholder) as missing
      const hasRealElevation = elevations.length >= 2 && elevations.some(e => e > 1);

      // Check which waypoints are missing elevation (null or 0 = Garmin placeholder)
      const waypointsMissingEle = waypoints.filter(wp => wp.elevation == null || wp.elevation === 0);

      if ((!hasRealElevation && trailPath.length > 0) || waypointsMissingEle.length > 0) {
        setGpxImporting(false);
        setElevFetching(true);
        try {
          // Fetch trail elevations if needed
          if (!hasRealElevation && trailPath.length > 0) {
            elevations = await fetchElevations(trailPath);
          }
          // Fetch waypoint elevations if any are missing. A 0 from the elevation service is a
          // real sea-level reading, not a Garmin placeholder (that concern only applies to the
          // embedded <ele> tag checked above) — so save it, otherwise coastal walks end up with
          // no elevation shown to walkers at all.
          if (waypointsMissingEle.length > 0) {
            const wpElevs = await fetchElevations(waypointsMissingEle);
            waypointsMissingEle.forEach((wp, i) => {
              if (wpElevs[i] != null) wp.elevation = Math.round(wpElevs[i]);
            });
          }
        } catch (err) {
          console.warn('Elevation fetch failed:', err);
        }
        setElevFetching(false);
      }

      applyImportedData(trailPath, waypoints, elevations);
    }).catch((err) => {
      console.error('GPX import failed:', err);
      setGpxImporting(false);
      toast({ variant: 'destructive', title: 'Could not read file(s)', description: err?.message || 'Please check the file(s) and try again.' });
    });
  };

  const handleFitImport = (e) => {
    console.log('handleFitImport called');
    const file = e.target.files[0];
    console.log('File selected:', file?.name);
    if (!file) return;
    setGpxImporting(true);
    console.log('Starting FIT import...');
    const reader = new FileReader();
    reader.onerror = (err) => {
      console.error('FileReader error:', err);
      setGpxImporting(false);
      alert('Error reading file: ' + err.message);
    };
    reader.onload = (ev) => {
      try {
        const arrayBuffer = ev.target.result;
        console.log('File loaded, size:', arrayBuffer.byteLength);
        
        console.log('FitParser:', FitParser);
        const fitParser = new FitParser({ force: true, speedUnit: 'km/h', lengthUnit: 'km', elapsedRecordField: true });
        console.log('Parser created, about to parse...');
        fitParser.parse(arrayBuffer, (error, data) => {
          console.log('Parse callback fired!');
          if (error) { 
            console.error('FIT parse error:', error);
            setGpxImporting(false); 
            alert('Could not read FIT file: ' + error); 
            return; 
          }

          console.log('Full FIT data keys:', Object.keys(data || {}));
          console.log('Full data:', data);

        // Try multiple locations where records can live in FIT structure
        const records = (
          data?.activity?.sessions?.flatMap(s => s.laps?.flatMap(l => l.records || []) || []) ||
          data?.records ||
          []
        );

        const trailPath = records
          .filter(r => r.position_lat != null && r.position_long != null)
          .map(r => ({ lat: r.position_lat, lng: r.position_long }));

        const elevations = records
          .filter(r => r.altitude != null)
          .map(r => r.altitude);

        // FIT course points — Garmin saves named waypoints here
        // Try all possible locations
        let coursePoints = [];
        if (data?.course_points?.length > 0) coursePoints = data.course_points;
        else if (data?.course?.course_points?.length > 0) coursePoints = data.course.course_points;
        else if (data?.activity?.course_points?.length > 0) coursePoints = data.activity.course_points;
        else if (data?.activity?.sessions?.length > 0) {
          for (const session of data.activity.sessions) {
            if (session.course_points?.length > 0) {
              coursePoints = session.course_points;
              break;
            }
          }
        }

        console.log('Course points found:', coursePoints.length);
        if (coursePoints.length > 0) console.log('First course point:', coursePoints[0]);

        const waypoints = coursePoints.map((cp, i) => {
          const cpName = cp.name || `Waypoint ${i + 1}`;
          const cpDesc = cp.type ? `Type: ${cp.type}` : '';

          if (isDrivingAudioTour) {
            const role = i === 0 ? 'primary_start' : (i === coursePoints.length - 1 ? 'primary_stop' : 'secondary');
            const segNum = String(i + 1).padStart(2, '0').slice(-2);
            const segId = buildSegmentId(form.code, segNum) || '';
            return {
              lat: cp.position_lat || cp.positionLat,
              lng: cp.position_long || cp.positionLong,
              waypoint_role: role,
              segment_number: segNum,
              segment_id: segId,
              segment_title: cpName,
              avg_segment_speed_kmh: null,
              description: cpDesc,
              narration_script: '',
              trigger_audio: false,
              audio_clip_url: '',
              trigger_radius_m: 150,
              trigger_once: true,
              use_bearing: false,
              bearing_direction: 0,
              bearing_tolerance: 30,
              waypoint_colour: getRoleColour(role),
              name: segId ? `${segId} — ${cpName}` : cpName,
              type: role,
            };
          }

          return {
            lat: cp.position_lat || cp.positionLat,
            lng: cp.position_long || cp.positionLong,
            name: cpName,
            description: cpDesc,
            type: 'landmark',
            image_urls: [],
          };
        }).filter(p => p.lat != null && p.lng != null);

        applyImportedData(trailPath, waypoints, elevations);
        });
      } catch (err) {
        console.error('FIT import exception:', err);
        setGpxImporting(false);
        alert('Error parsing FIT file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleFileImport = (e) => {
    if (!canImportGpx) {
      toast({
        variant: 'destructive',
        title: 'Cannot import yet',
        description: 'Please select a Route Type and fill in the Code and Name first.',
      });
      e.target.value = '';
      return;
    }
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // A FIT file needs its own binary parser and can't be combined with a GPX in the same
    // pass — only supported one at a time, exactly as before.
    if (files.length > 1 && files.some(f => f.name.toLowerCase().endsWith('.fit'))) {
      toast({ variant: 'destructive', title: 'Cannot combine a FIT file with another file', description: 'Select either one FIT file, or one or two GPX files (an Activity file and a Waypoints file).' });
      e.target.value = '';
      return;
    }

    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.fit')) {
      handleFitImport(e);
    } else {
      handleGpxImport(files);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (saving) return false; // guard against a double-click or double-invocation firing two saves at once
    if (!canSave) {
      toast({
        variant: 'destructive',
        title: 'Cannot save yet',
        description: 'Please fill in Route Type, Code, Name, Region, Difficulty (where shown), and the Starting Point coordinates before saving.',
      });
      setActiveTab('details');
      return false;
    }

    setSaving(true);

    // Walk/Hike tours: always recompute Distance from the current trail line at save time,
    // rather than trusting whatever number was calculated at the original GPX import. This is
    // what was wrong with Plakias Koules Walk — a rogue waypoint had inflated the distance to
    // 46.6km at import time, and removing that waypoint later never re-ran the calculation, so
    // the old wrong number just sat there. Recalculating on every save closes that gap for any
    // future edit (adding/removing waypoints, fixing a bad point, re-routing).
    let recalculatedDistanceKm = form.distance_km ? Number(form.distance_km) : undefined;
    if (!isDrivingAudioTour && form.trail_path && form.trail_path.length > 1) {
      const { distanceKm } = computeStats(form.trail_path, [], form.trail_breaks || []);
      if (distanceKm > 0) {
        recalculatedDistanceKm = Math.round(distanceKm * 10) / 10;
      }
    }

    // Elevation Gain has the same staleness problem as Distance did — and getting it right
    // matters even more, since walkers with heart, joint, or other physical conditions rely on
    // it to judge whether a route is safe for them. Refetch real elevation heights for the
    // current trail line and recompute it fresh on every save, same as Distance. This needs a
    // network call (heights aren't stored anywhere between saves), so if that call fails for any
    // reason, saving still goes ahead with the old figure rather than blocking the admin's work —
    // but they're warned afterwards so they know to double-check it.
    let recalculatedElevationGainM = form.elevation_gain_m ? Number(form.elevation_gain_m) : undefined;
    let elevationRecalcFailed = false;
    if (!isDrivingAudioTour && form.trail_path && form.trail_path.length > 1) {
      try {
        const elevations = await fetchElevations(form.trail_path);
        const { elevGain } = computeStats(form.trail_path, elevations, form.trail_breaks || []);
        if (elevGain > 0) {
          recalculatedElevationGainM = Math.round(elevGain);
        }
      } catch (err) {
        console.warn('Elevation recalculation failed, keeping previous value:', err);
        elevationRecalcFailed = true;
      }
    }

    const data = {
      ...form,
      distance_km: recalculatedDistanceKm,
      duration_hours: form.duration_hours ? Number(form.duration_hours) : undefined,
      elevation_gain_m: recalculatedElevationGainM,
      default_driving_speed_kmh: form.default_driving_speed_kmh ? Number(form.default_driving_speed_kmh) : undefined,
      price_eur: form.price_eur ? Number(form.price_eur) : undefined,
      start_lat: Number(form.start_lat),
      start_lng: Number(form.start_lng),
    };

    try {
      const wasNewTour = !form.id;
      const saved = await onSave(data);
      // Keep the form's own id in sync with what was actually persisted, so the *next* save
      // updates this same record instead of accidentally creating a second one.
      if (saved?.id && saved.id !== form.id) {
        setForm(prev => ({ ...prev, id: saved.id }));
      }
      if (recalculatedDistanceKm !== form.distance_km) {
        setForm(prev => ({ ...prev, distance_km: recalculatedDistanceKm }));
      }
      if (recalculatedElevationGainM !== form.elevation_gain_m) {
        setForm(prev => ({ ...prev, elevation_gain_m: recalculatedElevationGainM }));
      }
      if (elevationRecalcFailed) {
        toast({
          variant: 'destructive',
          title: 'Saved, but Elevation Gain could not be re-checked',
          description: 'Could not reach the elevation service, so the previous Elevation Gain figure was kept as-is. Please check it manually before this route goes live.',
        });
      }
      if (wasNewTour) {
        // First save after import — the tour now exists, so jump straight to describing waypoints
        // rather than leaving the admin sitting on the General tab wondering what happened.
        setActiveTab('waypoints');
        toast({ title: 'Tour saved', description: 'Now add descriptions for the imported waypoints below.' });
      }
      return true;
    } catch (err) {
      console.error('Save failed:', err);
      toast({
        variant: 'destructive',
        title: 'Save failed — nothing was saved',
        description: err?.message || 'An unexpected error occurred while saving. Please try again.',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const [downloadingGpx, setDownloadingGpx] = useState(false);

  // Saves the whole tour first (same as the regular Save), then — only if that save
  // actually succeeded — builds a GPX file from the just-saved data and downloads it
  // to the user's Downloads folder. Walk/Hike only; driving tours have their own
  // export panel already.
  const handleSaveAndDownloadGpx = async () => {
    if (downloadingGpx || saving) return;
    setDownloadingGpx(true);
    try {
      const success = await handleSave();
      if (!success) return;

      const gpxContent = generateWalkGpx(form);
      const safeName = (form.name || 'Route').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'Route';
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadTextFile(gpxContent, `${safeName}-updated-${dateStr}.gpx`, 'application/gpx+xml');
      toast({ title: 'GPX downloaded', description: 'The updated route was saved and a GPX backup was sent to your Downloads folder.' });
    } finally {
      setDownloadingGpx(false);
    }
  };

  // The Route Path map editor is admin-only (narrators never see it). It's used for
  // Walks (WHT), WalkAbouts (WBT) AND Driving Tours (DDV). For DDV the main use is the
  // Cut tool, which removes the straight "bridge" lines that appear when a GPX
  // recording has a gap (GPS dropped out and resumed elsewhere) and the trail line is
  // drawn straight across the gap. Admins don't trace DDV trails from scratch (those
  // come from the recorded drive), so the editor opens in Cut mode for DDV.
  const showTrailTab = !isNarrator;
  const tabs = [
    { id: 'details', label: 'General' },
    ...(showTrailTab ? [{ id: 'trail', label: 'Route Path (GPS)' }] : []),
    { id: 'waypoints', label: `Waypoints${form.waypoints.length ? ` (${form.waypoints.length})` : ''}` },
    { id: 'preview', label: 'Preview' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6 mt-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-slate-300 hover:text-white gap-2">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <h2 className="text-xl font-bold text-white">
            {form.id ? `Editing: ${form.code || form.name}` : 'New Route'}
          </h2>
          {form.clone_of && (
            <div className="flex items-center gap-2 ml-2 bg-slate-700/60 border border-purple-700/50 rounded-lg px-3 py-1.5">
              <input
                type="checkbox"
                id="finished-checkbox"
                checked={!!form.finished}
                onChange={(e) => {
                  set('finished', e.target.checked);
                  if (onToggleFinished && form.id) onToggleFinished(form.id, e.target.checked);
                }}
                className="w-4 h-4 accent-purple-500"
              />
              <label htmlFor="finished-checkbox" className="text-sm text-slate-200 select-none cursor-pointer">
                Translation finished
              </label>
              <span className="hidden sm:inline text-xs text-slate-500">— sends this clone to admins for review</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-xl p-1 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-amber-500 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        {activeTab === 'details' && (
          <div className="space-y-5">

            {/* Route Type, Code, and GPX import are all structural/admin-only — a narrator
                works inside a clone whose category and code are already set at cloning
                time, and re-importing a GPX would replace the route itself. Enforced here
                for the UI; the real boundary is saveWalkForBackend's field whitelist. */}
            {!isNarrator && (
            <>
            {/* Route Type — chosen first, since it decides Code/Name labels and the waypoint shape used on import */}
            <div>
              <Label className="text-slate-300 mb-1.5 block">Route Type *</Label>
              <Select
                value={form.tour_category || undefined}
                onValueChange={(v) => {
                  set('tour_category', v);
                  set('route_type', getRouteTypeForCategory(v));
                  // Default price follows the tour type: €12.50 for Walk/Hike, €24.99 for
                  // Walkabout and Driving Tour (both VAT included). Selecting/changing the
                  // type sets this default; the admin can still override the field below.
                  set('price_eur', defaultPriceForCategory(v));
                }}
              >
                <SelectTrigger className={`bg-slate-700 text-white ${!form.tour_category ? 'border-amber-500/70 focus-visible:ring-amber-500' : 'border-slate-600'}`}>
                  <SelectValue placeholder="Select route type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHT">Walk/Hike</SelectItem>
                  <SelectItem value="WBT">WalkAbout</SelectItem>
                  <SelectItem value="DDV">Driving Tour</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">
                Walk/Hike uses the existing walking-app workflow. WalkAbout and Driving Tour prepare GPX data for the Speech/Speed Route Checker.
              </p>
            </div>

            {/* Tour/Route Code — required next, since waypoint IDs and segment IDs are built from the code */}
            {!canImportGpx && (
              <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-slate-900 text-xs font-bold shrink-0">1</span>
                <p className="text-amber-200 text-sm">Select a Route Type and enter a Code and Name below to unlock GPX/FIT import.</p>
              </div>
            )}
            <div>
              <Label className="text-slate-300 mb-1.5 block">{isDrivingAudioTour ? "Tour Code *" : "Route Code *"}</Label>
              <Input
                value={form.code}
                onChange={e => set('code', e.target.value)}
                placeholder={isDrivingAudioTour ? "e.g. BOR" : "e.g. CRE-007"}
                className={`bg-slate-700 text-white font-mono ${!form.code?.trim() ? 'border-amber-500/70 focus-visible:ring-amber-500' : 'border-slate-600'}`}
              />
              <p className="text-xs text-slate-500 mt-1">{isDrivingAudioTour ? "Three-letter tour code, e.g. BOR" : "Unique identifier shown to users"}</p>
            </div>

            {/* GPX Import */}
            <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl px-4 py-3">
              <FileUp className="w-5 h-5 text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-blue-200 text-sm font-medium">Import from GPX or FIT</p>
                <p className="text-blue-400 text-xs">
                  {canImportGpx
                    ? 'Pre-fills start point, trail path, waypoints, distance & elevation. Select one file, or select both your Activity GPX and Waypoints GPX together (Ctrl/Cmd-click both) and they\'ll be combined automatically — no need to merge them yourself first.'
                    : `Select Route Type and fill in the ${isDrivingAudioTour ? 'Tour' : 'Route'} Code and Name above first — waypoint IDs and shape are built from these`}
                </p>
              </div>
              {gpxImportDone ? (
                <span className="flex items-center gap-1.5 text-green-400 text-sm font-medium shrink-0">
                  <CheckCircle2 className="w-4 h-4" /> Imported!
                </span>
              ) : (
                <>
                  <input ref={gpxInputRef} id="gpx-input" type="file" accept=".gpx,.fit,application/gpx+xml" multiple className="sr-only" disabled={!canImportGpx} onChange={(e) => { handleFileImport(e); }} />
                  <label
                    htmlFor={canImportGpx ? "gpx-input" : undefined}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors shrink-0 ${
                      canImportGpx
                        ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                        : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                     {(gpxImporting || elevFetching || routeFetching) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                     {gpxImporting ? 'Reading…' : routeFetching ? 'Routing path…' : elevFetching ? 'Fetching elevation…' : 'Choose GPX / FIT'}
                   </label>

                  {form.waypoints?.length >= 2 && (
                    <button
                      type="button"
                      onClick={handleRetryRouting}
                      disabled={gpxImporting || elevFetching || routeFetching}
                      title="Regenerate the road-following path from the current waypoints — use this if road routing failed on import"
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      <RefreshCw className="w-4 h-4" /> Retry routing
                    </button>
                  )}
                </>
              )}
            </div>
            </>
            )}

            {/* Tour/Route Name — the translated title itself, so this one stays editable
                for a narrator too, unlike Code above it. */}
            <div>
              <Label className="text-slate-300 mb-1.5 block">{isDrivingAudioTour ? "Tour Name *" : "Route Name *"}</Label>
              <Input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder={isDrivingAudioTour ? "e.g. Battle of the Rivers" : "e.g. Balos Lagoon Trail"}
                className={`bg-slate-700 text-white ${!form.name?.trim() ? 'border-amber-500/70 focus-visible:ring-amber-500' : 'border-slate-600'}`}
              />
            </div>

            {isDrivingAudioTour && (
              <div className="bg-purple-900/20 border border-purple-700/40 rounded-xl px-4 py-3">
                <p className="text-purple-200 text-sm font-medium">{form.tour_category === 'WBT' ? 'WalkAbout Tour mode' : 'Driving Audio Tour mode'}</p>
                <p className="text-purple-300 text-xs mt-1">
                  Use the Waypoints tab to define Primary-Start, Primary-Stop, Secondary points, segment IDs, titles, colours and average segment speeds once the waypoint editor has been updated for driving-tour fields.
                </p>
              </div>
            )}

            <div>
              <Label className="text-slate-300 mb-1.5 block">Description</Label>
              <Textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Describe the route, experience, highlights, and what to expect..."
                rows={5}
                className="bg-slate-700 border-slate-600 text-white resize-none"
              />
            </div>

            {!isDrivingAudioTour && (
            <div>
              <Label className="text-slate-300 mb-1.5 block">
                ⚠️ Safety Notes
                <span className="ml-2 text-xs text-slate-500 font-normal">Shown prominently to users before they set off</span>
              </Label>
              <Textarea
                value={form.safety_notes || ''}
                onChange={e => set('safety_notes', e.target.value)}
                placeholder={`e.g. This route passes through unmarked terrain and maquis. You must download the GPX file and load it into a navigation app before departure.\n\nEssential equipment: sun hat, sturdy walking shoes or boots, walking poles, and a minimum of 2 litres of water per person. Mobile signal is unreliable on this route.\n\nNote: Under Greek law, the cost of any search and rescue operation is charged to the individual. Do not attempt this walk unprepared.`}
                rows={6}
                className="bg-slate-700 border-slate-600 text-white resize-none text-sm"
              />
            </div>

            )}

            {/* Region/Province and Difficulty are structural/factual — shouldn't change
                between language versions of the same tour, so admin-only. */}
            {!isNarrator && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300 mb-1.5 block">{isDrivingAudioTour ? 'Province' : 'Region'}</Label>
                <Select value={form.region} onValueChange={v => set('region', v)}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {['Chania', 'Rethymno', 'Heraklion', 'Lasithi'].map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!isDrivingAudioTour && (
              <div>
                <Label className="text-slate-300 mb-1.5 block">Difficulty</Label>
                <Select value={form.difficulty} onValueChange={v => set('difficulty', v)}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['easy', 'moderate', 'challenging', 'difficult'].map(d => (
                      <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
            </div>
            )}

            {!isDrivingAudioTour && !isNarrator && (
            <>
            {/* Walk access — pricing/publishing configuration, admin-only */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300 mb-1.5 block">Free sample</Label>
                <div className="flex items-center gap-3 h-9 bg-slate-700 border border-slate-600 rounded-md px-3">
                  <button
                    type="button"
                    onClick={() => set('is_sample_walk', !form.is_sample_walk)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${form.is_sample_walk ? 'bg-amber-500' : 'bg-slate-500'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_sample_walk ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="text-slate-300 text-sm">{form.is_sample_walk ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>

            {/* Main Interests — tour categorisation/discovery metadata, admin-only */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-slate-300">
                  Main Interests
                  <span className="ml-2 text-xs text-slate-500">(select up to 3)</span>
                </Label>
                <button
                  type="button"
                  onClick={() => setEditingInterests(v => !v)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  {editingInterests ? 'Done editing list' : 'Edit list'}
                </button>
              </div>

              {/* Selected tags */}
              {selectedInterests.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedInterests.map(i => (
                    <span key={i} className="flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full px-2.5 py-0.5 text-xs font-medium">
                      {i}
                      <button type="button" onClick={() => toggleInterest(i)} className="hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {!editingInterests ? (
                <div className="flex flex-wrap gap-2">
                  {interests.map(i => {
                    const selected = selectedInterests.includes(i);
                    const disabled = !selected && selectedInterests.length >= 3;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleInterest(i)}
                        disabled={disabled}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                          selected
                            ? 'bg-amber-500 border-amber-500 text-white'
                            : disabled
                              ? 'bg-slate-800 border-slate-700 text-slate-600 cursor-not-allowed'
                              : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-amber-500/50 hover:text-white'
                        }`}
                      >
                        {i}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-slate-700 border border-slate-600 rounded-lg p-3 space-y-2">
                  {interests.map((interest, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2">
                      <span className="text-white text-sm">{interest}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = interests.filter((_, i) => i !== idx);
                          setInterests(updated);
                          if (selectedInterests.includes(interest)) toggleInterest(interest);
                        }}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1 border-t border-slate-600">
                    <Input
                      value={newInterest}
                      onChange={e => setNewInterest(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newInterest.trim()) {
                          setInterests(prev => [...prev, newInterest.trim()]);
                          setNewInterest('');
                        }
                      }}
                      placeholder="Add new interest..."
                      className="bg-slate-600 border-slate-500 text-white h-8 text-sm"
                    />
                    <Button
                      type="button" size="sm"
                      onClick={() => {
                        if (newInterest.trim()) {
                          setInterests(prev => [...prev, newInterest.trim()]);
                          setNewInterest('');
                        }
                      }}
                      className="bg-amber-500 hover:bg-amber-600 h-8 px-3"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            </>
            )}

            {!isDrivingAudioTour && !isNarrator && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-slate-300 mb-1.5 block">Approx. Distance (km)</Label>
                <Input type="number" value={form.distance_km} onChange={e => set('distance_km', e.target.value)}
                  placeholder="e.g. 12.5" className="bg-slate-700 border-slate-600 text-white" />
              </div>
              <div>
                <Label className="text-slate-300 mb-1.5 block">Duration (hours)</Label>
                <Input type="number" value={form.duration_hours} onChange={e => set('duration_hours', e.target.value)}
                  placeholder="e.g. 5" className="bg-slate-700 border-slate-600 text-white" />
              </div>
              <div>
                <Label className="text-slate-300 mb-1.5 block">Elevation Gain (m)</Label>
                <Input type="number" value={form.elevation_gain_m} onChange={e => set('elevation_gain_m', e.target.value)}
                  placeholder="e.g. 450" className="bg-slate-700 border-slate-600 text-white" />
              </div>
            </div>

            )}

            {/* Driving speed — Admin-set only, everywhere. Never editable by a Narrator,
                here or anywhere else (see TourSimulator.jsx, which now only ever displays
                whatever speed was set here, read-only). */}
            {isDrivingAudioTour && !isNarrator && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300 mb-1.5 block">Default Average Driving Speed (km/h)</Label>
                  <Input
                    type="number"
                    value={form.default_driving_speed_kmh || ''}
                    onChange={e => set('default_driving_speed_kmh', e.target.value)}
                    placeholder="e.g. 45"
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">Used as the segment speed until a Primary-Start waypoint sets its own in the Waypoints tab — see Average Segment Speed there.</p>
                </div>
              </div>
            )}

            {!isNarrator && (
            <div className="border-t border-slate-700 pt-5">
              <Label className="text-slate-300 mb-3 block font-semibold">Starting Point (GPS)</Label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-400 text-xs mb-1.5 block">Latitude *</Label>
                  <Input type="number" step="0.000001" value={form.start_lat}
                    onChange={e => set('start_lat', e.target.value)}
                    placeholder="e.g. 35.2019"
                    className="bg-slate-700 border-slate-600 text-white font-mono" />
                </div>
                <div>
                  <Label className="text-slate-400 text-xs mb-1.5 block">Longitude *</Label>
                  <Input type="number" step="0.000001" value={form.start_lng}
                    onChange={e => set('start_lng', e.target.value)}
                    placeholder="e.g. 23.7619"
                    className="bg-slate-700 border-slate-600 text-white font-mono" />
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                💡 Tip: Right-click any location on Google Maps and click the coordinates to copy them.
              </p>
            </div>
            )}

            {!isNarrator && (
            <div className="border-t border-slate-700 pt-5">
              <Label className="text-slate-300 mb-3 block font-semibold">Pricing &amp; Purchase</Label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-400 text-xs mb-1.5 block">Price (EUR)</Label>
                  <Input type="number" value={form.price_eur ?? ''} onChange={e => set('price_eur', e.target.value)} placeholder="e.g. 15" className="bg-slate-700 border-slate-600 text-white" />
                </div>
                <div>
                  <Label className="text-slate-400 text-xs mb-1.5 block">Creem Product ID</Label>
                  <Input value={form.creem_product_id || ''} onChange={e => set('creem_product_id', e.target.value)} placeholder="e.g. prod_abc123" className="bg-slate-700 border-slate-600 text-white font-mono" />
                </div>
              </div>
              <div className="mt-3">
                <Label className="text-slate-400 text-xs mb-1.5 block">Checkout URL (Merchant of Record)</Label>
                <Input value={form.checkout_url || ''} onChange={e => set('checkout_url', e.target.value)} placeholder="https://creem.io/checkout/..." className="bg-slate-700 border-slate-600 text-white" />
                <p className="text-xs text-slate-500 mt-1">The product's checkout link at the MoR (Creem sandbox now). The in-app Buy button opens this. Swapping to Paddle later = paste the Paddle checkout link here.</p>
              </div>
            </div>
            )}

            <SaveButton onSave={handleSave} saving={saving} canSave={canSave} />
          </div>
        )}

        {activeTab === 'trail' && (
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <h3 className="text-white font-semibold mb-1">Draw the route on the map</h3>
              <p className="text-slate-400 text-sm mb-3">
                Click the trail on the map to trace the real path, drag points to fix them, or use
                <span className="text-slate-300 font-medium"> From waypoints</span> to connect your Garmin Explore points with straight segments as a starting skeleton.
              </p>
              <TrailPathMapEditor
                trailPath={form.trail_path}
                onChange={path => set('trail_path', path)}
                trailBreaks={form.trail_breaks || []}
                onBreaksChange={breaks => set('trail_breaks', breaks)}
                waypoints={form.waypoints || []}
                initialMode={form.tour_category === 'DDV' ? 'cut' : 'add'}
              />
            </div>

            <SaveButton onSave={handleSave} saving={saving} canSave={canSave} />

            <TrailPathEditor
              trailPath={form.trail_path}
              onChange={path => set('trail_path', path)}
              trailBreaks={form.trail_breaks || []}
              onBreaksChange={breaks => set('trail_breaks', breaks)}
            />
          </div>
        )}

        {activeTab === 'waypoints' && (
          <div className="space-y-4">
            {isDrivingAudioTour ? (
              <DrivingTourWaypointEditor
                waypoints={form.waypoints}
                onChange={wps => set('waypoints', wps)}
                onTrailPathChange={path => set('trail_path', path)}
                trailPath={form.trail_path}
                tourCode={form.code}
                tourCategory={form.tour_category}
                defaultDrivingSpeedKmh={form.default_driving_speed_kmh}
                onSave={handleSave}
                saving={saving}
                userRole={userRole}
                focusWaypointIndex={focusWaypointIndex}
                segmentScripts={form.segment_scripts || []}
                onSegmentScriptsChange={(scripts) => set('segment_scripts', scripts)}
              />
            ) : (
              <WaypointEditor
                waypoints={form.waypoints}
                onChange={wps => {
                  // Only update the waypoint markers here. The route LINE (trail_path) is the
                  // actual GPS track recorded on the ground — a separate, denser set of points
                  // than the named waypoints. It must not be rebuilt from the sparse waypoint
                  // list: doing that replaces the real curved trail with straight lines jumping
                  // point-to-point (this was happening on every waypoint add/delete/edit, and is
                  // why edited routes started cutting straight across bends instead of following
                  // the road/path). To actually change the route line itself, use the dedicated
                  // trail-path map editor above (the `trailPath`/`onChange` pair a few lines
                  // below), not the waypoint list.
                  set('waypoints', wps);
                }}
                onSave={handleSave}
                saving={saving}
                code={form.code}
                onSaveAndDownload={handleSaveAndDownloadGpx}
                downloadingGpx={downloadingGpx}
              />
            )}
            <SaveButton onSave={handleSave} saving={saving} canSave={canSave} />
          </div>
        )}

        {activeTab === 'preview' && (
          <div className="space-y-4">
            <AdminPreviewMap walk={form} />
            {isDrivingAudioTour && (
              <>
                {/* Backup export is an Admin-only action — narrators can view/test the
                    preview and simulator above, but never generate a GPX/KML backup file.
                    This tab itself has no narrator restriction (unlike the Route Path tab,
                    which is hidden from the tab bar entirely), so the gate has to live
                    right here at the panel itself. */}
                {!isNarrator && <DrivingTourExportPanel form={form} />}
                <TourSimulator form={form} onWaypointUpdate={(index, field, value) => {
                  const updated = form.waypoints.map((wp, i) =>
                    i === index ? { ...wp, [field]: value } : wp
                  );
                  set('waypoints', updated);
                }} segmentScripts={form.segment_scripts || []} onSegmentScriptsChange={(scripts) => set('segment_scripts', scripts)} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}