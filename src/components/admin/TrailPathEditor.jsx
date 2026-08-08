import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, GripVertical, Info, Pencil, Check, X, Scissors } from 'lucide-react';
import { reindexAfterInsert, reindexAfterDeleteOne, nearestInsertIndex } from '@/lib/trailBreaks';

export default function TrailPathEditor({ trailPath, onChange, trailBreaks = [], onBreaksChange }) {
  const breakSet = new Set((trailBreaks || []).filter(b => Number.isInteger(b) && b >= 0 && b < trailPath.length - 1));
  const [newLat, setNewLat] = useState('');
  const [newLng, setNewLng] = useState('');
  const [editIndex, setEditIndex] = useState(null);
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');

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

  return (
    <div className="space-y-5">
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