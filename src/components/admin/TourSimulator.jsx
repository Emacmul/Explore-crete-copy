import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, Square, Gauge, Clock, Volume2, AlertTriangle, CheckCircle2, MapPin, Radio, Flag, ChevronDown, ChevronUp, Save, Loader2, Lock } from 'lucide-react';
import { calculateBearing, isBearingInRange } from '@/lib/routeExport';
import TourSimulatorMap from './TourSimulatorMap';
import WaypointPaceEditor from './WaypointPaceEditor';
import NarrationTtsEditor from './NarrationTtsEditor';
import { toast } from '@/components/ui/use-toast';

const ROLE_LABEL = { primary_start: 'Start', primary_stop: 'Stop', secondary: 'Point' };

const R_EARTH = 6371000;
const TICK_MS = 100;

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

function buildPath(path, breakSet) {
  const breaks = breakSet || new Set();
  const segments = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    // A cut at index i means no path between point i and i+1 — the simulated
    // vehicle jumps across the gap, so that segment adds no driven distance.
    if (breaks.has(i)) continue;
    const dist = haversine(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng);
    segments.push({ start: path[i], end: path[i + 1], dist, cumStart: total });
    total += dist;
  }
  return { segments, total };
}

function posAtDistance(segments, total, dist) {
  if (dist <= 0) return segments[0]?.start || null;
  if (dist >= total) return segments[segments.length - 1]?.end || null;
  for (const seg of segments) {
    if (dist <= seg.cumStart + seg.dist) {
      const r = seg.dist > 0 ? (dist - seg.cumStart) / seg.dist : 0;
      return {
        lat: seg.start.lat + (seg.end.lat - seg.start.lat) * r,
        lng: seg.start.lng + (seg.end.lng - seg.start.lng) * r,
      };
    }
  }
  return segments[segments.length - 1]?.end || null;
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function TourSimulator({ form, onWaypointUpdate, targetLanguage, onSave, saving, onAutoSave, isNarrator }) {
  const trailPath = form.trail_path || [];
  // Filtering out waypoints with no usable lat/lng means every index used inside this
  // component (selectedWpIndex, the map's per-marker index, jumpToWaypoint's
  // targetIndex, etc.) is a position in THIS filtered list — which only equals the
  // waypoint's real position in form.waypoints when nothing before it got filtered
  // out. If even one earlier waypoint is mid-edit with a blank/NaN lat or lng (e.g.
  // someone has just cleared the field to paste in new coordinates), every waypoint
  // after it shifts by one here, and calling onWaypointUpdate with that shifted index
  // silently edits the WRONG waypoint in the real array — the one this panel shows
  // stays unchanged while some other one quietly gets overwritten. rawWaypointIndex
  // keeps each filtered entry's real index alongside it so every onWaypointUpdate call
  // below can be translated back to the real array position instead of assuming the
  // two line up.
  const waypointsWithIndex = useMemo(
    () => (form.waypoints || [])
      .map((wp, rawWaypointIndex) => ({ wp, rawWaypointIndex }))
      .filter(({ wp }) => wp.lat && wp.lng),
    [form.waypoints]
  );
  const waypoints = useMemo(() => waypointsWithIndex.map(({ wp }) => wp), [waypointsWithIndex]);
  const toRawIndex = (filteredIndex) => waypointsWithIndex[filteredIndex]?.rawWaypointIndex ?? filteredIndex;
  const isWalkingTour = form.tour_category !== 'DDV';

  // Which waypoint's own script/audio is currently open in the editor beside the map.
  // Defaults to the first waypoint so there's always something to work with as soon as
  // the panel appears.
  const [selectedWpIndex, setSelectedWpIndex] = useState(0);

  // Per Enda's report (follow-up 61 live-testing): follow-up 58 made the leg-scoped
  // speed-matching panel (WaypointPaceEditor) the ONLY thing this tab ever shows beside
  // the map — so opening "Narrate and Simulate" landed straight in it, before any actual
  // testing had started, eagerly regenerating TTS audio for whatever waypoint happens to
  // be selected (index 0 by default) and taking real time to do it. That's not what this
  // panel is for: it's the SECOND-session, driving-speed-matching tool, only meaningful
  // once a narrator has actually said "I want to test/tune THIS location now" via "Jump
  // to location…" + Jump. Before that, this tab must open exactly as it always did — the
  // full script/audio editor (NarrationTtsEditor), for reading through and writing
  // narration, with no eager TTS calls at all (it only ever calls out on an explicit
  // button click). speedMatchMode starts false every time (a fresh tab, or a fresh trail
  // path), flips true the moment jumpToLocation actually runs, and flips back false on
  // Reset — same "back to the start state" moment stopSim already represents.
  const [speedMatchMode, setSpeedMatchMode] = useState(false);

  // Per Enda: the "Waypoint Audio & Break Tags" dropdown below must be worked through
  // top to bottom — a waypoint can't be opened here until every waypoint before it in
  // the trail is marked done. lockedWpIndexes[i] is true the moment ANY earlier
  // waypoint (0..i-1) isn't done yet; index 0 has no priors, so it's never locked.
  // Recomputed from scratch off `waypoints` every render pass it changes, so ticking
  // or unticking "done" anywhere immediately unlocks/relocks everything after it.
  const lockedWpIndexes = useMemo(() => {
    const locked = new Array(waypoints.length).fill(false);
    let allPriorDone = true;
    for (let i = 0; i < waypoints.length; i++) {
      locked[i] = !allPriorDone;
      if (!waypoints[i]?.waypoint_done) allPriorDone = false;
    }
    return locked;
  }, [waypoints]);

  useEffect(() => {
    if (selectedWpIndex >= waypoints.length) { setSelectedWpIndex(0); return; }
    // If whatever's currently open just got locked (e.g. an earlier waypoint's "done"
    // was unticked to go back and fix something), snap back to the furthest waypoint
    // that's still actually unlocked, instead of leaving a locked, unreachable one
    // selected in the editor beside the map.
    if (lockedWpIndexes[selectedWpIndex]) {
      let lastUnlocked = 0;
      for (let i = 0; i < lockedWpIndexes.length; i++) {
        if (lockedWpIndexes[i]) break;
        lastUnlocked = i;
      }
      setSelectedWpIndex(lastUnlocked);
    }
  }, [waypoints.length, selectedWpIndex, lockedWpIndexes]);
  const selectedWp = waypoints[selectedWpIndex] || null;

  // Per Enda's report: this tab let a Done waypoint (e.g. every one of BOR1's) be
  // freely edited — wording, pause timing, even audio — with nothing enforcing the
  // same "Done means locked until explicitly unlocked" rule the Waypoints tab already
  // has for wp.waypoint_done. This is the real per-waypoint edit lock, distinct from
  // lockedWpIndexes above (that only gates which waypoint can be OPENED, sequentially —
  // it never re-locks the one already open once it's done). See the banner/props below
  // for how it's actually enforced in both sub-editors.
  const doneLocked = !!selectedWp?.waypoint_done;

  // Per Enda's later request: this section (stats, the driving-time progress bar, the
  // trigger log) now carries the ACTUAL numbers a narrator needs while speed-matching —
  // in particular the sim-time/real-time readout that shows whether a leg's audio really
  // finishes near when the car reaches the next waypoint — so it must be open by
  // default, not collapsed away. Still collapsible (a narrator who genuinely doesn't
  // need it can still tuck it away), just not hidden by default any more.
  const [showDetails, setShowDetails] = useState(true);

  // Speed is never user-editable here — an Admin sets it at tour creation, and the
  // Simulator only ever displays whatever's been set. WBT is always fixed at
  // 3.5 km/h; DDV starts from the Admin's default_driving_speed_kmh (or 50 as a
  // last-resort fallback if that hasn't been set) and then auto-advances through
  // each segment's own avg_segment_speed_kmh as the marker reaches it, below.
  const [speed, setSpeed] = useState(form.tour_category === 'WBT' ? 3.5 : (Number(form.default_driving_speed_kmh) || 50));
  // Per Enda's later request: speed-matching a waypoint's audio against real driving
  // time is meaningless at any speed other than real time — a sped-up run finishing
  // "on time" proves nothing about whether it actually will for a real customer. Fixed
  // at 1× always now; the picker that used to let this change (1/2/5/10×, in the
  // Simulation details section below) is gone. Left as real state (not a bare literal)
  // only because multRef/the tick math below still read it as one value among several —
  // simplest, lowest-risk change is pinning what it's SET to, not ripping out every
  // place that reads it.
  const [simMult] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPos, setCurrentPos] = useState(trailPath[0] || null);
  const [distTraveled, setDistTraveled] = useState(0);
  const [simTime, setSimTime] = useState(0);
  const [triggered, setTriggered] = useState({});
  const [triggerLog, setTriggerLog] = useState([]);
  // Set whenever audio.play() actually rejects — wrong/expired audio_clip_url, a
  // browser autoplay block, a decode failure, etc. Every play() call in this
  // component used to swallow that rejection silently (`.catch(() => {})`), which is
  // exactly why "the marker moved but I never heard anything" had no explanation
  // anywhere — see reportAudioError below. Cleared on the next successful play and
  // whenever the sim is reset/jumped, so a stale error doesn't linger once whatever
  // caused it has been fixed and re-tested.
  const [audioError, setAudioError] = useState(null);
  const [tourComplete, setTourComplete] = useState(false);
  const [currentSegment, setCurrentSegment] = useState(null);
  // Tracks whether the sim has actually been played at least once since the last
  // Reset/jump — distinct from distTraveled > 0, which becomes true the moment a jump
  // repositions the marker, even though nothing has played yet. Drives the green
  // button's label below: "Start" until real playback has happened, "Resume" only once
  // it genuinely has and is now paused. See jumpToWaypoint/startSim/stopSim.
  const [hasPlayed, setHasPlayed] = useState(false);
  // Per Enda's follow-up 48 report: "Jump to location…" should zoom/centre the map on
  // that location's own waypoints, not leave whatever pan/zoom the editor happened to
  // be at before. Set only by jumpToLocation (see below), never by the plain per-
  // waypoint jumpToWaypoint ("Test this waypoint") — a fresh object each time so
  // TourSimulatorMap's effect (watching this by reference) fires on every jump, even a
  // repeat jump to the same location.
  const [mapFocusBounds, setMapFocusBounds] = useState(null);
  const [currentBearing, setCurrentBearing] = useState(() =>
    trailPath.length >= 2
      ? calculateBearing(trailPath[0].lat, trailPath[0].lng, trailPath[1].lat, trailPath[1].lng)
      : 0
  );
  const initialBearingRef = useRef(currentBearing);

  const audioRef = useRef(null);
  // Per Enda's report: Pause used to stop only the car's own movement (the tick
  // interval below) — a narration clip already playing through audioRef kept going
  // completely independently, so "the car stops, the audio keeps playing" happened on
  // every Pause click mid-clip. Set true by pauseSim ONLY when it actually paused a
  // clip that was genuinely still playing (never for an already-silent moment), so
  // Resume (startSim) knows there's really something to pick back up rather than
  // blindly restarting whatever happens to be loaded in the audio element from its
  // very start. Cleared back to false the moment that resume happens, and by every
  // other place that deliberately discards audio state instead of pausing it to
  // resume later (stopSim, resetToWaypoint) — see their own comments.
  const audioPausedRef = useRef(false);
  const intervalRef = useRef(null);
  const distRef = useRef(0);
  const prevPosRef = useRef(trailPath[0] || null);
  const triggeredRef = useRef({});
  const simTimeRef = useRef(0);
  const speedRef = useRef(speed);
  const multRef = useRef(simMult);
  const tickRef = useRef(null);
  const passedSegmentsRef = useRef(new Set());
  // Entries are {url, index} — the waypoint index rides along so the "ended" handler
  // below can tell whether the clip that just finished was the one a single-waypoint
  // test is specifically waiting on (see scopedTestRef).
  const audioQueueRef = useRef([]);
  // Which waypoint's audio is the CURRENTLY loaded/playing clip in audioRef.current, if
  // any — set the moment a clip starts, cleared once its "ended" handling has run.
  const activeAudioWpIndexRef = useRef(null);
  // Set by jumpToWaypoint() below whenever a jump/test is scoped — either "Jump to
  // location…" (drive across the whole location, auto-pause at the next location) or
  // "Test this waypoint" (drive across just this one waypoint's own stretch, auto-pause
  // at the very next waypoint, whatever its role) — and cleared by stopSim()/Reset.
  // segmentEndDist is the one auto-pause point either way; excludeWaypointIndex keeps
  // that boundary waypoint's own audio from triggering early, before the boundary check
  // below has actually paused there.
  const scopedTestRef = useRef(null);
  // Per Enda: "Test this subsegment" (WaypointPaceEditor, beside the map) needs to play
  // a freshly-combined LIVE preview of whatever the pause sliders currently say — built
  // in-browser from segments that haven't been saved anywhere yet — through this exact
  // same simulator engine, not the waypoint's own (stale, already-saved) audio_clip_url.
  // {index, url} for exactly one waypoint at a time; only ever set by jumpToWaypoint's
  // own audioOverrideUrl param below (which also clears it on every OTHER jump/test, so
  // a stale preview can never leak into an unrelated run), and consulted by the geofence
  // check in tickRef above.
  const previewAudioOverrideRef = useRef(null);
  // Per Enda's report: after a scoped jump/test actually finished (the car stopped at
  // its boundary), clicking the toolbar's own big green button — which by then reads
  // "Replay" — did nothing at all. distRef was already sitting exactly at that boundary,
  // so the very next tick just re-triggered the same "already arrived" check and
  // stopped again instantly, with no visible movement or audio. Remembers what the last
  // jump/test actually was, so "Replay" can genuinely redo it instead of silently
  // failing. `hasOverride` marks a single-waypoint "Test this subsegment" run
  // specifically (a LIVE, possibly-stale WAV built from whatever the pause sliders said
  // at THAT click) — deliberately never auto-replayed from here, since only
  // WaypointPaceEditor's own button can rebuild it from the sliders' CURRENT values;
  // replaying the stored one here could silently replay timing the narrator has since
  // changed. Cleared by Reset (stopSim), same "back to a clean slate" moment as
  // everything else there.
  const lastJumpRef = useRef(null);

  // Every audio.play() call in this component used to end in `.catch(() => {})` —
  // whatever went wrong (a stale/expired audio_clip_url, the browser's autoplay
  // policy blocking a play() that didn't originate from a direct click, a missing
  // file, a decode error) vanished silently. That's exactly what makes "the marker
  // moved but I never heard anything" impossible to diagnose from the UI alone.
  // Surfaces the real error both ways: a toast right when it happens, and a
  // banner in the toolbar (see audioError below) that stays up until the next
  // successful play, a jump, or a reset clears it.
  const reportAudioError = (waypointIndex, err) => {
    const wp = waypoints[waypointIndex];
    const label = wp?.segment_id || wp?.name || `waypoint ${waypointIndex + 1}`;
    const reason = err?.message || 'the browser blocked it, the file is missing, or the saved link has expired';
    console.error(`[TourSimulator] Could not play audio for ${label} (${wp?.audio_clip_url || 'no URL'}):`, err);
    setAudioError(`Could not play "${label}"'s audio — ${reason}.`);
    toast({ variant: 'destructive', title: 'Audio failed to play', description: `${label}: ${reason}` });
  };

  const handleAudioEndedRef = useRef(null);
  handleAudioEndedRef.current = () => {
    activeAudioWpIndexRef.current = null;
    if (audioQueueRef.current.length > 0) {
      const next = audioQueueRef.current.shift();
      if (audioRef.current) {
        audioRef.current.src = next.url;
        activeAudioWpIndexRef.current = next.index;
        audioRef.current.play().then(() => setAudioError(null)).catch((err) => reportAudioError(next.index, err));
      }
    }
  };

  const breakSet = useMemo(
    () => new Set((form.trail_breaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1)),
    [form.trail_breaks, trailPath.length]
  );
  const pathData = useMemo(() => buildPath(trailPath, breakSet), [trailPath, breakSet]);
  const speedZones = useMemo(() => {
    return waypoints
      .map((wp, index) => ({ wp, index }))
      .filter(({ wp }) => wp.waypoint_role === 'primary_start' && Number(wp.avg_segment_speed_kmh) > 0);
  }, [waypoints]);

  // How far along the trail a given waypoint sits — the nearest trail_path point to it,
  // walked forward from the start (same approach ScriptTimingPanel used for its
  // per-segment stats). Shared by the "Jump to location" list below and by the
  // per-waypoint "Test this waypoint" button, so both jump using the exact same logic.
  const cumDistForWaypoint = (wp) => {
    let nearestIdx = 0, minD = Infinity;
    trailPath.forEach((pt, i) => {
      const d = haversine(wp.lat, wp.lng, pt.lat, pt.lng);
      if (d < minD) { minD = d; nearestIdx = i; }
    });
    let cumDist = 0;
    for (let i = 1; i <= nearestIdx; i++) {
      if (breakSet.has(i - 1)) continue; // cut segment — not driven, skip its distance
      cumDist += haversine(trailPath[i - 1].lat, trailPath[i - 1].lng, trailPath[i].lat, trailPath[i].lng);
    }
    return cumDist;
  };

  // Where a location scoped jump/test (see jumpToWaypoint below) should auto-pause: the
  // very next primary_start waypoint AFTER the one being tested — per Enda, that point
  // is where the next location starts, which is exactly where the current one ends (a
  // primary_stop role exists but isn't reliably placed at the end of every location in
  // real data, so it's not used for this). Returns null when there's no primary_start
  // left after this point — i.e. this is the LAST location in the tour — in which case
  // there's no such boundary and the ordinary "reached the very end of the trail" check
  // elsewhere in this file is what stops it.
  const nextLocationBoundary = (targetIndex) => {
    for (let i = targetIndex + 1; i < waypoints.length; i++) {
      if (waypoints[i].waypoint_role === 'primary_start') {
        return { dist: cumDistForWaypoint(waypoints[i]), waypointIndex: i };
      }
    }
    return null;
  };

  // Where a single-waypoint test (see "Test this waypoint" / jumpToWaypoint's
  // scopeToThisWaypoint below) should auto-pause: the very NEXT waypoint in the list,
  // whatever its own role — e.g. BOR1a's own boundary is BOR1b, not the next whole
  // location. Per Enda: BOR1b is its own point within the same BOR1 location, not a
  // separate location, so nextLocationBoundary (which only stops at the next
  // primary_start) skips right past it. Checking one point's speech length against
  // driving speed means watching the car actually drive from that point to the very
  // next one and seeing whether the audio has already finished, or is still going, once
  // it gets there — so this must be a real drive to a real next point, never a stop
  // triggered by the audio clip itself ending early.
  const nextWaypointBoundary = (targetIndex) => {
    const next = waypoints[targetIndex + 1];
    if (!next) return null;
    return { dist: cumDistForWaypoint(next), waypointIndex: targetIndex + 1 };
  };

  // Every primary_start location, with how far along the trail it sits — lets the narrator jump
  // the simulation straight to their own location instead of always having to play through
  // every location before it first.
  //
  // Per Enda: this list must only ever show a location that's completely finished — never
  // one still being worked on, and never one that hasn't been touched at all yet. A
  // location's own extent is the same "from this primary_start up to (but not including)
  // the very next one" boundary nextLocationBoundary uses to drive the simulator itself —
  // it's "complete" only when EVERY waypoint in that whole stretch has waypoint_done set,
  // not just its own primary_start point. An empty stretch (shouldn't happen, but a
  // primary_start with nothing after it before the next one) is never treated as complete.
  // Per Enda's report: the dropdown just silently disappearing when a location isn't
  // complete gives no clue why — he had to come back and ask. locationStatus computes
  // every primary_start location's done/not-done breakdown in one pass (both the
  // ready-to-jump list and the still-incomplete one derive from this single source, so
  // they can never disagree with each other about what "complete" means).
  const locationStatus = useMemo(() => {
    if (trailPath.length < 2) return [];
    const primaryStarts = waypoints
      .map((wp, index) => ({ wp, index }))
      .filter(({ wp }) => wp.waypoint_role === 'primary_start');
    return primaryStarts
      .map(({ wp, index }, i) => {
        const nextBoundaryIndex = primaryStarts[i + 1]?.index ?? waypoints.length;
        const locationWaypoints = waypoints.slice(index, nextBoundaryIndex);
        const notDoneCount = locationWaypoints.filter(w => !w.waypoint_done).length;
        return {
          wp, index, endIndex: nextBoundaryIndex, cumDist: cumDistForWaypoint(wp),
          label: wp.segment_id || wp.segment_title || wp.name || `Location ${index + 1}`,
          isComplete: locationWaypoints.length > 0 && notDoneCount === 0,
          notDoneCount,
          total: locationWaypoints.length,
        };
      });
  }, [waypoints, trailPath, breakSet]);
  const locationTargets = useMemo(() => locationStatus.filter(t => t.isComplete), [locationStatus]);
  // Shown next to the toolbar only when nothing is jumpable yet, so it's obvious WHY —
  // instead of the whole control just vanishing with no explanation.
  const incompleteLocations = useMemo(() => locationStatus.filter(t => !t.isComplete), [locationStatus]);
  const [jumpTargetIndex, setJumpTargetIndex] = useState('');

  // Per Enda's report: the map used to always show the whole tour (or, while
  // speed-matching one leg, just that one leg) no matter which location's waypoint was
  // open in "Waypoint Audio & Break Tags" — so a narrator writing BOR1's script had no
  // way to tell, at a glance, that they were even looking at BOR1's own stretch of road.
  // This finds which location (which primary_start's range) currently contains
  // selectedWpIndex, so the map below can scope itself to just that location — always
  // anchored on that location's own green Start point.
  const currentLocationRange = useMemo(() => {
    let current = null;
    for (const loc of locationStatus) {
      if (loc.index <= selectedWpIndex) current = loc;
      else break;
    }
    if (!current) return null;
    return { startIndex: current.index, endIndex: current.endIndex, label: current.label };
  }, [locationStatus, selectedWpIndex]);

  // Per Enda: the tour's very first location is always built the same way — its
  // Primary-Start waypoint (e.g. BOR1a) is a static point where nothing moves (the
  // narrator welcomes people and gives them a moment to get ready), and the very next
  // waypoint (BOR1b) is where the drive actually begins — so, by design, those two
  // sit at the exact same coordinates. "This will never happen in any other
  // location" (his words) — every other location's own Primary-Start point is
  // somewhere the vehicle actually is before it starts moving, so it never coincides
  // with the next waypoint. Two markers stacked on the same spot reads as a single
  // confusing blob, so whenever waypoint 1 (BOR1b) is the one open for editing —
  // via "Jump to location…" (see jumpToLocation below) or picked directly from the
  // dropdown — waypoint 0 (BOR1a) fades out on the map instead of competing with it
  // for attention. Still visible, just no longer looks like an unexplained
  // duplicate. Index 1 only ever means "location 1's second waypoint" because a
  // tour's first waypoint is always location 1's own Primary-Start.
  const dimWaypointIndex = (waypoints.length > 1 && selectedWpIndex === 1) ? 0 : null;

  // If the location currently picked in "Jump to location…" drops out of the (now
  // finished-only) list above — e.g. someone unticks a waypoint's done state to go back
  // and fix something, un-finishing that whole location — clear the stale selection
  // instead of leaving a hidden location's index sitting in the field.
  useEffect(() => {
    if (jumpTargetIndex !== '' && !locationTargets.some(t => t.index === Number(jumpTargetIndex))) {
      setJumpTargetIndex('');
    }
  }, [locationTargets, jumpTargetIndex]);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { multRef.current = simMult; }, [simMult]);
  useEffect(() => {
    if (trailPath.length >= 2) {
      const b = calculateBearing(trailPath[0].lat, trailPath[0].lng, trailPath[1].lat, trailPath[1].lng);
      initialBearingRef.current = b;
      setCurrentBearing(b);
    } else {
      initialBearingRef.current = 0;
      setCurrentBearing(0);
    }
  }, [trailPath]);

  const stopSim = () => {
    setIsPlaying(false);
    setSpeedMatchMode(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    distRef.current = 0;
    simTimeRef.current = 0;
    triggeredRef.current = {};
    passedSegmentsRef.current = new Set();
    audioQueueRef.current = [];
    activeAudioWpIndexRef.current = null;
    scopedTestRef.current = null;
    previewAudioOverrideRef.current = null;
    lastJumpRef.current = null;
    setDistTraveled(0);
    setSimTime(0);
    setTriggered({});
    setTriggerLog([]);
    setTourComplete(false);
    setCurrentSegment(null);
    setHasPlayed(false);
    setAudioError(null);
    setCurrentBearing(initialBearingRef.current);
    if (audioRef.current) audioRef.current.pause();
    audioPausedRef.current = false;
    const startPos = trailPath[0];
    if (startPos) { setCurrentPos(startPos); prevPosRef.current = startPos; }
  };

  // Jump the simulation straight to any single waypoint — not just a location's own
  // primary_start point — marking every waypoint before it as already-triggered (so
  // earlier waypoints' audio doesn't fire again). The map's own zoom/pan is left
  // completely alone (FitBounds, in TourSimulatorMap.jsx, no longer reacts to a
  // moving/re-rendering waypoints list), so an admin/narrator can zoom right in on one
  // waypoint, jump to it, and (via autoplay — see below) immediately hear that
  // waypoint's own saved audio play out against the moving marker — repeatable for
  // every waypoint in turn. Jumping to a location's start (from the "Jump to
  // location…" list) is just this same function called on that location's own
  // primary_start waypoint.
  //
  // Every jump is scoped so the tick loop below auto-pauses at a real boundary, rather
  // than driving on uncontrolled into whatever comes next. "Jump to location…" (whole
  // location) uses nextLocationBoundary — the very next primary_start waypoint, i.e.
  // where the NEXT location starts, so it's also exactly where this one ends.
  // `scopeToThisWaypoint`, for "Test this waypoint", narrows this to just one point's
  // own stretch instead: nextWaypointBoundary — the very next waypoint in the list,
  // whatever its role, so BOR1a's own test stops at BOR1b, not at wherever the next
  // whole location happens to start. Either way the boundary waypoint is also excluded
  // from triggering its own audio during this run (see the geofence check further
  // down), so a test can never bleed into whatever comes after the boundary starting to
  // play too early.
  // audioOverrideUrl (per Enda's "Test this subsegment" request, WaypointPaceEditor):
  // when set, this ONE run plays that URL for targetIndex's own audio instead of its
  // real (possibly stale, possibly not-yet-saved) audio_clip_url — see
  // previewAudioOverrideRef above and the geofence check in tickRef that consults it.
  // Always set here, even to null, so every OTHER caller (Jump to location, a plain
  // re-test with no override) correctly clears out whatever a PREVIOUS test's override
  // left behind, rather than a stale preview silently leaking into an unrelated run.
  // The actual repositioning/reset a jump does — pulled out on its own, separate from
  // jumpToWaypoint below, specifically so startSim's own "Replay" handling (further
  // down) can redo a jump WITHOUT calling jumpToWaypoint itself, which would call
  // startSim again and recurse. Pure state-setting only; never touches isPlaying or the
  // tick interval — callers decide when to actually start ticking.
  const resetToWaypoint = (targetIndex, { scopeToThisWaypoint = false, audioOverrideUrl = null } = {}) => {
    const wp = waypoints[targetIndex];
    if (!wp) return false;
    const cumDist = cumDistForWaypoint(wp);
    const newPos = posAtDistance(pathData.segments, pathData.total, cumDist);
    distRef.current = cumDist;
    simTimeRef.current = 0;
    triggeredRef.current = {};
    waypoints.forEach((w, i) => { if (i < targetIndex) triggeredRef.current[i] = true; });
    passedSegmentsRef.current = new Set();
    audioQueueRef.current = [];
    activeAudioWpIndexRef.current = null;
    previewAudioOverrideRef.current = audioOverrideUrl ? { index: targetIndex, url: audioOverrideUrl } : null;
    const boundary = scopeToThisWaypoint ? nextWaypointBoundary(targetIndex) : nextLocationBoundary(targetIndex);
    scopedTestRef.current = {
      segmentEndDist: boundary?.dist ?? null,
      excludeWaypointIndex: boundary?.waypointIndex ?? null,
    };
    if (audioRef.current) audioRef.current.pause();
    audioPausedRef.current = false;
    setDistTraveled(cumDist);
    setSimTime(0);
    setTriggered({ ...triggeredRef.current });
    setTriggerLog([]);
    setTourComplete(false);
    // Landing on a waypoint via a jump is not the same as having played anything —
    // reset the "ever played" flag so the button below reads "Start"/"Play", not a
    // misleading "Resume", until playback (below, or manually) actually happens.
    setHasPlayed(false);
    setAudioError(null);
    if (newPos) { setCurrentPos(newPos); prevPosRef.current = newPos; }
    lastJumpRef.current = { targetIndex, scopeToThisWaypoint, hasOverride: !!audioOverrideUrl };
    return true;
  };

  const jumpToWaypoint = (targetIndex, { autoplay = false, scopeToThisWaypoint = false, audioOverrideUrl = null } = {}) => {
    pauseSim();
    if (!resetToWaypoint(targetIndex, { scopeToThisWaypoint, audioOverrideUrl })) return;
    if (autoplay) startSim();
  };

  // Per Enda's report: "Reset" used to always call stopSim — a full reset back to the
  // very start of the whole tour AND, as a side effect (see stopSim/speedMatchMode's
  // own comments), an exit out of "jump to" pace-testing mode entirely, silently
  // swapping the purpose-built WaypointPaceEditor panel (sub-segment text boxes and
  // pause sliders only) out for the full NarrationTtsEditor script/TTS editor with its
  // always-visible, always-editable top script box. A narrator mid pace-test clicking
  // what they call the "restart" button just wants to restart THIS test — not to be
  // dropped back into a completely different editing screen they never asked to
  // leave. So: while actually pace-testing (speedMatchMode, set by jumpToLocation),
  // Reset now redoes the SAME scoped jump instead — the exact "redo whatever was last
  // jumped to" logic startSim's own Replay handling already uses — leaving
  // speedMatchMode (and therefore WaypointPaceEditor) untouched. Outside pace-testing
  // (plain script/audio browsing, the tab's default state), Reset is completely
  // unchanged — a full stopSim, same as always. The automatic "trail path changed"
  // reset (the effect above) and the unmount cleanup both still call stopSim directly,
  // not this — a trail path actually changing shape invalidates any in-progress jump
  // regardless of mode, so that one case must always fully reset, jump-to mode
  // included.
  const handleResetClick = () => {
    if (speedMatchMode && lastJumpRef.current) {
      pauseSim();
      resetToWaypoint(lastJumpRef.current.targetIndex, {
        scopeToThisWaypoint: lastJumpRef.current.scopeToThisWaypoint,
      });
      return;
    }
    stopSim();
  };
  // Per Enda's follow-up 48 report: reversing follow-up 37's own change here —
  // jumping to a location must NOT autoplay any more. "The person editing this
  // location has to manually start the car/walker moving. It should never happen
  // automatically." jumpToWaypoint already leaves autoplay defaulted to false, so this
  // just stops explicitly opting into it; hasPlayed still resets to false inside
  // jumpToWaypoint regardless, so the green button correctly still reads "Start", never
  // a leftover "Resume", right after a jump.
  //
  // What jumping to a location DOES still do, new in follow-up 48: zoom/centre the map
  // on this location's own extent — its own primary_start waypoint through every
  // secondary point up to (not including) the next location's primary_start — instead
  // of leaving whatever pan/zoom the editor was previously at. Reuses
  // nextLocationBoundary, the exact same "where does this location end" logic the
  // scoped-playback boundary already relies on, so the map's own idea of "this
  // location" can never drift from the simulator's.
  const jumpToLocation = (targetIndex) => {
    jumpToWaypoint(targetIndex);
    // This is the actual moment a narrator has said "I want to test/tune this location
    // now" — see the speedMatchMode comment above its declaration. Also snaps the
    // waypoint dropdown to this location's own start point, so the panel that's about to
    // switch in opens already showing the location just jumped to, not whatever was
    // selected before.
    setSpeedMatchMode(true);
    // Per Enda: location 1 is the one exception — its Primary-Start (index 0) is a
    // static "welcome, get ready" point that never moves, so there's no driving leg
    // to speed-match its speech against, and it sits at the exact same coordinates
    // as index 1 (see dimWaypointIndex above). Editing focus after "Jump to
    // location…" should land on index 1 instead for location 1 specifically — every
    // other location's Primary-Start is the point that actually needs focus, since
    // only location 1 has this static-then-moving pair.
    const isFirstLocationInTour = targetIndex === 0;
    const focusIndex = (isFirstLocationInTour && waypoints.length > 1) ? targetIndex + 1 : targetIndex;
    setSelectedWpIndex(focusIndex);
    const boundary = nextLocationBoundary(targetIndex);
    const endIndex = boundary ? boundary.waypointIndex : waypoints.length;
    const locationWaypoints = waypoints.slice(targetIndex, endIndex);
    const bounds = locationWaypoints.filter(wp => wp.lat && wp.lng).map(wp => [wp.lat, wp.lng]);
    if (bounds.length > 0) setMapFocusBounds(bounds);
  };

  // Per Enda: while actually pace-testing one leg (speedMatchMode — the WaypointPaceEditor
  // panel), the map must stay zoomed to just the CURRENTLY selected waypoint's own leg —
  // from wherever it sits to the very next waypoint in the list — never the whole
  // location. A whole-location view hides exactly the thing THAT panel exists to get
  // right: whether the car's own short, real movement across ONE stretch lines up with
  // ONE waypoint's own audio. Unchanged from before.
  //
  // Per Enda's later report: outside of that pace-testing view — ordinary script/audio
  // browsing, which is the DEFAULT state this tab opens in — the map should instead show
  // the WHOLE location the open waypoint belongs to (every waypoint from that location's
  // own green Start point up to, but not including, the next location's Start), not a
  // single leg and not the entire multi-location tour. Re-fits every time the selected
  // waypoint (or which location it's in) changes, including on first load. Left alone
  // entirely while a run is actually playing, so this never fights a live full-tour
  // drive or a "Jump to location…" scoped run's own view.
  useEffect(() => {
    if (isPlaying) return;
    if (speedMatchMode) {
      const wp = waypoints[selectedWpIndex];
      if (!wp || !wp.lat || !wp.lng) return;
      const next = waypoints[selectedWpIndex + 1];
      const bounds = [[wp.lat, wp.lng]];
      if (next && next.lat && next.lng) bounds.push([next.lat, next.lng]);
      setMapFocusBounds(bounds);
      return;
    }
    if (!currentLocationRange) return;
    const locationWaypoints = waypoints.slice(currentLocationRange.startIndex, currentLocationRange.endIndex);
    const bounds = locationWaypoints.filter(wp => wp.lat && wp.lng).map(wp => [wp.lat, wp.lng]);
    if (bounds.length > 0) setMapFocusBounds(bounds);
  }, [selectedWpIndex, waypoints, speedMatchMode, isPlaying, currentLocationRange]);

  // Reset when trail path changes
  useEffect(() => {
    stopSim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailPath]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handler = () => handleAudioEndedRef.current();
    audio.addEventListener('ended', handler);
    return () => audio.removeEventListener('ended', handler);
  }, []);

  tickRef.current = () => {
    // Per Enda: while a primary_start waypoint's own audio is the one actually playing
    // right now (activeAudioWpIndexRef — set the moment its clip starts, in the geofence
    // check further down, and cleared by handleAudioEndedRef once it finishes), the
    // vehicle must stay exactly where it is. The customer is still parked in the
    // location's car park at that point — they haven't started driving yet — so letting
    // the marker glide forward underneath a still-playing "welcome" narration is
    // confusing to watch. Movement resumes the instant that clip ends and control moves
    // on (to a different waypoint's already-queued clip, or to nothing) — no separate
    // "resume" logic needed, since this same check just stops matching on the very next
    // tick. Deliberately keyed off which waypoint's audio is ACTUALLY playing, not just
    // "are we near a primary_start" — a secondary point's audio playing while lingering
    // close to a primary_start's own coordinates (e.g. a co-located pair) must not freeze
    // anything.
    // simTime still advances through this stop (so the driving-time estimate keeps
    // counting real elapsed time), but distTraveled/currentPos are left completely
    // untouched — no geofence/speed-zone checks run either, since position hasn't moved.
    const activeWp = activeAudioWpIndexRef.current != null ? waypoints[activeAudioWpIndexRef.current] : null;
    if (activeWp?.waypoint_role === 'primary_start') {
      simTimeRef.current += TICK_MS * multRef.current;
      setSimTime(simTimeRef.current);
      return;
    }

    const speedMs = (speedRef.current * 1000) / 3600;
    const delta = speedMs * multRef.current * (TICK_MS / 1000);
    const newDist = distRef.current + delta;

    if (newDist >= pathData.total) {
      distRef.current = pathData.total;
      setDistTraveled(pathData.total);
      const endPos = trailPath[trailPath.length - 1];
      if (endPos) { setCurrentPos(endPos); prevPosRef.current = endPos; }
      setIsPlaying(false);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setTourComplete(true);
      return;
    }

    // A scoped jump/test (see jumpToWaypoint) auto-pauses right here, at its own
    // boundary — the next location for "Jump to location…", or just the next waypoint
    // for "Test this waypoint" — instead of driving on uncontrolled past it.
    const segBoundary = scopedTestRef.current?.segmentEndDist;
    if (segBoundary != null && newDist >= segBoundary) {
      distRef.current = segBoundary;
      setDistTraveled(segBoundary);
      const boundaryPos = posAtDistance(pathData.segments, pathData.total, segBoundary);
      if (boundaryPos) { setCurrentPos(boundaryPos); prevPosRef.current = boundaryPos; }
      setIsPlaying(false);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setTourComplete(true);
      return;
    }

    const newPos = posAtDistance(pathData.segments, pathData.total, newDist);
    if (!newPos) return;

    // Check geofences
    waypoints.forEach((wp, i) => {
      // Per Enda: "Test this subsegment" (WaypointPaceEditor) needs to drive this exact
      // same geofence/queue machinery against a freshly-combined LIVE preview — whatever
      // the pause sliders currently say, before it's been saved anywhere — not the stale
      // audio_clip_url already on the waypoint. previewAudioOverrideRef (set by
      // jumpToWaypoint's own audioOverrideUrl param, below) carries that one-off URL for
      // exactly the ONE waypoint index it was built for; everything else about this
      // waypoint (trigger_audio, radius, bearing, once-only) is completely unaffected —
      // an override only ever substitutes WHICH clip plays, never whether/when it does.
      const overrideUrl = previewAudioOverrideRef.current?.index === i ? previewAudioOverrideRef.current.url : null;
      const audioUrlToPlay = overrideUrl || wp.audio_clip_url;
      if (!wp.trigger_audio || !audioUrlToPlay) return;
      if (wp.trigger_once !== false && triggeredRef.current[i]) return;
      // Belongs to the NEXT location, not the one currently being tested (see
      // nextLocationBoundary) — don't let it start playing early, before the boundary
      // check above has actually paused there.
      if (scopedTestRef.current?.excludeWaypointIndex === i) return;

      const d = haversine(newPos.lat, newPos.lng, wp.lat, wp.lng);
      const radius = Number(wp.trigger_radius_m) || 30;
      if (d > radius) return;

      if (wp.use_bearing && prevPosRef.current) {
        const moveBearing = calculateBearing(
          prevPosRef.current.lat, prevPosRef.current.lng,
          newPos.lat, newPos.lng
        );
        if (!isBearingInRange(moveBearing, Number(wp.bearing_direction) || 0, Number(wp.bearing_tolerance) || 30)) return;
      }

      triggeredRef.current[i] = true;
      const wasPlaying = audioRef.current && !audioRef.current.paused;
      if (audioRef.current) {
        if (wasPlaying) {
          audioQueueRef.current.push({ url: audioUrlToPlay, index: i });
        } else {
          audioRef.current.src = audioUrlToPlay;
          activeAudioWpIndexRef.current = i;
          audioRef.current.play().then(() => setAudioError(null)).catch((err) => reportAudioError(i, err));
        }
      }
      setTriggered({ ...triggeredRef.current });
      setTriggerLog(prev => [...prev, {
        wp, index: i, distance: newDist, simTime: simTimeRef.current,
        distFromCenter: d, overlap: wasPlaying,
      }]);
    });

    // Advance speed through each segment's own avg_segment_speed_kmh as the marker
    // reaches it. DDV only — WBT stays fixed at 3.5 km/h regardless of anything set
    // on a waypoint.
    if (!isWalkingTour) {
      speedZones.forEach(({ wp, index }) => {
        if (passedSegmentsRef.current.has(index)) return;
        const segD = haversine(newPos.lat, newPos.lng, wp.lat, wp.lng);
        if (segD <= 150) {
          passedSegmentsRef.current.add(index);
          const segSpeed = Number(wp.avg_segment_speed_kmh);
          if (segSpeed > 0) {
            speedRef.current = segSpeed;
            setSpeed(segSpeed);
            setCurrentSegment({ wp, index, speed: segSpeed });
            setTriggerLog(prev => [...prev, {
              type: 'speed', wp, index, distance: newDist, simTime: simTimeRef.current, newSpeed: segSpeed,
            }]);
          }
        }
      });
    }

    // Update heading when the car has moved meaningfully
    if (prevPosRef.current) {
      const moveDist = haversine(prevPosRef.current.lat, prevPosRef.current.lng, newPos.lat, newPos.lng);
      if (moveDist > 1) {
        setCurrentBearing(calculateBearing(prevPosRef.current.lat, prevPosRef.current.lng, newPos.lat, newPos.lng));
      }
    }

    distRef.current = newDist;
    prevPosRef.current = newPos;
    simTimeRef.current += TICK_MS * multRef.current;
    setCurrentPos(newPos);
    setDistTraveled(newDist);
    setSimTime(simTimeRef.current);
  };

  const startSim = () => {
    if (pathData.total === 0 || trailPath.length < 2) return;
    // Per Enda's report: this button reads "Replay" once a run has actually finished
    // (tourComplete) — but distRef was already sitting exactly at wherever that run
    // stopped, so simply resuming ticking from there just re-triggered the same
    // "already arrived" check on the very next tick and stopped again instantly, with
    // nothing visible happening. Genuinely redo whatever that run was instead.
    if (tourComplete) {
      if (lastJumpRef.current && !lastJumpRef.current.hasOverride) {
        // A whole-location "Jump to location…" run (or a plain "Test this waypoint"-
        // style jump with no live preview) — safe to redo exactly, since it only ever
        // plays each waypoint's own real, already-saved audio_clip_url.
        resetToWaypoint(lastJumpRef.current.targetIndex, { scopeToThisWaypoint: lastJumpRef.current.scopeToThisWaypoint });
      } else if (!lastJumpRef.current) {
        // The true end of the whole trail, reached by plain playback from the start —
        // rewind to the real beginning rather than doing nothing.
        distRef.current = 0;
        simTimeRef.current = 0;
        triggeredRef.current = {};
        passedSegmentsRef.current = new Set();
        const startPos = trailPath[0];
        if (startPos) { setCurrentPos(startPos); prevPosRef.current = startPos; }
        setDistTraveled(0);
        setSimTime(0);
        setTriggered({});
        setTriggerLog([]);
      }
      // else: lastJumpRef.current.hasOverride is true — a single-waypoint "Test this
      // subsegment" run. Deliberately left alone here (the button below is disabled for
      // exactly this state) — only WaypointPaceEditor's own button can rebuild that
      // preview from the pause sliders' CURRENT values; redoing it from here would risk
      // silently replaying timing the narrator has since changed.
    }
    setTourComplete(false);
    if (!isWalkingTour && speedZones.length > 0) {
      const firstZone = speedZones[0];
      const firstD = haversine(trailPath[0].lat, trailPath[0].lng, firstZone.wp.lat, firstZone.wp.lng);
      if (firstD <= 150) {
        passedSegmentsRef.current.add(firstZone.index);
        const segSpeed = Number(firstZone.wp.avg_segment_speed_kmh);
        if (segSpeed > 0) {
          speedRef.current = segSpeed;
          setSpeed(segSpeed);
          setCurrentSegment({ wp: firstZone.wp, index: firstZone.index, speed: segSpeed });
        }
      }
    }
    // Per Enda's report: the mirror image of pauseSim's own fix below — Pause now
    // genuinely pauses a mid-clip narration (see audioPausedRef), so Start/Resume must
    // genuinely pick that exact same clip back up, at the position it was left, rather
    // than leaving it silent while the car starts moving again. Only actually resumes
    // when audioPausedRef says a real pause happened (never for an ordinary fresh
    // start or replay, where there's nothing paused to continue) — every other place
    // that ends a run on purpose (stopSim, resetToWaypoint, both run just above for
    // Replay) already clears this flag first, so this is a no-op there.
    if (audioPausedRef.current && audioRef.current) {
      audioRef.current.play().then(() => setAudioError(null)).catch((err) => {
        if (activeAudioWpIndexRef.current != null) reportAudioError(activeAudioWpIndexRef.current, err);
      });
    }
    audioPausedRef.current = false;
    setIsPlaying(true);
    setHasPlayed(true);
    intervalRef.current = setInterval(() => tickRef.current(), TICK_MS);
  };

  // Per Enda's report: the toolbar's own Start button used to always drive the WHOLE
  // multi-location tour from the very beginning, even while the editor was clearly
  // scoped to one location already (the map itself only shows that location — see
  // currentLocationRange above). A genuinely fresh Start — never played yet, not mid
  // pace-test, not already complete — now instead starts a SCOPED run of just the
  // currently open location: reusing jumpToWaypoint/resetToWaypoint's existing
  // scoped-boundary machinery, the exact same mechanism "Jump to location…" already
  // uses, not a new one — so the car plays only that location's own waypoints' audio
  // and auto-pauses at its own last waypoint, instead of driving on into the next
  // location. jumpToWaypoint sets lastJumpRef as a side effect, so startSim's own
  // existing Replay handling (above) already knows how to redo this exact same scoped
  // run with no extra code needed. Resuming an already-paused run (hasPlayed already
  // true) and replaying an already-completed one (tourComplete already true) are both
  // untouched — only a genuinely fresh Start click is redirected here.
  const handleStartClick = () => {
    if (!hasPlayed && !tourComplete && !speedMatchMode && currentLocationRange) {
      jumpToWaypoint(currentLocationRange.startIndex, { autoplay: true });
      return;
    }
    startSim();
  };

  // Per Enda's report: this used to stop only the car's own movement (the tick
  // interval) — any narration clip already playing through audioRef kept going
  // completely independently of it, so the marker would freeze while the voice kept
  // right on talking. Pausing the actual <audio> element here keeps the two in
  // lockstep. Only remembered as a real pause (audioPausedRef) when a clip was
  // genuinely still playing at that instant — never for an already-silent moment
  // (nothing playing, or a clip that had already finished) — so Start/Resume
  // (startSim above) knows there's really something to pick back up, rather than
  // blindly restarting whatever's loaded in the audio element from its very beginning.
  const pauseSim = () => {
    setIsPlaying(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      audioPausedRef.current = true;
    }
  };

  const progressPct = pathData.total > 0 ? Math.min(100, (distTraveled / pathData.total) * 100) : 0;
  const realDurationSec = pathData.total > 0 && speed > 0 ? (pathData.total / 1000) / speed * 3600 : 0;
  const audioTriggerCount = waypoints.filter(wp => wp.trigger_audio).length;

  if (trailPath.length < 2) {
    return (
      <div className="bg-slate-700/50 rounded-xl border border-purple-600/40 p-6">
        <div className="flex items-center gap-2 mb-2">
          <Gauge className="w-5 h-5 text-purple-400" />
          <h3 className="text-white font-semibold">Simulate Tour</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-slate-500">
          <MapPin className="w-10 h-10 mb-3 opacity-40" />
          <p className="font-medium">No trail path available</p>
          <p className="text-sm">Add a trail path in the "Trail Path" tab to simulate this tour.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-700/50 rounded-xl border border-purple-600/40 p-4 space-y-3">
      {/* Per Enda: this compact bar is the ONLY thing shown above the map/editor —
          everything needed to actually run a test (start/pause/reset, the read-only
          speed, jumping to a location) in one line, so nothing pushes the real
          workspace down the page or requires scrolling to reach it. */}
      <div className="flex flex-wrap items-center gap-2">
        {!isPlaying ? (
          <Button
            onClick={handleStartClick}
            size="sm"
            // Per Enda's report: a just-finished single-waypoint "Test this subsegment"
            // run (a LIVE, possibly-still-unsaved preview) can't be redone from this
            // button — see startSim's own comment for why. Disabled with a clear pointer
            // to the button that actually repeats it, rather than left clickable and
            // silently doing nothing.
            disabled={tourComplete && !!lastJumpRef.current?.hasOverride}
            title={tourComplete && lastJumpRef.current?.hasOverride ? 'To repeat this subsegment test, use "Test this subsegment" in the panel on the right — it rebuilds the preview from the sliders\' current settings.' : undefined}
            className="bg-green-600 hover:bg-green-700 text-white gap-2"
          >
            <Play className="w-4 h-4" /> {tourComplete ? 'Replay' : hasPlayed ? 'Resume' : 'Start'}
          </Button>
        ) : (
          <Button onClick={pauseSim} size="sm" className="bg-amber-500 hover:bg-amber-600 text-white gap-2">
            <Pause className="w-4 h-4" /> Pause
          </Button>
        )}
        <Button onClick={handleResetClick} size="sm" variant="outline" className="border-slate-500 text-slate-300 gap-2">
          <Square className="w-4 h-4" /> Reset
        </Button>
        <span className="flex items-center gap-1.5 text-slate-200 text-sm bg-slate-800/60 rounded-lg border border-slate-600 px-2.5 h-8" title={form.tour_category === 'WBT' ? 'Fixed walking speed' : 'Set by an Admin — never editable here'}>
          <Flag className="w-3.5 h-3.5 text-blue-400" /> {speed} km/h
          {currentSegment && (
            <span className="text-slate-500 text-xs">— {currentSegment.wp.segment_id || currentSegment.wp.segment_title || `Segment ${currentSegment.index + 1}`}</span>
          )}
        </span>
        {locationTargets.length > 0 && (
          <div className="flex items-center gap-1.5">
            <select
              value={jumpTargetIndex}
              onChange={(e) => setJumpTargetIndex(e.target.value === '' ? '' : Number(e.target.value))}
              className="bg-slate-700 border border-slate-500 text-white text-sm rounded px-2 h-8 min-w-0"
            >
              <option value="">Jump to location…</option>
              {locationTargets.map(t => (
                <option key={t.index} value={t.index}>{t.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => jumpToLocation(jumpTargetIndex)}
              disabled={jumpTargetIndex === ''}
              className="bg-blue-600 hover:bg-blue-500 text-white shrink-0"
            >
              Jump
            </Button>
          </div>
        )}
        {locationTargets.length === 0 && incompleteLocations.length > 0 && (
          <span
            className="flex items-center gap-1.5 text-amber-400 text-xs bg-slate-800/60 rounded-lg border border-slate-600 px-2.5 h-8"
            title={incompleteLocations
              .map(t => `${t.label}: ${t.notDoneCount} of ${t.total} waypoint${t.total === 1 ? '' : 's'} not yet marked Done`)
              .join('\n')}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            No location ready to jump to yet — {incompleteLocations[0].label} needs {incompleteLocations[0].notDoneCount} more waypoint{incompleteLocations[0].notDoneCount === 1 ? '' : 's'} marked Done
            {incompleteLocations.length > 1 && ` (+${incompleteLocations.length - 1} more, hover for details)`}
          </span>
        )}
        {tourComplete && (
          <span className="flex items-center gap-1.5 text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4" /> Complete
          </span>
        )}
        {/* Per Enda's follow-up 39 report: this "Narration & Simulate" tab had no way to
            save at all — every script/audio edit made here only ever lived in this
            browser tab's memory until you switched to a different tab that happened to
            have its own Save Route button. Editing an entire location's worth of
            waypoints from this screen and never once landing on a save opportunity is
            exactly how a morning's work can vanish. Now this tab can save itself,
            directly, without navigating anywhere else. Only rendered when a parent
            actually wires up onSave (the top-level Narration & Simulate tab does; the
            scoped "Test Location in Simulator" dialog does too now). */}
        {onSave && (
          <Button
            onClick={onSave}
            disabled={saving}
            size="sm"
            className="ml-auto bg-amber-500 hover:bg-amber-600 text-white gap-2"
            title="Save this tour to the server now. Nothing edited on this screen is safely saved until you do this."
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Route
          </Button>
        )}
        {audioTriggerCount > 0 && (
          <span
            className="flex items-center gap-1 text-xs text-purple-300 bg-purple-900/40 px-2 py-1 rounded-full"
            title={`${audioTriggerCount} waypoint${audioTriggerCount !== 1 ? 's' : ''} across the WHOLE tour (every location, not just the one currently open) ${audioTriggerCount !== 1 ? 'have' : 'has'} audio trigger switched on — i.e. will actually play narration when a real customer drives past.`}
          >
            <Radio className="w-3 h-3" /> {audioTriggerCount} audio trigger{audioTriggerCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Previously a failed audio.play() (autoplay blocked, missing file, expired
          link, etc.) failed completely silently — the marker would move with no audio
          and nothing on screen said why. This banner is that missing feedback: it
          stays up from the moment a play() call actually fails until the next
          successful play, jump, or reset. */}
      {audioError && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {audioError}
        </div>
      )}

      {/* Per Enda: the map sits on the left and the waypoint audio / break-tag editor
          sits directly beside it on the right, at the SAME scroll position — not just
          somewhere else on a wider page — so a break tag can be adjusted and
          re-tested against the moving marker without any scrolling back and forth.
          This only forms a side-by-side pair on a PC/laptop-width screen; on a
          narrower window the two simply stack, which never applies to a real customer
          and is not something admins/narrators use anyway. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Map */}
        <div className="h-80 lg:h-[520px] rounded-xl overflow-hidden border border-slate-600">
          <TourSimulatorMap
            trailPath={trailPath}
            waypoints={waypoints}
            triggered={triggered}
            currentPos={currentPos}
            currentBearing={currentBearing}
            isWalkingTour={isWalkingTour}
            onWaypointUpdate={onWaypointUpdate ? (i, field, value) => onWaypointUpdate(toRawIndex(i), field, value) : undefined}
            breaks={form.trail_breaks}
            focusBounds={mapFocusBounds}
            dimWaypointIndex={dimWaypointIndex}
            // Same gating as the bounds effect above: only during ordinary browsing
            // (not playing, not mid pace-test) does the map hide everything outside the
            // open waypoint's own location. `waypoints`/`triggered`/onWaypointUpdate's
            // index `i` all stay full-array indices either way — this only controls
            // which of them get drawn, never which array is passed.
            focusRange={!isPlaying && !speedMatchMode ? currentLocationRange : null}
            isNarrator={isNarrator}
          />
        </div>

        {/* Waypoint Audio & Break Tags — the same script/audio editor used elsewhere on
            a waypoint, opened right here beside the map. Whatever is generated here is
            saved straight onto that waypoint's own audio file (audio_clip_url) — the
            exact file both this simulator and the real, live tour play — so a break
            tag can be lengthened, shortened, removed, or added, and the result
            re-tested against the moving marker immediately, with no limit on how many
            rounds of editing it takes to match the driving time. */}
        <div className="lg:h-[520px] lg:overflow-y-auto lg:pr-1">
          {waypoints.length > 0 && onWaypointUpdate ? (
            <div className="bg-slate-800/60 rounded-lg border border-blue-700/40 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-blue-400" />
                <Label className="text-slate-300 text-sm font-medium">Waypoint Audio &amp; Break Tags</Label>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(selectedWpIndex)}
                  onValueChange={(v) => setSelectedWpIndex(Number(v))}
                >
                  <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-9">
                    <SelectValue placeholder="Select a waypoint…" />
                  </SelectTrigger>
                  <SelectContent>
                    {waypoints.map((wp, i) => {
                      const isPrimary = wp.waypoint_role === 'primary_start' || wp.waypoint_role === 'primary_stop';
                      const isDone = !!wp.waypoint_done;
                      const isLocked = lockedWpIndexes[i];
                      return (
                        <SelectItem
                          key={i}
                          value={String(i)}
                          disabled={isLocked}
                          // Per Enda's follow-up: a primary waypoint (Start/Stop) stays
                          // green ALWAYS, done or not — that's what lets an editor spot a
                          // finished location at a glance by its own start point (e.g.
                          // "BOR2a-PS"), without having to hunt through every point after it
                          // to confirm the location's actually done. Losing the green the
                          // moment it's marked done defeated that — early in the tour
                          // (BOR1a) it's still obvious from position, but by BOR13 or later
                          // it isn't, and that ambiguity is exactly the confusion this is
                          // for. Italic still layers on top of the green once done, same as
                          // every other waypoint, as the "already finished" signal — only the
                          // colour itself is pinned for primaries. A non-primary point still
                          // switches to plain grey italic once done, same as before.
                          className={
                            isPrimary
                              ? `text-green-400 font-medium${isDone ? ' italic' : ''}`
                              : isDone ? 'text-slate-500 italic' : undefined
                          }
                          title={isLocked ? 'Locked — finish every earlier waypoint first' : undefined}
                        >
                          {/* Per Enda's follow-up 52 report: follow-up 50 disabled a
                              primary_start entry here entirely, reasoning that its speech
                              doesn't need testing against a driving speed since it plays
                              while parked. True as far as it goes, but wrong conclusion —
                              its audio is exactly as essential as any other waypoint's
                              (it's the first thing a customer ever hears), and this panel
                              is the actual working screen for writing/recording/finalizing
                              that audio. Disabling selection here made it unreachable from
                              the screen editors actually live in, for no real reason — the
                              only thing that's genuinely inapplicable to a static point is
                              the driving-speed test, handled below by disabling just "Test
                              this waypoint" for one, not by blocking the whole editor.
                              Per Enda: segment_id alone (e.g. "BOR1") is shared by every
                              point in a whole location, so a list of secondary points all
                              showed the exact same label. wp.name carries each point's own
                              proper code (e.g. "BOR1b"), plus its own name/title where one
                              was given — that's what actually tells one point apart from
                              another.
                              Per Enda's later request: this list is now also gated
                              sequentially — a locked entry (isLocked) shows a lock icon and
                              can't be opened until every waypoint before it is done; the
                              disabled prop above is what actually blocks the click/keyboard
                              selection, this icon+title just explain why. */}
                          {isLocked && <Lock className="inline-block w-3 h-3 mr-1 -mt-0.5 text-slate-500" />}
                          {wp.name || wp.segment_id || `Waypoint ${i + 1}`}
                          {' — '}{ROLE_LABEL[wp.waypoint_role] || 'Point'}
                          {wp.audio_clip_url ? ' 🔊' : ''}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {doneLocked && (
                <div className="flex items-center justify-between gap-2 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2">
                  <span className="text-amber-300 text-xs flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    Locked — this waypoint is marked Done.{' '}
                    {isNarrator
                      // Per Enda: a Narrator must never be able to unlock a Done
                      // waypoint themselves — only an Admin has that authority, the
                      // same way "Mark Waypoint as Done" itself is an Admin-only
                      // control in the Waypoints tab. A Narrator who wants back in
                      // has to ask an Admin to unlock it there; this tab only ever
                      // tells them the lock exists, never offers a way past it.
                      ? 'Wording, pause timing, and audio below can\'t be changed. Ask an Admin to unlock this waypoint if it needs more work.'
                      : 'Wording, pause timing, and audio below can\'t be changed until you unlock it.'}
                  </span>
                  {!isNarrator && (
                    <Button
                      type="button" size="sm" variant="outline"
                      onClick={() => {
                        onWaypointUpdate(toRawIndex(selectedWpIndex), 'waypoint_done', false);
                        onAutoSave?.();
                      }}
                      className="bg-blue-700/30 hover:bg-blue-700/50 border-blue-600/50 text-amber-400 hover:text-amber-300 shrink-0"
                    >
                      Unlock to edit
                    </Button>
                  )}
                </div>
              )}

              {/* Per Enda's follow-up 61 live-testing report: this panel must NOT default
                  to the purpose-built speed-matching tool (WaypointPaceEditor) — that's a
                  SECOND-session tool, only relevant once a narrator has actually jumped
                  into a location to test/tune its driving-speed timing (see
                  speedMatchMode above). Every other time — which is every time this tab
                  is first opened — this must be exactly the same full wording/TTS editor
                  (NarrationTtsEditor) it always was, with no eager TTS calls at all
                  (unlike WaypointPaceEditor, it only ever calls out on an explicit button
                  click), so opening this tab is instant again. The waypoint dropdown
                  above is shared by both modes, so the narrator always knows which
                  waypoint they're looking at either way. */}
              {selectedWp && (speedMatchMode ? (
                <WaypointPaceEditor
                  key={selectedWpIndex}
                  waypoint={selectedWp}
                  fixedLanguage={targetLanguage}
                  onSave={(updates) => onWaypointUpdate(toRawIndex(selectedWpIndex), updates)}
                  onAutoSave={onAutoSave}
                  onTestSubsegment={(previewUrl) => jumpToWaypoint(selectedWpIndex, { autoplay: true, scopeToThisWaypoint: true, audioOverrideUrl: previewUrl })}
                  testDisabled={selectedWp.waypoint_role === 'primary_start'}
                  testDisabledReason="Not applicable here — this point is heard while parked, before any driving starts, so there's no driving speed to test its speech against. Its pause timing above can still be tuned normally."
                  doneLocked={doneLocked}
                />
              ) : (
                <NarrationTtsEditor
                  key={selectedWpIndex}
                  script={selectedWp.narration_script || ''}
                  audioUrl={selectedWp.audio_clip_url || ''}
                  doneLocked={doneLocked}
                  onScriptChange={(val) => onWaypointUpdate(toRawIndex(selectedWpIndex), 'narration_script', val)}
                  onAudioChange={(val) => {
                    // Same atomic-update reasoning as follow-up 53 — see that entry in
                    // CLAUDE_CHANGELOG.md. Marks the waypoint done the moment Finalize
                    // Narration Audio actually succeeds (a real url comes back), same as
                    // this always did before follow-up 58 replaced this embed.
                    onWaypointUpdate(toRawIndex(selectedWpIndex), val
                      ? { audio_clip_url: val, trigger_audio: true, waypoint_done: true }
                      : { audio_clip_url: val });
                    // Per Enda (follow-up 73, from Anoushka's walkthrough): after a
                    // real Finalize Narration Audio success, this panel used to just
                    // sit on the now-finished waypoint — nothing stopped a narrator
                    // from staying right there and importing a different file into
                    // Translate Script, overwriting what was just finalized. `val` is
                    // only truthy here on an actual finalize success (the one call
                    // site is finalizeAndSave in NarrationTtsEditor.jsx, only reached
                    // via its "Finalize Narration Audio" button) — never on a plain
                    // audio-clear. Advancing to the next waypoint in this same
                    // (already-filtered, already lat/lng-valid) `waypoints` list is
                    // always safe to do unconditionally the moment that happens: the
                    // sequential lock (lockedWpIndexes above) only locks a waypoint
                    // while any EARLIER one isn't done yet, and every waypoint up to
                    // and including this one is now done, so the next index is
                    // guaranteed unlocked as soon as this state update lands. The
                    // NarrationTtsEditor/WaypointPaceEditor below is keyed on
                    // selectedWpIndex, so moving to a new index remounts it fresh —
                    // no imported text, script, or audio state carries over from the
                    // waypoint that was just finished. Stays put if this was the last
                    // waypoint in the list — nothing further to advance to.
                    if (val && selectedWpIndex + 1 < waypoints.length) {
                      setSelectedWpIndex(selectedWpIndex + 1);
                    }
                  }}
                  onAutoSave={onAutoSave}
                  fixedLanguage={targetLanguage}
                  waypointSegmentId={selectedWp.segment_id}
                  waypointSegmentTitle={selectedWp.segment_title}
                />
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm border border-dashed border-slate-600 rounded-lg p-4">
              No waypoints to edit yet.
            </div>
          )}
        </div>
      </div>

      {/* Per Enda: everything below here is reference-only — not needed for the
          actual edit/test/re-test loop — so it's collapsed by default and never
          pushes the map/editor pairing above down the page. */}
      <div>
        <button
          type="button"
          onClick={() => setShowDetails(s => !s)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Simulation details (stats, timing estimate, trigger log)
        </button>

        {showDetails && (
          <div className="space-y-4 mt-3">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-800 rounded-lg p-2.5 text-center">
                <Gauge className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                <div className="text-white text-sm font-semibold">{speed} km/h</div>
                <div className="text-slate-500 text-xs">{form.tour_category === 'WBT' ? 'Fixed' : 'Set by Admin'}</div>
              </div>
              <div
                className="bg-slate-800 rounded-lg p-2.5 text-center"
                title="How much time has passed in THIS simulation run since you last pressed Start/Jump — not a real clock, and not the whole tour's driving-time estimate (see the ~h:mm figure at the bottom right)."
              >
                <Clock className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                <div className="text-white text-sm font-semibold">{fmtTime(simTime)}</div>
                <div className="text-slate-500 text-xs">Sim Time</div>
              </div>
              <div
                className="bg-slate-800 rounded-lg p-2.5 text-center"
                title="How far the car has driven in THIS run, out of the WHOLE tour's total trail length — always the full tour distance here, regardless of which location's waypoint is open on the right."
              >
                <MapPin className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                <div className="text-white text-sm font-semibold">{fmtDist(distTraveled)}</div>
                <div className="text-slate-500 text-xs">of {fmtDist(pathData.total)}</div>
              </div>
              <div
                className="bg-slate-800 rounded-lg p-2.5 text-center"
                title="How many of this run's audio triggers have actually fired so far, out of every waypoint in the WHOLE tour with audio trigger switched on (same total as the purple badge above) — not just the current location's."
              >
                <Volume2 className="w-4 h-4 text-green-400 mx-auto mb-1" />
                <div className="text-white text-sm font-semibold">
                  {Object.keys(triggered).length}/{audioTriggerCount}
                </div>
                <div className="text-slate-500 text-xs">Triggered</div>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {/* Per Enda's later request: there is no longer any speed multiplier to
                  report alongside this — the simulator always runs at real, 1× time now
                  (see the simMult comment above its declaration), specifically so this
                  number is a true measurement of whether a waypoint's audio actually
                  finishes near when the car reaches the next one, not an estimate scaled
                  up from a sped-up test run. The old "Simulation Speed" 1/2/5/10× picker
                  that used to sit here is gone along with it — there is no choice to make
                  any more. */}
              <div className="flex justify-end text-xs text-slate-500 mt-1">
                <span>~{fmtTime(realDurationSec * 1000)} real time</span>
              </div>
            </div>

            {/* Trigger log */}
            {triggerLog.length > 0 && (
              <div className="bg-slate-800 rounded-lg border border-slate-600 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Radio className="w-4 h-4 text-purple-400" />
                  <span className="text-slate-300 font-medium text-sm">Trigger Log</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {triggerLog.map((entry, i) => {
                    const isSpeed = entry.type === 'speed';
                    return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${isSpeed ? 'bg-blue-900/30 border border-blue-700/40' : entry.overlap ? 'bg-red-900/30 border border-red-700/40' : 'bg-slate-700/50'}`}
                    >
                      <span className="text-slate-500 font-mono shrink-0">{fmtTime(entry.simTime)}</span>
                      <div className="flex-1 min-w-0">
                        {isSpeed ? (
                          <>
                            <span className="text-blue-300 font-medium flex items-center gap-1">
                              <Flag className="w-3 h-3" /> Speed → {entry.newSpeed} km/h
                            </span>
                            <div className="text-slate-500 mt-0.5">
                              {entry.wp.segment_id || entry.wp.name || `Segment ${entry.index + 1}`}
                              {entry.wp.segment_title && ` — ${entry.wp.segment_title}`}
                              {' · '}{fmtDist(entry.distance)}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-slate-200 font-medium">
                              {entry.wp.name || entry.wp.segment_id || `Waypoint ${entry.index + 1}`}
                            </span>
                            {entry.wp.segment_title && (
                              <span className="text-slate-400"> — {entry.wp.segment_title}</span>
                            )}
                            <div className="text-slate-500 mt-0.5">
                              Triggered at {fmtDist(entry.distance)} · {Math.round(entry.distFromCenter)}m from centre
                              {entry.wp.use_bearing && ' · bearing ✓'}
                            </div>
                          </>
                        )}
                      </div>
                      {!isSpeed && entry.overlap && (
                        <span className="flex items-center gap-1 text-red-400 shrink-0" title="Audio was still playing from previous trigger">
                          <AlertTriangle className="w-3.5 h-3.5" /> Overlap
                        </span>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} />
    </div>
  );
}