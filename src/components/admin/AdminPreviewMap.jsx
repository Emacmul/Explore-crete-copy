import React from 'react';
import WalkDetailMap from '../map/WalkDetailMap';
import { MapPin } from 'lucide-react';

export default function AdminPreviewMap({ walk }) {
  // Fall back to first waypoint coords if start_lat/start_lng not explicitly set
  const firstWaypoint = (walk.waypoints || [])[0];
  const startLat = walk.start_lat || firstWaypoint?.lat;
  const startLng = walk.start_lng || firstWaypoint?.lng;
  const hasStart = startLat && startLng &&
    !isNaN(Number(startLat)) && !isNaN(Number(startLng));

  const previewWalk = {
    ...walk,
    start_lat: Number(startLat),
    start_lng: Number(startLng),
    trail_path: walk.trail_path || [],
    waypoints: walk.waypoints || [],
  };

  if (!hasStart) {
    return (
      <div className="flex flex-col items-center justify-center h-80 text-slate-500 border border-dashed border-slate-600 rounded-xl">
        <MapPin className="w-10 h-10 mb-3 opacity-40" />
        <p className="font-medium">No GPS coordinates yet</p>
        <p className="text-sm">Add a starting point in "Basic Details" to preview the map</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white font-semibold mb-1">Map Preview</h3>
        {/* Per Enda: this screen only ever opens inside the tour editor, which only an
            Admin or a Narrator can get to — a real paying customer never sees this exact
            screen at all. So the popup here is allowed to keep the waypoint code and the
            coloured "Start" badge, as a genuinely useful working reference while editing
            (see showInternalLabels below). The wording here used to say "This is how the
            walk will appear to users", which read as a promise that this exact popup was
            what a customer sees — it isn't, so it's been reworded to say what this screen
            actually is, to avoid that confusion again. */}
        <p className="text-slate-400 text-sm">Route and waypoints preview for editing — codes and badges here are for your own reference. A real customer's popup just shows the plain waypoint name.</p>
      </div>
      <div className="h-96 rounded-xl overflow-hidden border border-slate-600">
        {/* Per Enda: this is the Admin/Narrator's own working view, so it keeps the
            waypoint code and the coloured "Start" (etc.) badge in the popup — genuinely
            useful here. The real customer-facing map (a completely different screen,
            opened from the tour's own page in the customer-facing part of the app, never
            from inside this editor) leaves showInternalLabels off — its default — so it
            shows only the plain waypoint name, no code, no badge. */}
        <WalkDetailMap walk={previewWalk} showInternalLabels={true} />
      </div>
      <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600 text-sm text-slate-400">
        <span className="text-slate-300 font-medium">Trail points: </span>{(walk.trail_path || []).length} · 
        <span className="text-slate-300 font-medium"> Key points: </span>{(walk.waypoints || []).length}
      </div>
    </div>
  );
}