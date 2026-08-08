import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  X, Clock, Route, TrendingUp, MapPin, AlertTriangle,
  Eye, Droplets, TreePine, Navigation, Crosshair, ShieldAlert,
  CheckCircle2, Circle, RotateCcw, Mountain
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import WalkDetailMap from '../map/WalkDetailMap';
import DownloadWalkButton from '../offline/DownloadWalkButton';
import DownloadButton from './DownloadButton';
import WalkProgressBar from './WalkProgressBar';
import DrivingModeNotice from './DrivingModeNotice';
import DrivingTourPlayer from './DrivingTourPlayer';
import { getWaypointImages } from '@/lib/waypointImages';

const difficultyColors = {
  easy: 'bg-green-100 text-green-700',
  moderate: 'bg-amber-100 text-amber-700',
  challenging: 'bg-orange-100 text-orange-700',
  difficult: 'bg-red-100 text-red-700',
};

const waypointIcons = {
  start: { icon: Navigation, color: 'text-green-600', bg: 'bg-green-100' },
  end: { icon: MapPin, color: 'text-red-600', bg: 'bg-red-100' },
  turnoff: { icon: Navigation, color: 'text-amber-600', bg: 'bg-amber-100' },
  danger: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100' },
  viewpoint: { icon: Eye, color: 'text-purple-600', bg: 'bg-purple-100' },
  water: { icon: Droplets, color: 'text-blue-600', bg: 'bg-blue-100' },
  rest_area: { icon: TreePine, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  landmark: { icon: MapPin, color: 'text-indigo-600', bg: 'bg-indigo-100' },
  kafeneon: { icon: TreePine, color: 'text-amber-600', bg: 'bg-amber-100' },
  wildlife_spot: { icon: Eye, color: 'text-green-600', bg: 'bg-green-100' },
  church: { icon: MapPin, color: 'text-yellow-600', bg: 'bg-yellow-100' },
  ruins: { icon: MapPin, color: 'text-orange-600', bg: 'bg-orange-100' },
  abandoned_settlement: { icon: MapPin, color: 'text-slate-600', bg: 'bg-slate-100' },
};

// Haversine distance between two {lat,lng} points in km — used only to auto-detect when the
// walker's GPS position comes close to a waypoint, so it can be ticked off automatically.
function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const REACHED_PROXIMITY_KM = 0.06; // ~60m — close enough to count as "you were here"

function reachedStorageKey(walkId) {
  return `explore_crete_reached__${walkId}`;
}

// A stable per-waypoint key for tracking "reached" state. Waypoints don't carry their own id
// field, only a segment_id (e.g. "MXR14"), so fall back to position in the list if that's ever
// missing rather than breaking the whole feature.
function waypointKey(waypoint, index) {
  return waypoint.segment_id || `idx-${index}`;
}

// If a walker's last tick on this walk was longer ago than this, treat it as a new attempt and
// start with a clean slate rather than resuming old progress — many walkers (flower enthusiasts
// especially, per Anoushka) repeat the same walk several times a month and each time is a fresh
// go, not a continuation. Set generously long (18h) so a single long day-hike, or briefly
// backgrounding the app for a phone call, never gets mistaken for "a different day".
const REACHED_STALE_MS = 18 * 60 * 60 * 1000;

export default function WalkDetail({ walk, onClose }) {
  const [followGps, setFollowGps] = React.useState(false);

  const isDrivingTour = walk?.route_type === 'driving_audio_tour';

  // For driving tours, only show primary_start (the -PS segment-start points) to users.
  // Secondary waypoints are used internally for audio triggering only and are never
  // exposed in the user-facing UI. The route line still follows the full waypoint
  // sequence via trail_path.
  const waypoints = isDrivingTour
    ? (walk?.waypoints || []).filter(wp => wp.waypoint_role === 'primary_start')
    : (walk?.waypoints || []);

  // Reached-waypoint tracking (Walk/Hike only) — lets a walker tick off each point as they pass
  // it, so on a long route (some have 50-60 waypoints) they can always find their way back to
  // the last point they recognise if they lose the trail. Saved to this device so it survives
  // closing and reopening the app mid-walk. Not used for driving tours, which navigate by audio
  // instead.
  const [reachedIds, setReachedIds] = React.useState(() => {
    if (!walk?.id) return new Set();
    try {
      const raw = localStorage.getItem(reachedStorageKey(walk.id));
      if (!raw) return new Set();
      const saved = JSON.parse(raw);
      // Old format was a plain array with no timestamp — treat that as fresh rather than
      // discarding it, since we can't tell its age.
      if (Array.isArray(saved)) return new Set(saved);
      if (saved && Array.isArray(saved.ids)) {
        const age = Date.now() - (saved.updatedAt || 0);
        if (age > REACHED_STALE_MS) {
          localStorage.removeItem(reachedStorageKey(walk.id));
          return new Set();
        }
        return new Set(saved.ids);
      }
      return new Set();
    } catch (err) {
      return new Set();
    }
  });

  const persistReached = React.useCallback((nextSet) => {
    if (!walk?.id) return;
    try {
      localStorage.setItem(
        reachedStorageKey(walk.id),
        JSON.stringify({ ids: Array.from(nextSet), updatedAt: Date.now() })
      );
    } catch (err) {
      // Storage full or unavailable — not fatal, the walker just loses the saved tick-marks
      // if they close the app, ticking still works for the rest of this session.
    }
  }, [walk?.id]);

  const toggleReached = (key) => {
    setReachedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistReached(next);
      return next;
    });
  };

  const resetProgress = () => {
    setReachedIds(new Set());
    persistReached(new Set());
  };

  // Automatically tick off any waypoint the walker's GPS passes close to. This only adds
  // ticks, never removes one — if GPS is unreliable in the mountains (as it often is on
  // Crete) the walker's own manual taps always take priority and are never overridden.
  React.useEffect(() => {
    if (!walk?.id || isDrivingTour) return;
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setReachedIds(prev => {
          let changed = false;
          const next = new Set(prev);
          waypoints.forEach((wp, index) => {
            if (wp.lat == null || wp.lng == null) return;
            const key = waypointKey(wp, index);
            if (next.has(key)) return;
            if (haversineKm({ lat: wp.lat, lng: wp.lng }, userPos) <= REACHED_PROXIMITY_KM) {
              next.add(key);
              changed = true;
            }
          });
          if (changed) {
            persistReached(next);
            return next;
          }
          return prev;
        });
      },
      () => { /* GPS unavailable — manual ticking still works fine without it */ },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk?.id, isDrivingTour]);

  if (!walk) return null;

  // The furthest-along waypoint reached so far, so it can be highlighted distinctly — this is
  // the point a lost walker is most likely to recognise and be able to navigate back to.
  const lastReachedIndex = waypoints.reduce((last, wp, index) => (
    reachedIds.has(waypointKey(wp, index)) ? index : last
  ), -1);

  // Highest point on the route — shown in the header for walk/hike tours so walkers with
  // blood-pressure or altitude concerns can judge the route before they set off.
  const maxElevation = isDrivingTour ? null
    : waypoints.reduce((max, wp) => (wp.elevation != null && wp.elevation > max ? wp.elevation : max), -Infinity);
  const hasMaxElevation = !isDrivingTour && maxElevation !== -Infinity && maxElevation > 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="h-full flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="p-4 border-b bg-gradient-to-r from-blue-600 to-blue-700 text-white">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-mono text-xs bg-white/20 px-2 py-1 rounded">
                {walk.code}
              </span>
              <h2 className="text-xl font-bold mt-2">{walk.name}</h2>
              {walk.region && (
                <p className="text-blue-100 text-sm mt-1">{walk.region}</p>
              )}
            </div>

            <div className="flex items-center gap-1 -mt-1 -mr-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setFollowGps(f => !f)}
                title={followGps ? 'Stop following GPS' : 'Follow my location'}
                className={`${followGps ? 'bg-white/30 text-white' : 'text-white/70 hover:bg-white/20'}`}
              >
                <Crosshair className="w-5 h-5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-white hover:bg-white/20"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4 text-sm">
            {walk.difficulty && (
              <Badge className={`${difficultyColors[walk.difficulty]} border-0`}>
                {walk.difficulty}
              </Badge>
            )}

            {walk.distance_km && (
              <div className="flex items-center gap-1.5">
                <Route className="w-4 h-4" />
                <span>{walk.distance_km} km</span>
              </div>
            )}

            {walk.duration_hours && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>{walk.duration_hours}h</span>
              </div>
            )}

            {walk.elevation_gain_m && (
              <div className="flex items-center gap-1.5" title="Total ascent">
                <TrendingUp className="w-4 h-4" />
                <span>{walk.elevation_gain_m}m</span>
              </div>
            )}

            {hasMaxElevation && (
              <div className="flex items-center gap-1.5" title="Highest point on this route">
                <Mountain className="w-4 h-4" />
                <span>Max {Math.round(maxElevation)}m</span>
              </div>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {walk.route_type === 'driving_audio_tour' && (
              <DrivingModeNotice />
            )}

            {walk.route_type === 'driving_audio_tour' && (
              <DrivingTourPlayer walk={walk} />
            )}

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <DownloadButton walk={walk} />
                <DownloadWalkButton walk={walk} />
              </div>

              {followGps && (
                <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
                  <Crosshair className="w-3.5 h-3.5" /> Tracking location
                </span>
              )}
            </div>

            <WalkProgressBar walk={walk} />

            <div className="h-64 rounded-xl overflow-hidden border">
              <WalkDetailMap
                walk={walk}
                followGps={followGps}
              />
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                <h3 className="font-bold text-red-700">Before You Set Off</h3>
              </div>

              <p className="text-red-700 text-sm leading-relaxed whitespace-pre-line">
                {walk.safety_notes ||
                  `Essential equipment: sun hat, sturdy walking shoes or boots, walking poles, and a minimum of 2 litres of water per person.\n\nMobile signal may be unreliable. Download the GPX file and load it into a navigation app before departure.\n\nUnder Greek law, the cost of any search and rescue operation is charged to the individual. Do not attempt any walk unprepared.`}
              </p>
            </div>

            {walk.description && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">About this walk</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  {walk.description}
                </p>
              </div>
            )}

            {walk.walk_category === 'community' && walk.contributor_name && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <h3 className="font-semibold text-green-800 mb-1">Community Walk</h3>
                <p className="text-sm text-green-700">
                  Contributed by {walk.contributor_name}
                </p>
              </div>
            )}

            {waypoints.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-gray-900">
                    {isDrivingTour ? 'Tour Stops' : 'Key Points'}
                  </h3>
                  {!isDrivingTour && reachedIds.size > 0 && (
                    <button
                      onClick={resetProgress}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset progress
                    </button>
                  )}
                </div>
                {!isDrivingTour && (
                  <p className="text-xs text-gray-500 mb-3">
                    Tap the circle as you pass each point — if you lose the trail, you'll always
                    be able to see the last point you recognised.
                  </p>
                )}

                <div className="space-y-2">
                  {waypoints.map((waypoint, index) => {
                    const config = waypointIcons[waypoint.type] || waypointIcons.landmark;
                    const Icon = config.icon;

                    // For driving tours, use role-based styling
                    const roleConfig = isDrivingTour ? {
                      primary_start: { icon: Navigation, color: 'text-green-600', bg: 'bg-green-100', label: 'Start' },
                      primary_stop: { icon: MapPin, color: 'text-red-600', bg: 'bg-red-100', label: 'Stop' },
                    }[waypoint.waypoint_role] : null;
                    const displayIcon = roleConfig ? roleConfig.icon : Icon;
                    const displayBg = roleConfig ? roleConfig.bg : config.bg;
                    const displayColor = roleConfig ? roleConfig.color : config.color;
                    const displayName = isDrivingTour
                      ? (waypoint.segment_title || waypoint.name)
                      : (waypoint.segment_id && waypoint.name ? `${waypoint.segment_id} — ${waypoint.name}` : (waypoint.segment_id || waypoint.name));
                    const displayLabel = roleConfig ? roleConfig.label : (waypoint.type ? waypoint.type.replace('_', ' ') : null);

                    const key = waypointKey(waypoint, index);
                    const isReached = !isDrivingTour && reachedIds.has(key);
                    const isLastReached = !isDrivingTour && index === lastReachedIndex;

                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                          isLastReached
                            ? 'bg-blue-50 border-2 border-blue-400'
                            : isReached
                            ? 'bg-gray-100 opacity-60'
                            : waypoint.type === 'danger'
                            ? 'bg-red-50 border border-red-200'
                            : 'bg-gray-50'
                        }`}
                      >
                        {!isDrivingTour && (
                          <button
                            onClick={() => toggleReached(key)}
                            className="shrink-0 mt-2"
                            title={isReached ? 'Mark as not reached' : 'Mark as reached'}
                          >
                            {isReached
                              ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                              : <Circle className="w-5 h-5 text-gray-300" />}
                          </button>
                        )}

                        <div className={`p-2 rounded-lg ${displayBg}`}>
                          <displayIcon className={`w-4 h-4 ${displayColor}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-medium ${isReached ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                              {displayName}
                            </span>

                            {displayLabel && (
                              <Badge variant="outline" className="text-xs capitalize">
                                {displayLabel}
                              </Badge>
                            )}

                            {!isDrivingTour && waypoint.elevation != null && (
                              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                                <TrendingUp className="w-3 h-3" /> {Math.round(waypoint.elevation)}m
                              </span>
                            )}

                            {isLastReached && (
                              <Badge className="text-xs bg-blue-600 hover:bg-blue-600">You were last here</Badge>
                            )}
                          </div>

                          {waypoint.description && (
                            <p className="text-sm text-gray-600 mt-1">
                              {waypoint.description}
                            </p>
                          )}

                          {getWaypointImages(waypoint).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {getWaypointImages(waypoint).map((url, i) => (
                                <img
                                  key={i}
                                  src={url}
                                  alt={displayName}
                                  className="w-24 h-24 object-cover rounded-lg border"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </motion.div>
    </AnimatePresence>
  );
}