import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ChevronDown, ChevronUp, Info, ImagePlus, Loader2, X, GripVertical, Save } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { base44 } from '@/api/base44Client';

const WAYPOINT_TYPES = [
  { value: 'start', label: '🚩 Start Point', color: 'text-green-400' },
  { value: 'end', label: '🏁 End Point', color: 'text-red-400' },
  { value: 'turnoff', label: '↪️ Turnoff / Junction', color: 'text-amber-400' },
  { value: 'danger', label: '⚠️ Danger Spot', color: 'text-red-400' },
  { value: 'viewpoint', label: '👁️ Viewpoint', color: 'text-purple-400' },
  { value: 'water', label: '💧 Water Source', color: 'text-blue-400' },
  { value: 'rest_area', label: '🪑 Rest Area', color: 'text-emerald-400' },
  { value: 'landmark', label: '📍 Landmark', color: 'text-indigo-400' },
  { value: 'kafeneon', label: '☕ Kafeneon', color: 'text-amber-300' },
  { value: 'wildlife_spot', label: '🦋 Wildlife Spot', color: 'text-green-300' },
  { value: 'church', label: '⛪ Byzantine Church', color: 'text-yellow-300' },
  { value: 'ruins', label: '🏛️ Ancient Ruins', color: 'text-orange-300' },
  { value: 'archaeological_site', label: '🏺 Archaeological Site', color: 'text-orange-400' },
  { value: 'abandoned_settlement', label: '🏚️ Abandoned Settlement', color: 'text-slate-300' },
];

const EMPTY_WAYPOINT = { lat: '', lng: '', type: 'landmark', name: '', description: '', image_url: '' };

