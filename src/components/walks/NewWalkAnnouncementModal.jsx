import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Route, Clock, TrendingUp } from 'lucide-react';

const SEEN_KEY = 'seen_walk_announcements';

export function getUnseenAnnouncement(walks) {
  const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');

  const announced = walks
    .filter(w => w.announced_at && !seen.includes(w.id))
    .sort((a, b) => new Date(b.announced_at) - new Date(a.announced_at));

  return announced[0] || null;
}

export function markAnnouncementSeen(walkId) {
  const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');

  if (!seen.includes(walkId)) {
    seen.push(walkId);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  }
}

export default function NewWalkAnnouncementModal({ walk, onDismiss }) {
  if (!walk) return null;

  const handleDismiss = () => {
    markAnnouncementSeen(walk.id);
    onDismiss();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9997] flex items-end sm:items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleDismiss}
        />

        <motion.div
          className="relative w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', damping: 22 }}
        >
          {walk.image_url ? (
            <div className="relative h-40 overflow-hidden">
              <img
                src={walk.image_url}
                alt={walk.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

              <div className="absolute bottom-3 left-4">
                <span className="bg-green-500 text-white text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                  New Walk
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-6 pt-6 pb-4 text-white">
              <span className="bg-green-400 text-green-900 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                New Walk Added
              </span>
            </div>
          )}

          <div className="px-6 pt-4 pb-2">
            <h2 className="text-xl font-bold text-gray-900">
              {walk.name}
            </h2>

            {walk.region && (
              <p className="text-sm text-gray-500 mt-0.5">
                {walk.region}
              </p>
            )}

            <div className="flex items-center gap-4 mt-3 text-sm text-gray-600">
              {walk.distance_km && (
                <div className="flex items-center gap-1">
                  <Route className="w-3.5 h-3.5" />
                  {walk.distance_km} km
                </div>
              )}

              {walk.duration_hours && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {walk.duration_hours}h
                </div>
              )}

              {walk.elevation_gain_m && (
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {walk.elevation_gain_m}m
                </div>
              )}
            </div>

            {walk.description && (
              <p className="text-sm text-gray-600 mt-3 line-clamp-3">
                {walk.description}
              </p>
            )}
          </div>

          <div className="px-6 pb-6 pt-2">
            <button
              onClick={handleDismiss}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-all"
            >
              Great, let's go!
            </button>
          </div>

          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 bg-black/20 hover:bg-black/40 text-white rounded-full p-1 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}