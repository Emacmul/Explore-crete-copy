import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  X, Clock, Route, TrendingUp, MapPin, AlertTriangle,
  Eye, Droplets, TreePine, Navigation, Crosshair, ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import WalkDetailMap from '../map/WalkDetailMap';
import DownloadWalkButton from '../offline/DownloadWalkButton';
import WalkProgressBar from './WalkProgressBar';
import DrivingModeNotice from './DrivingModeNotice';
import DrivingTourPlayer from './DrivingTourPlayer';

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

export default function WalkDetail({ walk, onClose }) {
  const [followGps, setFollowGps] = React.useState(false);

  if (!walk) return null;

  const isDrivingTour = walk.route_type === 'driving_audio_tour';

  // For driving tours, only show primary_start (the -PS segment-start points) to users.
  // Secondary waypoints are used internally for audio triggering only and are never
  // exposed in the user-facing UI. The route line still follows the full waypoint
  // sequence via trail_path.
  const waypoints = isDrivingTour
    ? (walk.waypoints || []).filter(wp => wp.waypoint_role === 'primary_start')
    : (walk.waypoints || []);

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
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4" />
                <span>{walk.elevation_gain_m}m</span>
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

            <div className="flex items-center justify-between">
              <DownloadWalkButton walk={walk} />

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
                <h3 className="font-semibold text-gray-900 mb-3">
                  {isDrivingTour ? 'Tour Stops' : 'Key Points'}
                </h3>

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
                    const displayName = isDrivingTour ? (waypoint.segment_title || waypoint.name) : waypoint.name;
                    const displayLabel = roleConfig ? roleConfig.label : (waypoint.type ? waypoint.type.replace('_', ' ') : null);

                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={`flex items-start gap-3 p-3 rounded-lg ${
                          waypoint.type === 'danger'
                            ? 'bg-red-50 border border-red-200'
                            : 'bg-gray-50'
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${displayBg}`}>
                          <displayIcon className={`w-4 h-4 ${displayColor}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">
                              {displayName}
                            </span>

                            {displayLabel && (
                              <Badge variant="outline" className="text-xs capitalize">
                                {displayLabel}
                              </Badge>
                            )}
                          </div>

                          {waypoint.description && (
                            <p className="text-sm text-gray-600 mt-1">
                              {waypoint.description}
                            </p>
                          )}

                          {waypoint.image_url && (
                            <img
                              src={waypoint.image_url}
                              alt={displayName}
                              className="mt-2 w-full max-w-xs h-32 object-cover rounded-lg border"
                            />
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