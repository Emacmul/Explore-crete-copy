import React, { useMemo } from 'react';
import { SpellCheck, AlertTriangle, Loader2 } from 'lucide-react';
import usePronunciationEntries from '@/lib/usePronunciationEntries';
import { findDictionaryMatches } from '@/lib/pronunciationMatches';

// Per Enda (2026-11-05): a master (English) tour is never translated, so the pronunciation
// dictionary never touched it — and nothing on screen told the admin which of the script's
// names the PCV narration will actually be checked against. This panel is that check: every
// word of this script that IS in the LinguaGloss dictionary is listed here in italic red,
// with its IPA right beside it, so the admin (and whoever records the clone voice) can see
// exactly what the dictionary says before the audio is made.
//
// It only reports; it never edits the script, so it is safe to leave on screen while
// typing, and it says so plainly when the dictionary can't be reached rather than showing
// an empty list that would read as "nothing to check".
export default function PronunciationCheckPanel({ text, language }) {
  const { entries, loading, error } = usePronunciationEntries();
  const matches = useMemo(
    () => findDictionaryMatches(text, entries, language),
    [text, entries, language]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking the pronunciation dictionary…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          The pronunciation dictionary couldn’t be read, so this check didn’t run.{' '}
          <span className="text-amber-300/80">{error}</span>
        </span>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
        <SpellCheck className="w-3.5 h-3.5" />
        No word in this script is in the pronunciation dictionary.
      </div>
    );
  }

  return (
    <div className="rounded border border-red-500/30 bg-red-500/5 p-2 space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <SpellCheck className="w-3.5 h-3.5 text-red-400" />
        <span>
          <span className="font-semibold text-red-400">{matches.length}</span>
          {' '}
          {matches.length === 1 ? 'word' : 'words'} in this script {matches.length === 1 ? 'is' : 'are'} in the
          pronunciation dictionary (italic red) — these are the pronunciations the narrated audio must use:
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {matches.map((m) => (
          <span key={m.word} className="text-xs">
            <span className="italic font-semibold text-red-400">{m.word}</span>
            {m.ipa && <span className="text-slate-400 font-mono ml-1">{m.ipa}</span>}
            {m.language && <span className="text-slate-500 ml-1">({m.language})</span>}
          </span>
        ))}
      </div>
    </div>
  );
}