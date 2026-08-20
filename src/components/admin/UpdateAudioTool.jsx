import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft, ChevronRight, Volume2, CheckCircle2, AlertTriangle,
  Upload, Loader2, X, Music,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';

// How far apart (in seconds) the replacement's duration may be from the current
// clip's before we flag it — the two are supposed to be near-identical (same
// script, same break tags, just a real PCV voice instead of the AI draft), so
// anything beyond this is worth a second look, but per Enda it should never
// block the actual replace — only the PCV output itself could ever be
// "wrong enough" to need a redo, and that's the Admin's call to make, not ours.
const DURATION_WARN_TOLERANCE_S = 1.0;

function formatDuration(s) {
  if (s == null || Number.isNaN(s)) return '—';
  return `${s.toFixed(1)}s`;
}

// Reads the playable duration of an audio URL (remote or a local object URL)
// without needing the full Web Audio API — a plain <audio> element firing
// loadedmetadata is enough just to read .duration.
function getAudioDuration(src) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => reject(new Error('Could not read this audio file’s duration.'));
    audio.src = src;
  });
}

function TourPicker({ tours, onSelect }) {
  if (tours.length === 0) {
    return (
      <div className="text-center py-10 text-slate-500 border border-dashed border-slate-700 rounded-lg">
        No tours are waiting on this right now. A tour shows up here once a Narrator has
        marked it finished and an Admin has reviewed it, or once an Admin is building a
        tour directly — either way, before it’s published.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {tours.map((walk) => {
        const audioWaypoints = (walk.waypoints || []).filter(wp => wp.trigger_audio);
        const doneCount = audioWaypoints.filter(wp => wp.final_audio_applied).length;
        const allDone = audioWaypoints.length > 0 && doneCount === audioWaypoints.length;
        return (
          <button
            key={walk.id}
            onClick={() => onSelect(walk)}
            className="w-full flex items-center gap-3 bg-slate-800 border border-slate-700 hover:border-blue-600/50 hover:bg-slate-700/60 rounded-xl px-4 py-3 transition-colors text-left"
          >
            <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
            {walk.target_language && (
              <Badge className="text-xs bg-purple-900 text-purple-300 border-purple-700 shrink-0">{walk.target_language}</Badge>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white truncate">{walk.name}</p>
              <p className="text-xs text-slate-500 truncate">
                {walk.assigned_narrator_email ? `By ${walk.assigned_narrator_email} · ` : ''}
                {audioWaypoints.length === 0
                  ? 'No audio-triggered waypoints'
                  : `${doneCount}/${audioWaypoints.length} waypoints updated`}
              </p>
            </div>
            {audioWaypoints.length > 0 && (
              allDone
                ? <Badge className="bg-emerald-900/50 text-emerald-300 border-emerald-700 shrink-0 gap-1"><CheckCircle2 className="w-3 h-3" /> Ready to publish</Badge>
                : <Badge className="bg-amber-900/40 text-amber-300 border-amber-700 shrink-0 gap-1"><AlertTriangle className="w-3 h-3" /> Needs audio</Badge>
            )}
            <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function WaypointRow({ wp, index, onReplaceAudio }) {
  const [pending, setPending] = useState(null); // { file, objectUrl, newDuration, oldDuration }
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (pending?.objectUrl) URL.revokeObjectURL(pending.objectUrl); }, [pending]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const [newDuration, oldDuration] = await Promise.all([
        getAudioDuration(objectUrl),
        wp.audio_clip_url ? getAudioDuration(wp.audio_clip_url).catch(() => null) : Promise.resolve(null),
      ]);
      setPending({ file, objectUrl, newDuration, oldDuration });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not read that file', description: err.message });
      URL.revokeObjectURL(objectUrl);
    }
    setReading(false);
  };

  const handleCancel = () => {
    if (pending?.objectUrl) URL.revokeObjectURL(pending.objectUrl);
    setPending(null);
  };

  const handleConfirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: pending.file });
      await onReplaceAudio(index, file_url);
      toast({ title: 'Audio updated', description: `${wp.segment_id || `Waypoint ${index + 1}`} now has its final narration.` });
      if (pending.objectUrl) URL.revokeObjectURL(pending.objectUrl);
      setPending(null);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Update failed', description: err.message });
    }
    setBusy(false);
  };

  const isDone = !!wp.final_audio_applied;
  const diff = pending && pending.oldDuration != null ? Math.abs(pending.newDuration - pending.oldDuration) : null;
  const showDurationWarning = diff != null && diff > DURATION_WARN_TOLERANCE_S;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isDone ? 'bg-emerald-950/20 border-emerald-800/50' : 'bg-slate-800 border-slate-700'}`}>
      <div className="flex items-center gap-3">
        <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: wp.waypoint_colour || '#64748b' }} />
        <div className="flex-1 min-w-0">
          <span className="text-white font-medium">{wp.segment_id || `Point ${index + 1}`}</span>
          {wp.segment_title && <span className="ml-2 text-xs text-slate-400">{wp.segment_title}</span>}
        </div>
        {isDone ? (
          <Badge className="bg-emerald-900/50 text-emerald-300 border-emerald-700 gap-1 shrink-0"><CheckCircle2 className="w-3 h-3" /> Final audio applied</Badge>
        ) : (
          <Badge className="bg-amber-900/40 text-amber-300 border-amber-700 gap-1 shrink-0"><AlertTriangle className="w-3 h-3" /> AI draft — needs update</Badge>
        )}
      </div>

      <div className="flex items-center gap-3 pl-6 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Music className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          {wp.audio_clip_url
            ? <audio controls src={wp.audio_clip_url} className="h-8" style={{ maxWidth: 260 }} />
            : <span className="text-xs text-slate-500">No audio yet</span>}
        </div>

        {!pending ? (
          <label className={`flex items-center gap-1.5 cursor-pointer bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 rounded-lg px-3 py-1.5 text-amber-400 hover:text-amber-300 transition-colors text-xs font-medium ${reading ? 'opacity-60 pointer-events-none' : ''}`}>
            {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {reading ? 'Reading…' : 'Replace with PCV audio'}
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" className="hidden" onChange={handleFileSelect} />
          </label>
        ) : (
          <div className="flex items-center gap-2 flex-wrap bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-300 truncate max-w-[160px]" title={pending.file.name}>{pending.file.name}</span>
            <span className="text-xs text-slate-500">
              {formatDuration(pending.oldDuration)} → {formatDuration(pending.newDuration)}
            </span>
            {showDurationWarning && (
              <span className="flex items-center gap-1 text-xs text-amber-400" title="Duration differs from the current clip by more than 1s — you can still proceed.">
                <AlertTriangle className="w-3.5 h-3.5" /> {diff.toFixed(1)}s different
              </span>
            )}
            <Button size="sm" disabled={busy} onClick={handleConfirm} className="h-7 bg-emerald-600 hover:bg-emerald-700 text-xs gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Confirm & Save
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={handleCancel} className="h-7 text-slate-400 hover:text-white text-xs gap-1">
              <X className="w-3.5 h-3.5" /> Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Admin-only tool: replace each waypoint's system/AI-generated draft narration
 * with the final PCV (Professional Cloned Voice) audio — from whichever lab is
 * currently producing it — once a tour is ready and before it's published for
 * purchase. Covers both a Narrator's finished tour (checked over by an Admin)
 * and a master tour an Admin builds directly; same rule either way.
 *
 * Reuses BackendShell's existing saveWalkForBackend plumbing — `onReplaceAudio`
 * is expected to persist { audio_clip_url, final_audio_applied: true } on the
 * given waypoint and update local walks state, same pattern as every other
 * handler in BackendShell (handleSave, handleToggleFree, etc.).
 *
 * `tours` is expected to already be scoped to "not yet published" — BackendShell
 * passes its `audioUpdateTours` list (Narrator clones awaiting review + master
 * tours still in draft), so this tool only ever shows tours that genuinely still
 * need this step.
 */
export default function UpdateAudioTool({ tours, onReplaceAudio }) {
  const [selectedId, setSelectedId] = useState(null);
  const selectedWalk = tours.find(w => w.id === selectedId) || null;

  if (!selectedWalk) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Volume2 className="w-5 h-5 text-amber-400" /> Update Audio</h2>
          <p className="text-sm text-slate-400 mt-1">
            Replace each waypoint's AI-generated draft narration with the final PCV
            (Professional Cloned Voice) audio. A tour can't be published until every
            audio-triggered waypoint here is marked done.
          </p>
        </div>
        <TourPicker tours={tours} onSelect={(w) => setSelectedId(w.id)} />
      </div>
    );
  }

  const audioWaypoints = (selectedWalk.waypoints || [])
    .map((wp, index) => ({ wp, index }))
    .filter(({ wp }) => wp.trigger_audio);
  const doneCount = audioWaypoints.filter(({ wp }) => wp.final_audio_applied).length;
  const allDone = audioWaypoints.length > 0 && doneCount === audioWaypoints.length;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} className="text-slate-300 hover:text-white gap-2 -ml-2">
        <ChevronLeft className="w-4 h-4" /> Back to tours
      </Button>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold">{selectedWalk.code}</span>
        <h2 className="text-lg font-bold text-white">{selectedWalk.name}</h2>
        {selectedWalk.target_language && <Badge className="text-xs bg-purple-900 text-purple-300 border-purple-700">{selectedWalk.target_language}</Badge>}
      </div>

      <div className={`rounded-lg border px-4 py-3 text-sm ${allDone ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300' : 'bg-amber-950/20 border-amber-800/50 text-amber-300'}`}>
        {audioWaypoints.length === 0
          ? 'This tour has no audio-triggered waypoints.'
          : allDone
            ? <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> All {audioWaypoints.length} waypoints have their final audio — ready to publish.</span>
            : <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {doneCount}/{audioWaypoints.length} waypoints updated — the rest still have the AI draft. Publishing is blocked until all of them are done.</span>}
      </div>

      <div className="space-y-2">
        {audioWaypoints.map(({ wp, index }) => (
          <WaypointRow
            key={index}
            wp={wp}
            index={index}
            onReplaceAudio={(idx, url) => onReplaceAudio(selectedWalk.id, idx, url)}
          />
        ))}
      </div>
    </div>
  );
}
