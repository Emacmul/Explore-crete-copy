import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import AutoGrowTextarea from '@/components/admin/AutoGrowTextarea';
import { Button } from '@/components/ui/button';
import { useNarratorApiKeys, getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import prepareWalkingWaypoints from '@/lib/prepareWalkingWaypoints';
import { setWaypointCaption } from '@/lib/waypointImages';
import WaypointCaptionEditor from '@/components/admin/WaypointCaptionEditor';

export default function WalkingCloneWaypointEditor({ walk, master, onChange, onAutoSave }) {
  const { keys, loadedOk } = useNarratorApiKeys();
  const [preparing, setPreparing] = useState(false);
  const [errors, setErrors] = useState([]);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ walk, master, onChange, onAutoSave, keys });
  latest.current = { walk, master, onChange, onAutoSave, keys };
  useEffect(() => {
    if (!loadedOk || walk.finished || !master) return;
    let cancelled = false;
    setPreparing(true);
    prepareWalkingWaypoints({ ...latest.current, apiKeys: latest.current.keys, authPayload: getNarratorAuthPayload() }).then(result => {
      if (cancelled) return;
      if (JSON.stringify(result.waypoints) !== JSON.stringify(latest.current.walk.waypoints)) {
        latest.current.onChange(result.waypoints);
        latest.current.onAutoSave();
      }
      setErrors(result.errors);
      setPreparing(false);
    });
    return () => { cancelled = true; };
  }, [walk.id, walk.finished, loadedOk, master?.id, attempt]);
  const locked = !!walk.finished || preparing || !loadedOk;
  const update = (index, field, value) => onChange(walk.waypoints.map((wp, i) => i === index ? { ...wp, [field]: value } : wp));
  return <div className="space-y-4">
    <p className="text-sm text-slate-300">Review and edit the translated waypoint names and descriptions. Locations, codes and photos remain unchanged.</p>
    {preparing && <p role="status" className="text-sm text-amber-400">Preparing waypoint translations…</p>}
    {!!errors.length && <div role="alert" className="text-sm text-red-400">Some waypoint translations could not be prepared.<ul>{errors.map(error => <li key={error}>{error}</li>)}</ul><Button onClick={() => setAttempt(value => value + 1)} disabled={preparing}>Retry preparation</Button></div>}
    {walk.finished && <p className="text-sm text-amber-400">Submitted for review — an Admin must reopen this clone before editing.</p>}
    {!walk.waypoints.length && <p className="text-sm text-slate-400">This walk has no waypoints.</p>}
    {walk.waypoints.map((wp, index) => <section key={index} className="rounded-lg border border-slate-600 bg-slate-800 p-4 space-y-3">
      <h3 className="font-medium text-white">{wp.segment_id || `Waypoint ${index + 1}`}</h3>
      <label className="block text-sm text-slate-300">Name<Input aria-label={`Waypoint ${index + 1} name`} value={wp.name || ''} disabled={locked} onChange={event => update(index, 'name', event.target.value)} className="bg-slate-700 border-slate-600 text-white" /></label>
      <label className="block text-sm text-slate-300">Description<AutoGrowTextarea aria-label={`Waypoint ${index + 1} description`} value={wp.description || ''} disabled={locked} onChange={event => update(index, 'description', event.target.value)} rows={3} className="bg-slate-700 border-slate-600 text-white" /></label>
      <WaypointCaptionEditor
        waypoint={wp}
        disabled={locked}
        onCaptionChange={(i, val) => update(index, 'image_captions', setWaypointCaption(wp, i, val))}
      />
      {/* One save control per location block, per Enda's request — saves the WHOLE
          walk through the editor's shared save mechanism (onAutoSave), so a save
          requested here never races another one and always reads the latest edits. */}
      <div className="flex justify-end pt-1 border-t border-slate-700">
        <Button
          type="button"
          size="sm"
          onClick={() => onAutoSave && onAutoSave()}
          disabled={locked || !onAutoSave}
          className="bg-amber-500 hover:bg-amber-600 gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save Route
        </Button>
      </div>
    </section>)}
  </div>;
}