import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Play, Clock, Type, Loader2, Volume2, Pencil, X, Check } from 'lucide-react';

// Per Anoushka, a narrator (relayed by Enda — see CLAUDE_CHANGELOG.md for the full
// request): the whole point of a narration line is that it's language for the EAR, not
// the eye, so a narrator needs to hear each line to properly judge/fix it. Before this,
// the ONLY way to fix one line's wording was the big combined script box further down
// in NarrationTtsEditor.jsx, which edits the WHOLE run of several lines at once and only
// actually takes effect on Continue/Save & Finish — meaning a narrator who spotted one
// mistake right after Parse & Generate had to either sit through the full sequential
// Build & Play first, or edit that big box before ever pressing Continue, which was a
// real bug (see commitSegmentEdit/playSegment in NarrationTtsEditor.jsx for the full
// story — editing that way, before Continue had ever run once, could end up with two
// audios playing at the same time).
//
// isEditing/editValue/onEditChange/onToggleEdit/onCancelEdit/onSaveEdit/isSavingEdit
// add a small, self-contained "fix just this line" editor right on this card: click the
// pencil, the line's OWN text (and only this line's text) appears in an editable box,
// fix it, click "Save this line" — done, independent of every other line and without
// touching Continue/Save & Finish/Parse & Generate at all. onToggleEdit is only ever
// passed in for text-type segments (a pause has nothing to "edit" beyond its own
// duration slider, already right here).
//
// controlsDisabled (renamed from playDisabled during the follow-up 23 audit, since it
// now also governs the pause Slider below, not just the Play button) means "something
// elsewhere on the panel has the floor right now" — playback, a whole-subsection
// commit, a render/upload, or another line's own save. editToggleDisabled is a
// SEPARATE, narrower flag: true only while a DIFFERENT line's quick editor is already
// open (or controlsDisabled is true) — kept apart from controlsDisabled so listening to
// (or nudging the pause after) a different line is never blocked just because one
// line's editor happens to be open elsewhere, while still making it impossible to open
// a second editor and silently lose whatever was typed into the first one.
export default function TtsSegmentCard({
  segment,
  audioUrl,
  isGenerating,
  isPlaying,
  onPlay,
  onDurationChange,
  controlsDisabled = false,
  isEditing = false,
  editValue = '',
  onEditChange,
  onToggleEdit,
  editToggleDisabled = false,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
}) {
  if (segment.type === 'text') {
    return (
      <div className={`bg-slate-800 rounded-lg border p-3 transition-colors ${
        isPlaying ? 'border-purple-500 bg-purple-900/20' : isEditing ? 'border-blue-600/50' : 'border-slate-600'
      }`}>
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
            <Type className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{segment.content}</p>
            <p className="text-xs text-slate-500 mt-1">{segment.content.length} characters</p>
          </div>
          <button
            type="button"
            onClick={() => onPlay(segment.id)}
            disabled={!audioUrl || isGenerating || controlsDisabled}
            title="Play just this line"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-700 disabled:opacity-30 transition-colors"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            ) : isPlaying ? (
              <Volume2 className="w-4 h-4 text-purple-400" />
            ) : (
              <Play className="w-4 h-4 text-slate-400" />
            )}
          </button>
          {onToggleEdit && (
            <button
              type="button"
              onClick={onToggleEdit}
              // isSavingEdit is checked unconditionally (not just "when opening a new
              // one") so this line's own editor can't be hidden mid-save — closing it
              // used to make the "Saving…" state disappear from view even though the
              // save was still genuinely running in the background (follow-up 23 audit,
              // Bug F). Opening a DIFFERENT line's editor is still only blocked while
              // this one isn't already the one open (editToggleDisabled) — see the
              // comment above this component for why that's a separate flag from
              // controlsDisabled.
              disabled={isSavingEdit || (!isEditing && editToggleDisabled)}
              title={isEditing ? 'Close without saving' : 'Fix just this line'}
              className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                isEditing ? 'bg-blue-700/50 text-blue-300' : 'hover:bg-slate-700 text-slate-400'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {isEditing && (
          <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
            <Textarea
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              rows={3}
              autoFocus
              className="bg-amber-100 border-amber-300 text-black placeholder:text-amber-900/50 text-sm font-mono resize-y focus-visible:ring-amber-400"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={isSavingEdit}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-slate-200 disabled:opacity-40 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={isSavingEdit}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors"
              >
                {isSavingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {isSavingEdit ? 'Saving…' : 'Save this line'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-slate-800 rounded-lg border p-3 transition-colors ${
      isPlaying ? 'border-amber-500 bg-amber-900/10' : 'border-slate-600'
    }`}>
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-slate-400">Pause</span>
            <span className="text-xs font-medium text-amber-400">{segment.duration.toFixed(1)}s</span>
          </div>
          <Slider
            value={[segment.duration]}
            min={0.1}
            max={120}
            step={0.1}
            onValueChange={(val) => onDurationChange(segment.id, val[0])}
            // Per the follow-up 23 audit (Bug B): dragging this while ANY commit/save/
            // render is in flight elsewhere on the panel used to apply live (via a
            // functional setState update) but then get silently overwritten the moment
            // that other operation finished — it captures/writes a plain, non-functional
            // `segments` snapshot from before the drag happened. Locked for the same
            // window every other mutating control on the panel already locks for.
            disabled={controlsDisabled}
          />
          <div className="flex justify-between mt-0.5">
            <span className="text-[10px] text-slate-600">0.1s</span>
            <span className="text-[10px] text-slate-600">120s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