// Compress image to max 1200px wide, JPEG 85% quality
const compressImage = (file) => new Promise((resolve) => {
  const MAX = 1200;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

// Renumbers waypoints sequentially (MXR1, MXR2, MXR3...) based on the tour's code and their current
// list position — used for plain Walk/Hike tours only, where names are just a running count, not
// structural IDs tied to scripts (unlike WalkAbout/Driving tours, which never use this component).
function renumberWaypoints(list, code) {
  if (!code) return list;
  return list.map((wp, i) => ({ ...wp, code: `${code}${i + 1}` }));
}

export default function WaypointEditor({ waypoints, onChange, onSave, saving, code }) {
  const [expanded, setExpanded] = useState(null);
  const [newWp, setNewWp] = useState(EMPTY_WAYPOINT);
  const [showAddForm, setShowAddForm] = useState(true);
  const [addError, setAddError] = useState('');

  const addWaypoint = () => {
    setAddError('');
    const lat = parseFloat(String(newWp.lat).replace(',', '.'));
    const lng = parseFloat(String(newWp.lng).replace(',', '.'));
    if (isNaN(lat) || String(newWp.lat).trim() === '') {
      setAddError('Please enter a valid latitude (e.g. 35.3019).');
      return;
    }
    if (isNaN(lng) || String(newWp.lng).trim() === '') {
      setAddError('Please enter a valid longitude (e.g. 23.9633).');
      return;
    }
    const updated = renumberWaypoints([...waypoints, { ...newWp, lat, lng }], code);
    onChange(updated);
    setNewWp(EMPTY_WAYPOINT);
    setShowAddForm(false);
    setExpanded(null);
  };

  const removeWaypoint = (index) => {
    onChange(renumberWaypoints(waypoints.filter((_, i) => i !== index), code));
    if (expanded === index) setExpanded(null);
  };

  const updateWaypoint = (index, field, value) => {
    const updated = waypoints.map((wp, i) => i === index ? { ...wp, [field]: value } : wp);
    onChange(updated);
  };

  const onDragEnd = (result) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const updated = [...waypoints];
    const [moved] = updated.splice(result.source.index, 1);
    updated.splice(result.destination.index, 0, moved);
    onChange(renumberWaypoints(updated, code));
  };

  const [uploadingIndex, setUploadingIndex] = useState(null); // null = new form, number = existing index

  const handleImageUpload = async (file, index) => {
    setUploadingIndex(index ?? 'new');
    const compressed = await compressImage(file);
    const { file_url } = await base44.integrations.Core.UploadFile({ file: compressed });
    if (index === undefined) {
      setNewWp(p => ({ ...p, image_url: file_url }));
    } else {
      updateWaypoint(index, 'image_url', file_url);
    }
    setUploadingIndex(null);
  };

  const handlePaste = (e, field) => {
    if (field !== 'lat') return;
    const text = e.clipboardData.getData('text');
    const match = text.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (match) {
      e.preventDefault();
      setNewWp(prev => ({ ...prev, lat: match[1], lng: match[2] }));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-white font-semibold mb-1">Key Points Along the Trail</h3>
        <div className="flex items-start gap-2 bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 text-sm text-amber-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Add important places: turnoffs, danger spots, viewpoints, water sources etc.
            Each point appears as a labelled marker on the walk's detail map. To import a full set of
            waypoints from a GPX/FIT file, use Import on the General tab.
          </span>
        </div>
      </div>

      {/* Add new waypoint form */}
      <div className="bg-slate-700/50 rounded-lg border border-slate-600 overflow-hidden">
        {/* Header / toggle */}
        <button
          type="button"
          onClick={() => setShowAddForm(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-amber-400" />
            Add New Key Point
          </span>
          {showAddForm ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {showAddForm && <div className="px-4 pb-4 pt-1 border-t border-slate-600 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-slate-400 text-xs mb-1 block">Latitude *</Label>
            <Input
              type="number" step="0.000001"
              value={newWp.lat}
              onChange={e => setNewWp(p => ({ ...p, lat: e.target.value }))}
              onPaste={e => handlePaste(e, 'lat')}
              placeholder="35.301900"
              className="bg-slate-700 border-slate-500 text-white font-mono"
            />
          </div>
          <div>
            <Label className="text-slate-400 text-xs mb-1 block">Longitude *</Label>
            <Input
              type="number" step="0.000001"
              value={newWp.lng}
              onChange={e => setNewWp(p => ({ ...p, lng: e.target.value }))}
              placeholder="23.963300"
              className="bg-slate-700 border-slate-500 text-white font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-slate-400 text-xs mb-1 block">Type *</Label>
            <Select value={newWp.type} onValueChange={v => setNewWp(p => ({ ...p, type: v }))}>
              <SelectTrigger className="bg-slate-700 border-slate-500 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAYPOINT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-400 text-xs mb-1 block">Name (optional)</Label>
            <Input
              value={newWp.name}
              onChange={e => setNewWp(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Rocky descent — the code (e.g. MXR30) is assigned automatically"
              className="bg-slate-700 border-slate-500 text-white"
            />
          </div>
        </div>

        <div>
          <Label className="text-slate-400 text-xs mb-1 block">Description</Label>
          <Textarea
            value={newWp.description}
            onChange={e => setNewWp(p => ({ ...p, description: e.target.value }))}
            placeholder="What should the walker know about this point?"
            rows={2}
            className="bg-slate-700 border-slate-500 text-white resize-none"
          />
        </div>

        {/* Image upload for new waypoint */}
        <div>
          <Label className="text-slate-400 text-xs mb-1 block">Photo (optional)</Label>
          {newWp.image_url ? (
            <div className="relative w-full h-32 rounded-lg overflow-hidden border border-slate-600">
              <img src={newWp.image_url} alt="waypoint" className="w-full h-full object-cover" />
              <button
                onClick={() => setNewWp(p => ({ ...p, image_url: '' }))}
                className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer bg-slate-700 border border-dashed border-slate-500 rounded-lg px-3 py-2 text-slate-400 hover:text-white hover:border-slate-400 transition-colors text-sm w-full">
              {uploadingIndex === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {uploadingIndex === 'new' ? 'Uploading…' : 'Upload photo'}
              <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && handleImageUpload(e.target.files[0])} disabled={uploadingIndex !== null} />
            </label>
          )}
        </div>

        {addError && (
          <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
            {addError}
          </div>
        )}
        <Button onClick={addWaypoint} className="bg-green-600 hover:bg-green-700 gap-2 w-full text-white font-semibold">
          <Plus className="w-4 h-4" /> Save Key Point
        </Button>
        </div>}
      </div>

      {/* Existing waypoints */}
      {waypoints.length === 0 ? (
        <div className="text-center py-8 text-slate-500 border border-dashed border-slate-600 rounded-lg">
          No key points yet. Add important places above.
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="waypoints">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
          {waypoints.map((wp, index) => {
            const typeInfo = WAYPOINT_TYPES.find(t => t.value === wp.type);
            return (
              <Draggable key={index} draggableId={`wp-${index}`} index={index}>
                {(dragProvided, snapshot) => (
              <div
                ref={dragProvided.innerRef}
                {...dragProvided.draggableProps}
                className={`bg-slate-700/50 rounded-lg border border-slate-600 overflow-hidden ${snapshot.isDragging ? 'shadow-2xl shadow-amber-900/50 ring-2 ring-amber-500' : ''}`}
              >
                <div
                  className="flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-slate-700/80"
                  onClick={() => setExpanded(expanded === index ? null : index)}
                >
                  <div
                    {...dragProvided.dragHandleProps}
                    onClick={e => e.stopPropagation()}
                    className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 touch-none"
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-slate-600 font-mono w-5 text-center">{index + 1}</span>
                  <span className="text-sm">{typeInfo?.label.split(' ')[0]}</span>
                  <div className="flex-1 min-w-0">
                    {wp.code && (
                      <span className="font-mono text-xs bg-slate-600 text-amber-300 px-1.5 py-0.5 rounded font-bold mr-2">{wp.code}</span>
                    )}
                    <span className={wp.name ? "text-white font-medium" : "text-slate-500 italic"}>
                      {wp.name || 'No description yet'}
                    </span>
                    <span className={`ml-2 text-xs ${typeInfo?.color}`}>
                      {typeInfo?.label.split(' ').slice(1).join(' ')}
                    </span>
                    {wp.elevation != null && wp.elevation !== '' && (
                      <span className="ml-2 text-xs text-slate-400">{wp.elevation}m</span>
                    )}
                  </div>
                  {expanded === index ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  <Button
                    variant="ghost" size="icon"
                    onClick={e => { e.stopPropagation(); removeWaypoint(index); }}
                    className="text-slate-500 hover:text-red-400 w-7 h-7"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {expanded === index && (
                  <div className="px-4 pb-4 border-t border-slate-600 pt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-slate-400 text-xs mb-1 block">Latitude</Label>
                        <Input
                          type="number" step="0.000001"
                          value={wp.lat}
                          onChange={e => updateWaypoint(index, 'lat', parseFloat(e.target.value))}
                          className="bg-slate-700 border-slate-500 text-white font-mono h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-slate-400 text-xs mb-1 block">Longitude</Label>
                        <Input
                          type="number" step="0.000001"
                          value={wp.lng}
                          onChange={e => updateWaypoint(index, 'lng', parseFloat(e.target.value))}
                          className="bg-slate-700 border-slate-500 text-white font-mono h-8 text-sm"
                        />
                      </div>
                    </div>
                    {wp.code && (
                      <div>
                        <Label className="text-slate-400 text-xs mb-1 block">Code (auto-managed)</Label>
                        <div className="bg-slate-800 border border-slate-600 rounded h-8 flex items-center px-3 font-mono text-amber-300 text-sm">{wp.code}</div>
                      </div>
                    )}
                    <div>
                      <Label className="text-slate-400 text-xs mb-1 block">Name (optional description)</Label>
                      <Input
                        value={wp.name}
                        onChange={e => updateWaypoint(index, 'name', e.target.value)}
                        placeholder="e.g. Rocky descent"
                        className="bg-slate-700 border-slate-500 text-white h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs mb-1 block">Elevation (m)</Label>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => updateWaypoint(index, 'elevation', (parseInt(wp.elevation) || 0) - 10)} className="px-2 h-8 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm font-bold">−</button>
                        <button type="button" onClick={() => updateWaypoint(index, 'elevation', (parseInt(wp.elevation) || 0) - 1)} className="px-2 h-8 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm">-1</button>
                        <Input
                          type="number"
                          value={wp.elevation != null ? wp.elevation : ''}
                          onChange={e => updateWaypoint(index, 'elevation', e.target.value === '' ? null : parseInt(e.target.value))}
                          placeholder="e.g. 450"
                          className="bg-slate-700 border-slate-500 text-white h-8 text-sm text-center"
                        />
                        <button type="button" onClick={() => updateWaypoint(index, 'elevation', (parseInt(wp.elevation) || 0) + 1)} className="px-2 h-8 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm">+1</button>
                        <button type="button" onClick={() => updateWaypoint(index, 'elevation', (parseInt(wp.elevation) || 0) + 10)} className="px-2 h-8 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm font-bold">+</button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs mb-1 block">Description</Label>
                      <Textarea
                        value={wp.description}
                        onChange={e => updateWaypoint(index, 'description', e.target.value)}
                        rows={2}
                        className="bg-slate-700 border-slate-500 text-white resize-none text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs mb-1 block">Type</Label>
                      <Select value={wp.type} onValueChange={v => updateWaypoint(index, 'type', v)}>
                        <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WAYPOINT_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs mb-1 block">Photo</Label>
                      {wp.image_url ? (
                        <div className="relative w-full h-32 rounded-lg overflow-hidden border border-slate-600">
                          <img src={wp.image_url} alt="waypoint" className="w-full h-full object-cover" />
                          <button
                            onClick={() => updateWaypoint(index, 'image_url', '')}
                            className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white hover:bg-black/80"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-700 border border-dashed border-slate-500 rounded-lg px-3 py-2 text-slate-400 hover:text-white hover:border-slate-400 transition-colors text-sm w-full">
                          {uploadingIndex === index ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                          {uploadingIndex === index ? 'Uploading\u2026' : 'Upload photo'}
                          <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && handleImageUpload(e.target.files[0], index)} disabled={uploadingIndex !== null} />
                        </label>
                      )}
                    </div>
                    {onSave && (
                      <div className="pt-2 border-t border-slate-600">
                        <Button
                          onClick={onSave}
                          disabled={saving}
                          className="w-full bg-amber-500 hover:bg-amber-600 gap-2"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Save Walk
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
                )}
              </Draggable>
              );
              })}
                {provided.placeholder}
              </div>
              )}
              </Droppable>
              </DragDropContext>
              )}
              </div>
              );
              }