import React from 'react';
import { getWaypointImages, getWaypointCaptions } from '@/lib/waypointImages';

// Read-only reference photos with an EDITABLE caption input under each — for narrator
// CLONE editors, where the photos themselves are master-managed (an Admin adds/removes
// them; a narrator never can) but the short caption under each photo is per-language
// narrator work the narrator translates. The DriveAbout clone editor already has full
// photo+caption editing via WaypointPhotoGrid; this is the read-only-photo variant for
// the walking clone editor, which only needs caption translation.
export default function WaypointCaptionEditor({ waypoint, onCaptionChange, disabled }) {
  const images = getWaypointImages(waypoint);
  const captions = getWaypointCaptions(waypoint);
  if (images.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-400">Reference photos (Admin-managed) — translate the caption under each.</p>
      <div className="flex flex-wrap gap-2 items-start">
        {images.map((url, i) => (
          <div key={i} className="flex flex-col gap-1 shrink-0 w-20">
            <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-600 shrink-0">
              <img src={url} alt="waypoint" className="w-full h-full object-cover" />
            </div>
            <input
              type="text"
              value={captions[i] || ''}
              onChange={(e) => onCaptionChange(i, e.target.value)}
              placeholder="Caption"
              maxLength={140}
              disabled={disabled}
              className="w-20 text-[11px] leading-tight bg-slate-700 border border-slate-500 text-white rounded px-1 h-7 disabled:opacity-50"
            />
          </div>
        ))}
      </div>
    </div>
  );
}