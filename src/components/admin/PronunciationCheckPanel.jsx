import React, { useMemo, useState } from 'react';
import { SpellCheck, AlertTriangle, Loader2, Pencil, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import usePronunciationEntries from '@/lib/usePronunciationEntries';
import { findDictionaryMatches, findUnlistedScriptWords } from '@/lib/pronunciationMatches';
import PronunciationEntryForm from './PronunciationEntryForm';

// Per Enda (2026-11-05, clarified): the pronunciation dictionary does two things for a
// script, and this panel serves both.
//  1. Every word here is PROTECTED — translation swaps it out before it reaches the
//     translation engine (see base44/shared/pronunciationProtect.ts), so a clone in
//     German, Greek, Hebrew… keeps the name exactly as written in the master instead of
//     translating it. That is why the words are shown in italic red on the script itself.
//  2. It is the check the PCV narrator records from: the ElevenLabs voice reads the
//     dictionary directly, so an admin needs to see, before the audio is made, that every
//     name in this script is actually in it — and be able to add the missing ones or fix a
//     wrong entry on the spot, without leaving the script.
//
// Refresh re-reads the dictionary: names are often added in LinguaGloss while this editor
// is already open, and without that the check kept calling a word missing that had just
// been added.
//
// The script text is never altered here: this only reads it and edits the dictionary.
export default function PronunciationCheckPanel({ text, language }) {
  const { entries, languages, loading, refreshing, error, reload } = usePronunciationEntries();
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(null); // prefill word, or '' for a blank form

  const matches = useMemo(
    () => findDictionaryMatches(text, entries, language),
    [text, entries, language]
  );
  // Names the dictionary doesn't carry yet — written in another script (Greek, Cyrillic,
  // Hebrew, Arabic) or with Turkish/accented letters. Those would otherwise be translated
  // away and mispronounced in the recording.
  const unlisted = useMemo(() => findUnlistedScriptWords(text, entries), [text, entries]);

  const handleSaved = () => {
    setEditingId(null);
    setAdding(null);
    reload();
  };

  // Nothing written yet — nothing to check, and the dictionary window is available elsewhere.
  if (!text || !text.trim()) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking the pronunciation dictionary…
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            The pronunciation dictionary couldn’t be read, so this check didn’t run.{' '}
            <span className="text-amber-300/80">{error}</span>
          </span>
        </div>
        <RefreshButton refreshing={refreshing} onClick={reload} />
      </div>
    );
  }

  return (
    <div className="rounded border border-red-500/30 bg-red-500/5 p-2 space-y-2">
      <div className="flex items-start gap-2 text-xs text-slate-300">
        <SpellCheck className="w-3.5 h-3.5 mt-0.5 text-red-400 flex-shrink-0" />
        <span className="flex-1">
          {matches.length > 0 ? (
            <>
              <span className="font-semibold text-red-400">{matches.length}</span>{' '}
              {matches.length === 1 ? 'word' : 'words'} in this script {matches.length === 1 ? 'is' : 'are'} in the
              pronunciation dictionary (italic red). These are kept exactly as written when the tour is
              translated, and the recording must use the pronunciation shown:
            </>
          ) : (
            <>No word in this script is in the pronunciation dictionary yet.</>
          )}
        </span>
        <RefreshButton refreshing={refreshing} onClick={reload} />
      </div>

      {error && (
        <p className="text-[11px] text-amber-300">
          Last refresh failed — showing the list loaded earlier. {error}
        </p>
      )}

      {matches.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {matches.map((m) => (
            <span key={m.id || m.word} className="text-xs inline-flex items-center gap-1">
              <span className="italic font-semibold text-red-400">{m.word}</span>
              {m.ipa && <span className="text-slate-400 font-mono">{m.ipa}</span>}
              {m.language && <span className="text-slate-500">({m.language})</span>}
              <button
                type="button"
                title="Edit this entry in the dictionary"
                onClick={() => { setAdding(null); setEditingId(editingId === m.id ? null : m.id); }}
                className="text-slate-500 hover:text-slate-200"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {editingId && (
        <PronunciationEntryForm
          initial={entries.find((e) => e.id === editingId) || {}}
          languages={languages}
          onSaved={handleSaved}
          onCancel={() => setEditingId(null)}
        />
      )}

      {unlisted.length > 0 && (
        <div className="space-y-1 border-t border-red-500/20 pt-2">
          <p className="text-xs text-amber-300">
            Not in the dictionary yet — add each name so it survives translation and the narrator
            pronounces it correctly:
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {unlisted.map((w) => (
              <span key={w} className="text-xs inline-flex items-center gap-1">
                <span className="italic font-semibold text-amber-200">{w}</span>
                <button
                  type="button"
                  title="Add this word to the dictionary"
                  onClick={() => { setEditingId(null); setAdding(w); }}
                  className="text-amber-400 hover:text-amber-200"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {adding === null ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px] text-slate-400 hover:text-slate-100"
          onClick={() => { setEditingId(null); setAdding(''); }}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add a word to the dictionary
        </Button>
      ) : (
        <PronunciationEntryForm
          initial={{ original_word: adding }}
          languages={languages}
          onSaved={handleSaved}
          onCancel={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function RefreshButton({ refreshing, onClick }) {
  return (
    <button
      type="button"
      title="Re-read the dictionary — pick up words added in LinguaGloss"
      onClick={onClick}
      disabled={refreshing}
      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-100 disabled:opacity-60"
    >
      <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
      Refresh
    </button>
  );
}