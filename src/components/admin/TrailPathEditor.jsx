import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, GripVertical, Info, Pencil, Check, X, Scissors, Lock, ChevronDown, ChevronRight, AlertTriangle, ShieldAlert } from 'lucide-react';
import { reindexAfterInsert, reindexAfterDeleteOne, nearestInsertIndex } from '@/lib/trailBreaks';

// Per Enda: raw GPS points are the last thing anyone should be casually poking at —
// editing one changes the live route for a tour people may be using on the ground
// right now. This whole component (the "Add GPS Point" form AND the point list below
// it) is therefore:
//   1. Admin-only. `userRole` is checked here too, not just relied on at the tab level
//      (WalkEditor.jsx already hides the whole "Route Path (GPS)" tab from narrators
//      via showTrailTab — this is a second, explicit gate on the component itself, the
//      same belt-and-suspenders approach used elsewhere in this codebase).
//   2. Collapsed by default, inside its own locked container — never in plain view.
//   3. Only reachable after a deliberate, explicit confirmation step every time it's
//      opened (not just once per session) — collapsing it again re-locks it, so
//      reopening is always a conscious decision, never a leftover expanded panel from
//      five minutes ago.
// A genuine "log in again" step (re-authenticating before editing) was asked for too,
// but there's no re-auth/step-up-login mechanism anywhere in this app to hook into —
// Base44's client here runs with requiresAuth: false and there's no password-recheck
// endpoint on the backend. Building one blind, without a real API to call, risked
// shipping something that looks like security but isn't. This is the strongest
// equivalent achievable without that: real friction, not simulated.
export default function TrailPathEditor({ trailPath, onChange, trailBreaks = [], onBreaksChange, userRole = 'admin' }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const breakSet = new Set((trailBreaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1));
  const [newLat, setNewLat] = useState('');
  const [newLng, setNewLng] = useState('');
  const [editIndex, setEditIndex] = useState(null);
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');

  // Extra safety net even though only an admin session should ever mount this
  // component at all (see the doc comment above) — if that ever changes upstream,
  // this still can't render anything for anyone else.
  if (userRole !== 'admin') return null;

  const closePanel = () => {
    setPanelOpen(false);
    setConfirmed(false);
    cancelEdit();
  };

  const startEdit = (index) => {
    setEditIndex(index);
    setEditLat(String(trailPath[index].lat));
    setEditLng(String(trailPath[index].lng));
  };

  const cancelEdit = () => {
    setEditIndex(null);
    setEditLat('');
    setEditLng('');
  };

  const saveEdit = () => {
    const lat = parseFloat(editLat);
    const lng = parseFloat(editLng);
    if (isNaN(lat) || isNaN(lng)) { cancelEdit(); return; }
    if (lat < 34 || lat > 36 || lng < 23 || lng > 27) {
      alert('Coordinates appear to be outside Crete. Latitude ~35, longitude ~24–26.');
      return;
    }
    const next = [...trailPath];
    next[editIndex] = { lat, lng };
    onChange(next);
    cancelEdit();
  };

  const addPoint = () => {
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);
    if (isNaN(lat) || isNaN(lng)) return;
    if (lat < 34 || lat > 36 || lng < 23 || lng > 27) {
      alert('Coordinates appear to be outside Crete. Please check your values.\nLatitude should be ~35, Longitude should be ~24–26.');
      return;
    }
    // Insert at the geographically nearest spot along the existing path — not always
    // the end — so points land in the right place even after the map editor inserted
    // others out of order. Re-index any cuts so they stay glued to their segment.
    const idx = nearestInsertIndex(trailPath, { lat, lng });
    const next = [...trailPath];
    next.splice(idx, 0, { lat, lng });
    onChange(next);
    onBreaksChange?.(reindexAfterInsert(trailBreaks, idx));
    setNewLat('');
    setNewLng('');
  };

  const removePoint = (index) => {
    const next = trailPath.filter((_, i) => i !== index);
    onChange(next);
    // Re-index cuts so a delete doesn't drag them onto the wrong segment.
    onBreaksChange?.(reindexAfterDeleteOne(trailBreaks, index));
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text');
    // Support "lat, lng" paste from Google Maps
    const match = text.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (match) {
      e.preventDefault();
      setNewLat(match[1]);
      setNewLng(match[2]);
    }
  };

  // Locked, collapsed state — this is what shows by default and every time the panel
  // is closed again. Nothing about the points (not even the count) is revealed here.
  if (!panelOpen) {
    return (
      <div className="rounded-lg border border-red-700/40 bg-red-950/20">
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
        >
          <Lock className="w-4 h-4 text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-200">Raw GPS Points — locked (Admin only)</p>
            <p className="text-xs text-red-300/70">Editing these changes the live route. Click to review and unlock.</p>
          </div>
          <ChevronRight className="w-4 h-4 text-red-400/70 shrink-0" />
        </button>
      </div>
    );
  }

  // Opened, but not yet confirmed — the "conscious discussion" step Enda asked for.
  // Nothing editable is shown until this is explicitly accepted.
  if (!confirmed) {
    return (
      <div className="rounded-lg border border-red-700/40 bg-red-950/20 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-200">This unlocks direct editing of the raw GPS route</p>
            <p className="text-xs text-red-300/80 mt-1">
              Adding, moving, or deleting a point here changes the exact line customers follow on a live
              tour — including anyone using it right now. This should only be done in exceptional
              circumstances, and only once you're sure it's the right fix. If you just need to add or cut
              a section of the route, the map tool above already does that without touching raw points.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={closePanel} className="text-slate-400 hover:text-slate-200">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => setConfirmed(true)}
            className="bg-red-700 hover:bg-red-800 text-white gap-2"
          >
            <AlertTriangle className="w-4 h-4" /> Yes, I understand — unlock editing
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-700/40 bg-red-950/10 p-4 space-y-5">
      <button
        type="button"
        onClick={closePanel}
        className="w-full flex items-center gap-2 text-left text-red-300 hover:text-red-200"
      >
        <ChevronDown className="w-4 h-4 shrink-0" />
        <span className="text-xs font-medium">Editing unlocked — click to lock again</span>
      </button>

      <div>
        <h3 className="text-white font-semibold mb-1">Trail Path GPS Points</h3>
        <div className="flex items-start gap-2 bg-blue-900/30 border border-blue-700/50 rounded-lg p-3 text-sm text-blue-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Add GPS coordinates in order from start to finish. These draw the route line on the map.
            You can paste coordinates directly from Google Maps (right-click → copy coords).
          </span>
        </div>
      </div>

      {/* Add point form */}
      <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
        <Label className="text-slate-300 text-sm mb-3 block">Add GPS Point</Label>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Label className="text-slate-400 text-xs mb-1 block">Latitude</Label>
            <Input
              type="number" step="0.000001"
              value={newLat}
              onChange={e => setNewLat(e.target.value)}
              onPaste={handlePaste}
              placeholder="35.301900"
              className="bg-slate-700 border-slate-500 text-white font-mono"
            />
          </div>
          <div className="flex-1">
            <Label className="text-slate-400 text-xs mb-1 block">Longitude</Label>
            <Input
              type="number" step="0.000001"
              value={newLng}
              onChange={e => setNewLng(e.target.value)}
              placeholder="23.963300"
              className="bg-slate-700 border-slate-500 text-white font-mono"
            />
          </div>
          <Button
            onClick={addPoint}
            className="bg-amber-500 hover:bg-amber-600 gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>
      </div>

      {/* Point list */}
      {trailPath.length === 0 ? (
        <div className="text-center py-8 text-slate-500 border border-dashed border-slate-600 rounded-lg">
          No trail points yet. Add GPS coordinates above.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <Label className="text-slate-400 text-sm">{trailPath.length} points added</Label>
          </div>
          {trailPath.map((point, index) => (
            <React.Fragment key={index}>
            <div className="flex items-center gap-3 bg-slate-700/50 rounded-lg px-3 py-2 border border-slate-600">
              <GripVertical className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-slate-400 text-xs w-6 text-right">{index + 1}</span>
              {editIndex === index ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input type="number" step="0.000001" value={editLat}
                    onChange={e => setEditLat(e.target.value)}
                    className="bg-slate-800 border-slate-500 text-green-300 font-mono h-7 text-xs px-2 w-28" />
                  <Input type="number" step="0.000001" value={editLng}
                    onChange={e => setEditLng(e.target.value)}
                    className="bg-slate-800 border-slate-500 text-green-300 font-mono h-7 text-xs px-2 w-28" />
                  <Button variant="ghost" size="icon" onClick={saveEdit} className="text-green-400 hover:text-green-300 w-7 h-7">
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={cancelEdit} className="text-slate-500 hover:text-slate-300 w-7 h-7">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="font-mono text-sm text-green-300 flex-1">
                    {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                  </span>
                  {index === 0 && <span className="text-xs bg-green-800 text-green-300 px-2 py-0.5 rounded">Start</span>}
                  {index === trailPath.length - 1 && trailPath.length > 1 && (
                    <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded">End</span>
                  )}
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => startEdit(index)}
                    className="text-slate-500 hover:text-amber-400 w-7 h-7"
                    title="Edit coordinates"
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => removePoint(index)}
                    className="text-slate-500 hover:text-red-400 w-7 h-7"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
            {breakSet.has(index) && index < trailPath.length - 1 && (
              <div className="flex items-center gap-2 mx-3 my-1 px-3 py-1 rounded bg-purple-900/30 border border-dashed border-purple-600/50 text-xs text-purple-300">
                <Scissors className="w-3 h-3" /> Cut — no line is drawn to the next point
              </div>
            )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
