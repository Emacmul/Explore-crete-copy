import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Upload, FileCheck, Loader2, Trash2, Volume2, Compass, Play } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Renders GPS audio trigger fields for a driving tour waypoint.
 *
 * Fields:
 *   - Trigger Audio (toggle)
 *   - Audio Clip (upload)
 *   - Trigger Radius (metres)
 *   - Trigger Once (toggle)
 *   - Use Bearing (toggle)
 *   - Bearing Direction (0–359°)
 *   - Bearing Tolerance (default 30°)
 *
 * Props:
 *   wp       – the waypoint object
 *   onChange – (field, value) callback
 */
export default function AudioTriggerFields({ wp, onChange }) {
  const [uploading, setUploading] = useState(false);

  const handleAudioUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange('audio_clip_url', file_url);
    } catch (err) {
      console.warn('Audio upload failed:', err);
    }
    setUploading(false);
    e.target.value = '';
  };

  // Compute the valid bearing range for display
  const bearingDir = Number(wp.bearing_direction) || 0;
  const tolerance = Number(wp.bearing_tolerance) || 30;
  const min = ((bearingDir - tolerance) % 360 + 360) % 360;
  const max = ((bearingDir + tolerance) % 360 + 360) % 360;

  return (
    <div className="bg-slate-800/50 rounded-lg border border-purple-600/30 p-3 space-y-3">
      {/* Trigger Audio toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-purple-400" />
          <Label className="text-slate-300 text-sm font-medium cursor-pointer">Trigger Audio</Label>
        </div>
        <Switch
          checked={wp.trigger_audio || false}
          onCheckedChange={v => onChange('trigger_audio', v)}
        />
      </div>

      {wp.trigger_audio && (
        <div className="space-y-3 pl-1">
          {/* Audio Clip upload */}
          <div>
            <Label className="text-slate-400 text-xs mb-1 block">Audio Clip</Label>
            {wp.audio_clip_url ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2">
                  <FileCheck className="w-4 h-4 text-green-400 shrink-0" />
                  <span className="text-green-300 text-sm flex-1 truncate">Audio clip uploaded</span>
                  <audio controls src={wp.audio_clip_url} className="h-7" />
                  <button
                    type="button"
                    onClick={() => onChange('audio_clip_url', '')}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                    title="Remove audio"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <label className={`flex items-center gap-2 cursor-pointer bg-slate-700 border border-dashed border-slate-500 rounded-lg px-3 py-2 text-slate-400 hover:text-white hover:border-purple-500/50 transition-colors text-sm w-full ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Uploading…' : 'Upload audio clip (mp3, wav, m4a)'}
                <input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" className="hidden" onChange={handleAudioUpload} />
              </label>
            )}
          </div>

          {/* Trigger Radius + Trigger Once */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-400 text-xs mb-1 block">Trigger Radius (m)</Label>
              <Input
                type="number" min="10" max="2000" step="10"
                value={wp.trigger_radius_m ?? 30}
                onChange={e => onChange('trigger_radius_m', e.target.value === '' ? 30 : Number(e.target.value))}
                className="bg-slate-700 border-slate-500 text-white h-8 text-sm"
              />
            </div>
            <div className="flex items-center justify-between pt-4">
              <Label className="text-slate-400 text-xs">Trigger Once</Label>
              <Switch
                checked={wp.trigger_once ?? true}
                onCheckedChange={v => onChange('trigger_once', v)}
              />
            </div>
          </div>
          {!wp.trigger_once && (
            <p className="text-xs text-amber-400/80">Audio will replay each time the user re-enters the geofence.</p>
          )}

          {/* Bearing toggle */}
          <div className="border-t border-slate-700 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-amber-400" />
                <Label className="text-slate-300 text-sm font-medium cursor-pointer">Use Bearing</Label>
              </div>
              <Switch
                checked={wp.use_bearing || false}
                onCheckedChange={v => onChange('use_bearing', v)}
              />
            </div>

            {wp.use_bearing && (
              <div className="space-y-2 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-slate-400 text-xs mb-1 block">Bearing Direction (0–359°)</Label>
                    <Input
                      type="number" min="0" max="359"
                      value={wp.bearing_direction ?? 0}
                      onChange={e => onChange('bearing_direction', e.target.value === '' ? 0 : Math.max(0, Math.min(359, Number(e.target.value))))}
                      className="bg-slate-700 border-slate-500 text-white h-8 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400 text-xs mb-1 block">Bearing Tolerance (°)</Label>
                    <Input
                      type="number" min="0" max="180"
                      value={wp.bearing_tolerance ?? 30}
                      onChange={e => onChange('bearing_tolerance', e.target.value === '' ? 30 : Math.max(0, Math.min(180, Number(e.target.value))))}
                      className="bg-slate-700 border-slate-500 text-white h-8 text-sm font-mono"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800 rounded px-2 py-1.5">
                  <span>Valid range:</span>
                  <code className="text-amber-300 font-mono">{min}°</code>
                  <span>→</span>
                  <code className="text-amber-300 font-mono">{max}°</code>
                  {min > max && <span className="text-slate-500">(crosses 0°/360°)</span>}
                </div>
                <p className="text-xs text-slate-500">
                  Bearing is computed from the user's recent GPS movement, not the phone compass.
                  Audio fires only when movement direction falls within the range above.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}