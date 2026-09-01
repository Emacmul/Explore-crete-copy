import React, { useState, useRef } from 'react';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Play, Clock, Type, Loader2, Volume2, Pencil, X, Check, MapPin, Trash2, BookOpen } from 'lucide-react';
import PronunciationDictionaryDialog from './PronunciationDictionaryDialog';

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
//
// needsListenBeforeEdit/isLastEdited (follow-up 32, per Enda): needsListenBeforeEdit is
// folded into editToggleDisabled by the parent already (this line's pencil genuinely
// can't be clicked until its own clip has played through in full this pass — "the
// first, fifth, or 10th editing attempt", every time, not just once) — passed here
// separately, purely so the right explanation can be shown for WHY the pencil is
// locked, distinct from every other reason editToggleDisabled can be true. isLastEdited
// is unrelated to any of that — a pure "you left off here" bookmark on whichever
// line was most recently saved, so a narrator coming back from a break can find their
// place again in a segment with a dozen-plus lines. Per Enda: "not to entice them to
// edit again, or to block further editing" — so it's shown as plain, muted text, never
// styled like a clickable action.
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
  needsListenBeforeEdit = false,
  isLastEdited = false,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit = false,
  onRemove,
}) {
  // Per Anoushka/Enda: before this, the ONLY way to remove a pause entirely was to
  // scroll down to the big combined script box further down this panel, find the
  // right <break> tag among however many others are in it, and delete it there — slow,
  // risked deleting the WRONG one once a script had several pauses, and broke a
  // narrator's editing flow every time they needed it. onRemove (only ever passed for
  // a pause segment — see NarrationTtsEditor.jsx's call site) puts a real "delete this
  // one" control right on the card whose duration it already controls. confirmingRemove
  // is local to this one card, not shared state, so confirming one pause's removal can
  // never be accidentally triggered by clicking a DIFFERENT card's trash icon first.
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Per Enda: LinguaGloss (his separate pronunciation-dictionary app for PCV audio) can now
  // handle every language, but only if the tour script uses the EXACT same spelling —
  // original language, e.g. Greek in Greek script — as the dictionary. The Dictionary
  // button opens a pop-up to check/fix that, right on this line, without breaking a
  // narrator's editing flow any more than the pencil ("fix just this line") already does.
  // Always clickable (checking a word is harmless even when this line's own editor isn't
  // open) — but Insert (splicing the dictionary's exact spelling into THIS line) is only
  // offered while this line's quick-editor is already open, i.e. already unlocked the
  // normal way; see insertAtCursor below.
  const [dictOpen, setDictOpen] = useState(false);
  const editTextareaRef = useRef(null);

  const insertAtCursor = (word) => {
    const el = editTextareaRef.current;
    if (!el) {
      onEditChange((editValue ? editValue.replace(/\s+$/, '') + ' ' : '') + word);
      return;
    }
    const start = el.selectionStart ?? editValue.length;
    const end = el.selectionEnd ?? editValue.length;
    const next = editValue.slice(0, start) + word + editValue.slice(end);
    onEditChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + word.length;
      el.setSelectionRange(pos, pos);
    });
  };

  if (segment.type === 'text') {
    return (
      <>
      <div className={`bg-slate-800 rounded-lg border p-3 transition-colors ${
        isPlaying ? 'border-purple-500 bg-purple-900/20' : isEditing ? 'border-blue-600/50' : 'border-slate-600'
      }`}>
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
            <Type className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            {isLastEdited && !isEditing && (
              <p className="text-[11px] text-purple-300/90 flex items-center gap-1 mb-1">
                <MapPin className="w-3 h-3" /> Edit again — this is where you left off
              </p>
            )}
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
          <button
            type="button"
            onClick={() => setDictOpen(true)}
            title="Check the pronunciation dictionary"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-700 text-slate-400 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
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
              title={
                isEditing
                  ? 'Close without saving'
                  : needsListenBeforeEdit
                    ? 'Play this line, start to finish, before you can edit it'
                    : 'Fix just this line'
              }
              className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                isEditing ? 'bg-blue-700/50 text-blue-300' : 'hover:bg-slate-700 text-slate-400'
              }`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Per Enda's follow-up 32 request: "irrespective of this being the first,
            fifth or 10th editing attempt" — spelled out here the same way every other
            locked control on this panel explains itself, rather than leaving the
            pencil greyed out with no reason given. */}
        {!isEditing && needsListenBeforeEdit && (
          <p className="text-xs text-amber-500/80 mt-1 ml-10">
            Play this line, start to finish, before you can edit it.
          </p>
        )}

        {isEditing && (
          <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
            <Textarea
              ref={editTextareaRef}
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
      <PronunciationDictionaryDialog
        open={dictOpen}
        onClose={() => setDictOpen(false)}
        onInsert={isEditing ? insertAtCursor : undefined}
      />
      </>
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
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-amber-400">{segment.duration.toFixed(1)}s</span>
              {onRemove && !confirmingRemove && (
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(true)}
                  disabled={controlsDisabled}
                  title="Remove this pause completely"
                  className="text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {confirmingRemove ? (
            <div className="flex items-center justify-between gap-2 bg-red-900/20 border border-red-700/50 rounded-md px-2.5 py-2">
              <span className="text-xs text-red-300">Remove this pause? This can't be undone.</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-slate-200"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmingRemove(false); onRemove(segment.id); }}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-700/40 hover:bg-red-700/60 border border-red-600/50 text-red-100"
                >
                  <Check className="w-3 h-3" /> Yes, remove
                </button>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
