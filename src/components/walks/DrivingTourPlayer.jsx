import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, Square, Loader2, Bug, X } from 'lucide-react';
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

  const watchIdRef = useRef(null);
  const prevPosRef = useRef(null);
  const playerRef = useRef(null);
  const triggeredRef = useRef(new Set());
  const statusRef = useRef('idle');

  // Trigger waypoints that have audio enabled
  const triggerWaypoints = (walk.waypoints || []).filter(wp => wp.trigger_audio && wp.lat && wp.lng);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

      const wpKey = wp.segment_id || wp.name || `${wp.lat},${wp.lng}`;
      const alreadyTriggered = triggeredRef.current.has(wpKey);

      let result;
      if (!withinRadius) {
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

      tourLogService.logTriggerCheck(wp, distance, withinRadius, bearingInfo, alreadyTriggered, result);

      if (result === 'fire') {
        playTriggerAudio(wp, wpKey);
      }
    }

    prevPosRef.current = { lat, lng };
  }, [triggerWaypoints]);

  const playTriggerAudio = useCallback((wp, wpKey) => {
    // Stop any currently playing audio
    if (playerRef.current) {
      playerRef.current.stop();
    }

    const player = audioService.createPlayer(wp.audio_clip_url);
    playerRef.current = player;

    player.onEnded(() => {
      tourLogService.logAudioPlay(wp, wp.audio_clip_url);
    });

    player.play().then(() => {
      tourLogService.logAudioPlay(wp, wp.audio_clip_url);
      setLastTriggered(wp.segment_id || wp.name || wpKey);
    }).catch((err) => {
      tourLogService.logAudioSkip(wp, `playback_error: ${err?.message || 'unknown'}`);
    });

    if (wp.trigger_once !== false) {
      triggeredRef.current.add(wpKey);
      setTriggeredWpIds(new Set(triggeredRef.current));
    }
  }, []);

  const handleStart = () => {
    if (!gpsService.isSupported()) {
      tourLogService.logWarning('Geolocation not supported on this device');
      return;
    }

    tourLogService.startSession(walk.id, walk.name);
    triggeredRef.current = new Set();
    setTriggeredWpIds(new Set());
    prevPosRef.current = null;
    setStatus('running');

    watchIdRef.current = gpsService.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setCurrentPos([latitude, longitude]);
        setGpsAccuracy(accuracy);
        if (statusRef.current === 'running') {
          evaluateTriggers(latitude, longitude, accuracy);
        }
      },
      (err) => {
        tourLogService.logWarning(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
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
    tourLogService.stopSession();
    setStatus('idle');
    setCurrentPos(null);
    setGpsAccuracy(null);
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

  const statusMeta = STATUS[status];

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-600 overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          status === 'running' ? 'bg-green-400 animate-pulse' :
          status === 'paused' ? 'bg-amber-400' : 'bg-slate-500'
        }`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${statusMeta.color}`}>
            {statusMeta.label}
          </div>
          {currentPos && (
            <div className="text-xs text-slate-500 font-mono">
              {currentPos[0].toFixed(5)}, {currentPos[1].toFixed(5)}
              {gpsAccuracy && ` (±${Math.round(gpsAccuracy)}m)`}
            </div>
          )}
        </div>
        {lastTriggered && (
          <div className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-full shrink-0">
            ▶ {lastTriggered}
          </div>
        )}
      </div>

      {/* Triggered waypoints progress */}
      {triggerWaypoints.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-1.5">
            {triggerWaypoints.map((wp, i) => {
              const wpKey = wp.segment_id || wp.name || `${wp.lat},${wp.lng}`;
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
              onClick={handleStart}
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