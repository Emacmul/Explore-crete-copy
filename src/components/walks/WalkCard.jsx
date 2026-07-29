import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, Route, TrendingUp, ChevronRight, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useOfflineWalks } from '../offline/useOfflineWalks';
import OfflineBadge from './OfflineBadge';

const difficultyColors = {
  easy: 'bg-green-100 text-green-700 border-green-200',
  moderate: 'bg-amber-100 text-amber-700 border-amber-200',
  challenging: 'bg-orange-100 text-orange-700 border-orange-200',
  difficult: 'bg-red-100 text-red-700 border-red-200',
};

export default function WalkCard({ walk, onClick, isSelected }) {
  const { isDownloaded } = useOfflineWalks();
  const downloaded = isDownloaded(walk.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Card
        onClick={onClick}
        className={`p-4 cursor-pointer transition-all duration-300 border-2 ${
          isSelected
            ? 'border-blue-500 bg-blue-50/50 shadow-lg'
            : 'border-transparent hover:border-gray-200 hover:shadow-md'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-medium">
                {walk.code}
              </span>

              {walk.difficulty && (
                <Badge variant="outline" className={`text-xs ${difficultyColors[walk.difficulty]}`}>
                  {walk.difficulty}
                </Badge>
              )}

              {walk.is_sample_walk && (
                <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Sample Walk
                </Badge>
              )}
            </div>

            <h3 className="font-semibold text-gray-900 truncate">{walk.name}</h3>

            {walk.region && (
              <p className="text-sm text-gray-500 mt-0.5">{walk.region}</p>
            )}

            {downloaded && <div className="mt-1"><OfflineBadge /></div>}

            <div className="flex items-center gap-4 mt-3 text-xs text-gray-600">
              {walk.distance_km && (
                <div className="flex items-center gap-1">
                  <Route className="w-3.5 h-3.5" />
                  <span>{walk.distance_km} km</span>
                </div>
              )}

              {walk.duration_hours && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{walk.duration_hours}h</span>
                </div>
              )}

              {walk.elevation_gain_m && (
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{walk.elevation_gain_m}m</span>
                </div>
              )}
            </div>
          </div>

          <ChevronRight className={`w-5 h-5 text-gray-400 mt-1 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
        </div>
      </Card>
    </motion.div>
  );
}