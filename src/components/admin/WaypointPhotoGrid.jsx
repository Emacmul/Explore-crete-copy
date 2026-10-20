import React from 'react';
import { X, Loader2, ImagePlus } from 'lucide-react';
import {
  MAX_WAYPOINT_IMAGES,
  getWaypointImages,
  getWaypointCaptions,
} from '@/lib/waypointImages';

// Shared photo grid for every waypoint editor: a thumbnail with a short caption input
// under each photo, plus the add/remove controls. Captions are short, optional text
// shown to customers under the photo (WalkDetail list + lightbox) and to narrators as
// read-only context. The caller owns state; this component reports intents back via
// onAdd / onRemove / onCaptionChange so it works identically inside the new-waypoint
// form (local state) and the expanded-waypoint editor (lifted onChange).
export default function WaypointPhotoGrid({ waypoint, onAdd, onRemove, onCaptionChange, uploading }) {
  const images = getWaypointImages(waypoint);
  const captions = getWaypointCaptions(waypoint);
  return (
    <div className="flex flex-wrap gap-2 items-start">
      {images.map((url, i) => (
        <div key={i} className="flex flex-col gap-1 shrink-0 w-20">
          <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-600 shrink-0">
            <img src={url} alt="waypoint" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <input
            type="text"
            value={captions[i] || ''}
            onChange={(e) => onCaptionChange(i, e.target.value)}
            placeholder="Caption"
            maxLength={140}
            className="w-20 text-[11px] leading-tight bg-slate-700 border border-slate-500 text-white rounded px-1 h-7"
          />
        </div>
      ))}
      {images.length < MAX_WAYPOINT_IMAGES && (
        <label className="flex flex-col items-center justify-center gap-1 cursor-pointer bg-slate-700 border border-dashed border-slate-500 rounded-lg w-20 h-20 shrink-0 text-slate-400 hover:text-white hover:border-slate-400 transition-colors text-xs text-center">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
          {!uploading && 'Add'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files[0] && onAdd(e.target.files[0])}
            disabled={uploading}
          />
        </label>
      )}
    </div>
  );
}