import React from 'react';
import { Clock, Route, Calendar, Share2, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

function formatDuration(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function RecordedWalkCard({ walk, onClick, isOwner }) {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="bg-white border rounded-xl p-4 shadow-sm cursor-pointer hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-gray-900 leading-tight">{walk.name}</h3>
        <div className="flex items-center gap-1 shrink-0">
          {walk.is_shared ? (
            <Badge className="bg-blue-50 text-blue-600 border-blue-200 gap-1 text-xs">
              <Share2 className="w-3 h-3" /> Shared
            </Badge>
          ) : isOwner ? (
            <Badge variant="outline" className="text-gray-400 gap-1 text-xs">
              <Lock className="w-3 h-3" /> Private
            </Badge>
          ) : null}
        </div>
      </div>

      {!isOwner && walk.owner_name && (
        <p className="text-xs text-gray-400 mb-2">by {walk.owner_name}</p>
      )}

      <div className="flex items-center gap-4 text-sm text-gray-500">
        {walk.recorded_at && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            <span>{new Date(walk.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
        )}
        {walk.distance_km != null && (
          <div className="flex items-center gap-1.5">
            <Route className="w-3.5 h-3.5" />
            <span>{walk.distance_km} km</span>
          </div>
        )}
        {walk.duration_seconds != null && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatDuration(walk.duration_seconds)}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}