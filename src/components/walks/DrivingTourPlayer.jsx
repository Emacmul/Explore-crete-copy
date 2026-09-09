import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, Square, Bug, AlertTriangle } from 'lucide-react';
import * as gpsService from '@/lib/gpsService';
import * as audioService from '@/lib/audioService';
import * as tourLogService from '@/lib/tourLogService';
import { calculateBearing, isBearingInRange } from '@/lib/routeExport';
import TourDebugLog from './TourDebugLog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useOfflineWalks } from '../offline/useOfflineWalks';

const R_EARTH = 6371000;

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// The same stable per-waypoint key used everywhere below — segment_id when there is one,
// falling back to name or raw coordinates so nothing ever collides or goes untracked.
function wpKeyFor(wp) {
  return wp.segment_id || wp.name || `${wp.lat},${wp.lng}`;
}

// "Last known position" tracking — per Enda: while driving, the app should quietly
// remember the most recent secondary waypoint (a point along the route, not the segment
// start/stop markers) the driver has actually reached, so that if the phone loses signal,
// gets closed by accident, or overheats and switches itself off, reopening the tour still
// shows where they got to and offers to pick back up from there — without ever showing
// the driver a list of every point, just that one. Saved to this device so it survives
// closing the app. If it's more than 18 hours old, treat it as stale (a different day's
// drive) and start fresh, the same rule already used for the walk/hike "you were last
// here" feature.
const LAST_POSITION_STALE_MS = 18 * 60 * 60 * 1000;

function lastPositionStorageKey(walkId) {
  return `explore_crete_driving_last_position__${walkId}`;
}

// Per audit finding U-08 (2026-09-09 code review): a GPS fix's accuracy needs to be at
// least as good as the trigger radius it's being judged against, or the fix can't be
// trusted to resolve at that distance. Crete's mountains are notorious for weak signal —
// a plain distance check can't tell a precise fix from a rough one that just happens to
// land "inside" the radius by chance. GPS_ACCURACY_HARD_CAP_M additionally rejects any
// fix so imprecise it shouldn't be trusted for ANY waypoint, however large that
// waypoint's own radius is. Applied to both audio triggers and "last known position".
const GPS_ACCURACY_HARD_CAP_M = 100;

function fixIsTrustworthy(accuracy, radius) {
  // No accuracy reported at all (not standard, but not every device/browser is
  // guaranteed to supply it) — behave as before rather than silently blocking every
  // trigger on an unrelated device quirk.
  if (accuracy == null || !Number.isFinite(accuracy)) return true;
  return accuracy <= Math.min(radius, GPS_ACCURACY_HARD_CAP_M);
}

// Per audit finding U-07: a single dropped GPS fix (a tunnel, a tall building, a brief
// timeout) is normal in Crete's mountains and driving through them shouldn't alarm the
// driver — but a RUN of consecutive failures means signal is genuinely gone, and that
// needs to be visible, not just logged. A denied location permission never recovers on
// its own, so that one is treated as sustained immediately rather than counted.
const GPS_ERROR_STREAK_THRESHOLD = 2;

function loadPassedSecondaryIds(walkId) {
  if (!walkId) return new Set();
  try {
    const raw = localStorage.getItem(lastPositionStorageKey(walkId));
    if (!raw) return new Set();
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.ids)) return new Set();
    const age = Date.now() - (saved.updatedAt || 0);
    if (age > LAST_POSITION_STALE_MS) {
      localStorage.removeItem(lastPositionStorageKey(walkId));
      return new Set();
    }
    return new Set(saved.ids);
  } catch {
    return new Set();
  }
}

