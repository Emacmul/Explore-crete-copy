import React from 'react';
import { getWaypointImages, getWaypointCaptions } from '@/lib/waypointImages';

// Read-only waypoint photo thumbnails with the optional short caption under each, used
// where an admin/narrator is VIEWING a waypoint's reference photos but not editing them
// (the narrator read-only context block in DrivingTourWaypointEditor, and the walking
// clone review screen). Photos are master-managed, so captions are read-only here too.
export default function WaypointPhotoThumbs({ waypoint, size = 'w-20 h-20' }) {
  const images = getWaypointImages(waypoint);
  const captions = getWaypointCaptions(waypoint);
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 items-start">
      {images.map((url, i) => (
        <div key={i} className="flex flex-col gap-1 shrink-0 w-20">
          <div className={`${size} rounded-lg overflow-hidden border border-slate-600 shrink-0`}>
            <img src={url} alt="waypoint" className="w-full h-full object-cover" />
          </div>
          {captions[i] ? (
            <p className="w-20 text-[11px] leading-tight text-slate-300 break-words">{captions[i]}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}