export default function DrivingTourPlayer({ walk }) {
  const { t } = useLanguage();
  const { isDownloaded } = useOfflineWalks();
  const savedOffline = isDownloaded(walk.id);
  const STATUS = {
    idle: { label: t('player.ready'), color: 'text-slate-400' },
    running: { label: t('player.active'), color: 'text-green-400' },
    paused: { label: t('player.paused'), color: 'text-amber-400' },
  };
  const [status, setStatus] = useState('idle');
  const [currentPos, setCurrentPos] = useState(null);
  const [triggeredWpIds, setTriggeredWpIds] = useState(new Set());
  const [lastTriggered, setLastTriggered] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  // Non-null while GPS has sustained-failed (see GPS_ERROR_STREAK_THRESHOLD above) —
  // { code, message }. Drives the visible red warning; cleared the moment any fix,
  // even a low-accuracy one, comes back in.
  const [gpsIssue, setGpsIssue] = useState(null);
  const gpsErrorStreakRef = useRef(0);
  // Every secondary waypoint the driver has actually reached so far this drive (see the
  // "last known position" comment above) — restored from this device's storage on open,
  // so it survives the app being closed and reopened.
  const [passedSecondaryIds, setPassedSecondaryIds] = useState(() => loadPassedSecondaryIds(walk.id));

  const watchIdRef = useRef(null);
  const prevPosRef = useRef(null);
  const playerRef = useRef(null);
  const triggeredRef = useRef(new Set());
  const statusRef = useRef('idle');
  const passedSecondaryRef = useRef(passedSecondaryIds);
  // Per Enda's follow-up 36 report: two waypoints can legitimately share the EXACT same
  // GPS coordinates — e.g. BOR1a-PS (the stationary "get ready" intro, speed 0 km/h)
  // and BOR1b (the first moving segment, speed 50 km/h), both placed at the same real-
  // world spot on purpose. Their trigger circles are then 100% identical, so a single
  // GPS fix can satisfy BOTH at once. audioQueueRef holds every {wp, wpKey} waiting its
  // turn; currentlyPlayingWpRef is the waypoint whose clip is the one actually loaded/
  // playing right now (null when nothing is). See playTriggerAudio/playNextQueuedAudio
  // below — this queues an overlapping trigger instead of interrupting whatever's
  // already playing, the same approach TourSimulator.jsx already uses for its own test
  // playback (its audioQueueRef/handleAudioEndedRef), just not one this real, live
  // player had until now.
  const audioQueueRef = useRef([]);
  const currentlyPlayingWpRef = useRef(null);

  // Trigger waypoints that have audio enabled
  const triggerWaypoints = (walk.waypoints || []).filter(wp => wp.trigger_audio && wp.lat && wp.lng);
  // Every secondary waypoint on the route (not the segment start/stop markers) with a real
  // GPS position — the candidates for "last known position", tracked regardless of whether
  // that particular point has audio of its own.
  const secondaryWaypoints = (walk.waypoints || []).filter(wp => wp.waypoint_role === 'secondary' && wp.lat && wp.lng);
  // The furthest-along secondary waypoint reached so far — same "keep the last one in route
  // order" approach as the walk/hike version of this feature.
  const lastKnownWaypoint = secondaryWaypoints.reduce((last, wp) => (
    passedSecondaryIds.has(wpKeyFor(wp)) ? wp : last
  ), null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    passedSecondaryRef.current = passedSecondaryIds;
  }, [passedSecondaryIds]);

  const persistPassedSecondary = useCallback((nextSet) => {
    if (!walk.id) return;
    try {
      localStorage.setItem(
        lastPositionStorageKey(walk.id),
        JSON.stringify({ ids: Array.from(nextSet), updatedAt: Date.now() })
      );
    } catch {
      // Storage full or unavailable — not fatal, "last known position" just won't survive
      // closing the app this time; live tracking during this session still works fine.
    }
  }, [walk.id]);

  const evaluateTriggers = useCallback((lat, lng, accuracy) => {
    tourLogService.logGpsFix(lat, lng, accuracy);

    const prevPos = prevPosRef.current;
    const movementBearing = prevPos
      ? calculateBearing(prevPos.lat, prevPos.lng, lat, lng)
      : null;

    for (const wp of triggerWaypoints) {
      const distance = haversine(lat, lng, wp.lat, wp.lng);
      const radius = wp.trigger_radius_m || 150;
      const withinRadius = distance <= radius;
      const accuracyOk = fixIsTrustworthy(accuracy, radius);

      let bearingOk = true;
      const bearingInfo = (wp.use_bearing && movementBearing !== null) ? {
        movement: movementBearing,
        target: wp.bearing_direction || 0,
        tolerance: wp.bearing_tolerance || 30,
        ok: false,
      } : null;

      if (bearingInfo) {
        bearingOk = isBearingInRange(bearingInfo.movement, bearingInfo.target, bearingInfo.tolerance);
        bearingInfo.ok = bearingOk;
      }

      const wpKey = wpKeyFor(wp);
      const alreadyTriggered = triggeredRef.current.has(wpKey);

      // Accuracy is checked FIRST and on its own — a low-confidence fix that happens to
      // compute "within radius" by chance is exactly the false trigger this guards
      // against (see GPS_ACCURACY_HARD_CAP_M/fixIsTrustworthy above), so it must never
      // be allowed to reach the distance check at all.
      let result;
      if (!accuracyOk) {
        result = 'skip_low_accuracy';
      } else if (!withinRadius) {
        result = 'skip_distance';
      } else if (alreadyTriggered && wp.trigger_once !== false) {
        result = 'skip_already_triggered';
      } else if (wp.use_bearing && !bearingOk) {
        result = 'skip_bearing';
      } else if (!wp.audio_clip_url) {
        result = 'skip_no_audio';
      } else {
        result = 'fire';
      }

      tourLogService.logTriggerCheck(wp, distance, withinRadius, bearingInfo, alreadyTriggered, result, accuracy);

      if (result === 'fire') {
        playTriggerAudio(wp, wpKey);
      }
    }

    // "Last known position" — separate from the audio triggers above, and never undone
    // once set, the same "only ever adds" rule the walk/hike version of this feature uses.
    // Runs for every secondary waypoint regardless of whether it has audio configured.
    let passedChanged = false;
    let nextPassed = passedSecondaryRef.current;
    for (const wp of secondaryWaypoints) {
      const key = wpKeyFor(wp);
      if (nextPassed.has(key)) continue;
      const radius = wp.trigger_radius_m || 150;
      // Same accuracy guard as the audio triggers above — an imprecise fix must not be
      // allowed to mark a waypoint "passed" either (see U-08).
      if (!fixIsTrustworthy(accuracy, radius)) continue;
      const distance = haversine(lat, lng, wp.lat, wp.lng);
      if (distance <= radius) {
        if (!passedChanged) nextPassed = new Set(nextPassed);
        nextPassed.add(key);
        passedChanged = true;
      }
    }
    if (passedChanged) {
      passedSecondaryRef.current = nextPassed;
      setPassedSecondaryIds(nextPassed);
      persistPassedSecondary(nextPassed);
    }

    prevPosRef.current = { lat, lng };
  }, [triggerWaypoints, secondaryWaypoints, persistPassedSecondary]);

  // Actually starts (or advances to) the next queued clip — called once at the top of
  // playTriggerAudio when nothing else is playing, and again from onEnded/a failed
  // play() below so the queue keeps draining on its own without playTriggerAudio ever
  // having to be re-invoked.
  const playNextQueuedAudio = useCallback(() => {
    const next = audioQueueRef.current.shift();
    if (!next) {
      currentlyPlayingWpRef.current = null;
      return;
    }
    const { wp, wpKey } = next;
    currentlyPlayingWpRef.current = wp;

    const player = audioService.createPlayer(wp.audio_clip_url);
    playerRef.current = player;

    player.onEnded(() => {
      tourLogService.logAudioPlay(wp, wp.audio_clip_url);
      playNextQueuedAudio();
    });

    player.play().then(() => {
      tourLogService.logAudioPlay(wp, wp.audio_clip_url);
      setLastTriggered(wp.segment_id || wp.name || wpKey);
    }).catch((err) => {
      tourLogService.logAudioSkip(wp, `playback_error: ${err?.message || 'unknown'}`);
      // A clip that fails to load/play must not jam every trigger queued behind it —
      // move straight on to whatever's next, exactly as if this one had played and
      // ended normally.
      playNextQueuedAudio();
    });
  }, []);

  const playTriggerAudio = useCallback((wp, wpKey) => {
    // Per the comment on audioQueueRef/currentlyPlayingWpRef above: queue this behind
    // whatever's currently playing rather than stopping it — this is what lets BOR1a's
    // full introduction actually be heard even though BOR1b sits at the identical spot
    // and becomes eligible to fire at essentially the same moment.
    if (currentlyPlayingWpRef.current) {
      tourLogService.logAudioQueued(wp, currentlyPlayingWpRef.current);
    }
    audioQueueRef.current.push({ wp, wpKey });
    if (!currentlyPlayingWpRef.current) {
      playNextQueuedAudio();
    }

    if (wp.trigger_once !== false) {
      triggeredRef.current.add(wpKey);
      setTriggeredWpIds(new Set(triggeredRef.current));
    }
  }, [playNextQueuedAudio]);

  // seedKeys (optional): waypoint keys to mark as "already triggered" before GPS tracking
  // begins. Used by "Restart tour from here" below so picking up mid-route doesn't replay
  // every earlier segment's audio again — a normal Start Tour click passes nothing, so it
  // begins from a genuinely clean slate exactly as before.
  const handleStart = (seedKeys) => {
    if (!gpsService.isSupported()) {
      tourLogService.logWarning('Geolocation not supported on this device');
      return;
    }

    tourLogService.startSession(walk.id, walk.name);
    triggeredRef.current = new Set(seedKeys || []);
    setTriggeredWpIds(new Set(triggeredRef.current));
    prevPosRef.current = null;
    audioQueueRef.current = [];
    currentlyPlayingWpRef.current = null;
    gpsErrorStreakRef.current = 0;
    setGpsIssue(null);
    setStatus('running');

    watchIdRef.current = gpsService.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        // Any fix at all — even a low-accuracy one that evaluateTriggers below will
        // still reject per-waypoint — means GPS itself is working again, so the
        // sustained-failure warning clears here regardless of that fix's quality.
        gpsErrorStreakRef.current = 0;
        setGpsIssue(null);
        setCurrentPos([latitude, longitude]);
        setGpsAccuracy(accuracy);
        if (statusRef.current === 'running') {
          evaluateTriggers(latitude, longitude, accuracy);
        }
      },
      (err) => {
        tourLogService.logWarning(`GPS error: ${err.message}`);
        // Per audit finding U-07: a permission denial never recovers on its own, so it's
        // treated as sustained immediately. Anything else (timeout, position
        // unavailable) only becomes a visible warning after GPS_ERROR_STREAK_THRESHOLD
        // consecutive failures, so a single brief blip (a tunnel, a tall building)
        // doesn't needlessly alarm the driver.
        const isPermissionDenied = err.code === 1;
        gpsErrorStreakRef.current += 1;
        if (isPermissionDenied || gpsErrorStreakRef.current >= GPS_ERROR_STREAK_THRESHOLD) {
          setGpsIssue({
            code: err.code,
            message: isPermissionDenied ? t('player.gpsPermissionDenied') : t('player.gpsUnavailable'),
          });
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  };

  // "Restart tour from here" — seeds every waypoint up to and including the last known
  // position as already-triggered, then starts GPS tracking exactly as Start Tour does.
  // The tour doesn't jump anywhere on the map; it simply won't replay audio for the parts
  // of the route already driven, and will pick back up naturally as the driver continues —
  // the next un-triggered waypoint they physically reach plays as normal.
  const handleRestartFromLastKnown = () => {
    if (!lastKnownWaypoint) return;
    const allWaypoints = walk.waypoints || [];
    const lastKey = wpKeyFor(lastKnownWaypoint);
    const idx = allWaypoints.findIndex(wp => wpKeyFor(wp) === lastKey);
    const seedKeys = idx >= 0 ? allWaypoints.slice(0, idx + 1).map(wpKeyFor) : [];
    handleStart(seedKeys);
  };

  const handlePause = () => {
    setStatus('paused');
  };

  const handleResume = () => {
    setStatus('running');
  };

  const handleStop = () => {
    if (watchIdRef.current !== null) {
      gpsService.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current.destroy();
      playerRef.current = null;
    }
    audioQueueRef.current = [];
    currentlyPlayingWpRef.current = null;
    tourLogService.stopSession();
    setStatus('idle');
    setCurrentPos(null);
    setGpsAccuracy(null);
    setGpsIssue(null);
    gpsErrorStreakRef.current = 0;
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        gpsService.clearWatch(watchIdRef.current);
      }
      if (playerRef.current) {
        playerRef.current.destroy();
      }
    };
  }, []);

  // While a sustained GPS failure is active during a running tour, the status bar must
  // never keep showing a reassuring green "running" — see audit finding U-07.
  const gpsIssueActive = !!gpsIssue && status === 'running';
  const statusMeta = gpsIssueActive
    ? { label: t('player.gpsIssueTitle'), color: 'text-red-400' }
    : STATUS[status];
  const accuracyIsWeak = gpsAccuracy != null && gpsAccuracy > GPS_ACCURACY_HARD_CAP_M;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-600 overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          gpsIssueActive ? 'bg-red-500 animate-pulse' :
          status === 'running' ? 'bg-green-400 animate-pulse' :
          status === 'paused' ? 'bg-amber-400' : 'bg-slate-500'
        }`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${statusMeta.color}`}>
            {statusMeta.label}
          </div>
          {currentPos && (
            <div className={`text-xs font-mono ${accuracyIsWeak ? 'text-amber-400' : 'text-slate-500'}`}>
              {currentPos[0].toFixed(5)}, {currentPos[1].toFixed(5)}
              {gpsAccuracy != null && ` (±${Math.round(gpsAccuracy)}m)`}
              {accuracyIsWeak && ` — ${t('player.gpsWeakSignal')}`}
            </div>
          )}
        </div>
        {lastTriggered && (
          <div className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-full shrink-0">
            ▶ {lastTriggered}
          </div>
        )}
      </div>

      {/* GPS sustained-failure warning — per audit finding U-07, this must be genuinely
          hard to miss, not a small status-bar colour change alone. Stays up until a fresh
          fix (of any accuracy — see the success callback in handleStart) comes back in. */}
      {gpsIssueActive && (
        <div className="mx-4 mb-3 flex items-start gap-2 bg-red-900/30 border border-red-600 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300">{t('player.gpsIssueTitle')}</p>
            <p className="text-xs text-red-300/90 mt-0.5">{gpsIssue.message}</p>
          </div>
        </div>
      )}

      {/* Last known position — shows the single most recent point along the route the
          driver has actually reached (never the full list of points), and while the tour
          isn't currently running, offers to pick back up from there instead of the very
          start. Covers losing GPS signal, the app being closed by accident, the phone
          overheating and switching off, etc. — whatever the reason it stopped, this is
          still here when they come back. */}
      {lastKnownWaypoint && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 bg-blue-900/20 border border-blue-700/40 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs text-blue-300">{t('player.lastKnownPosition')}</p>
            <p className="text-sm font-medium text-blue-100 truncate">
              {lastKnownWaypoint.segment_title || lastKnownWaypoint.name}
            </p>
          </div>
          {status === 'idle' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRestartFromLastKnown}
              disabled={!savedOffline}
              title={!savedOffline ? t('player.mustSaveFirst') : undefined}
              className="shrink-0 border-blue-500 text-blue-300 hover:bg-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('player.restartFromHere')}
            </Button>
          )}
        </div>
      )}

      {/* Triggered waypoints progress */}
      {triggerWaypoints.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-1.5">
            {triggerWaypoints.map((wp, i) => {
              const wpKey = wpKeyFor(wp);
              const isTriggered = triggeredWpIds.has(wpKey);
              return (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    isTriggered ? 'bg-green-500' : 'bg-slate-600'
                  }`}
                />
              );
            })}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {t('player.triggersFired', { done: triggeredWpIds.size, total: triggerWaypoints.length })}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="px-4 pb-3 space-y-2">
        {status === 'idle' && !savedOffline && (
          <p className="text-xs text-amber-400 text-center">
            {t('player.mustSaveFirst')}
          </p>
        )}
        <div className="flex items-center gap-2">
          {status === 'idle' && (
            <Button
              onClick={() => handleStart()}
              disabled={!savedOffline}
              title={!savedOffline ? t('player.mustSaveFirst') : undefined}
              className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" /> {t('player.startTour')}
            </Button>
          )}
        {status === 'running' && (
          <>
            <Button
              onClick={handlePause}
              variant="outline"
              className="flex-1 gap-2 border-amber-500 text-amber-400 hover:bg-amber-900/20"
            >
              <Pause className="w-4 h-4" /> {t('player.pause')}
            </Button>
            <Button
              onClick={handleStop}
              variant="outline"
              className="flex-1 gap-2 border-red-500 text-red-400 hover:bg-red-900/20"
            >
              <Square className="w-4 h-4" /> {t('player.stop')}
            </Button>
          </>
        )}
        {status === 'paused' && (
          <>
            <Button
              onClick={handleResume}
              className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white"
            >
              <Play className="w-4 h-4" /> {t('player.resume')}
            </Button>
            <Button
              onClick={handleStop}
              variant="outline"
              className="flex-1 gap-2 border-red-500 text-red-400 hover:bg-red-900/20"
            >
              <Square className="w-4 h-4" /> {t('player.stop')}
            </Button>
          </>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowDebug(!showDebug)}
          className={`shrink-0 ${showDebug ? 'text-purple-400 bg-purple-900/20' : 'text-slate-400'}`}
          title={t('player.toggleLog')}
        >
          <Bug className="w-4 h-4" />
        </Button>
        </div>
      </div>

      {/* Debug log */}
      {showDebug && (
        <div className="px-4 pb-3">
          <TourDebugLog />
        </div>
      )}
    </div>
  );
}