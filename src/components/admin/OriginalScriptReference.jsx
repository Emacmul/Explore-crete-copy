import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Trash2, Loader2 } from 'lucide-react';

// Per Enda (2026-11-05): an RTL narrator had no way to see the English master script while
// writing or fixing their own translation — Translate & Load put the translation on screen
// and the English they were working from was gone. This sits directly ABOVE the RTL script
// box with the original text, so the two can be compared line for line, and can be removed
// with one click once the narrator is happy with their translation.
//
// Deliberately NOT a text field of any kind: plain text in a dark panel, so it can never be
// edited or mistaken for one of the yellow editable script boxes. Its text is always
// left-to-right (it's English) even inside an RTL clone's `rtl-fields` wrapper — hence the
// explicit dir="ltr".
//
// Per Enda's follow-up (2026-11-05): shown for every RTL waypoint, not only once text has
// arrived — with a loading line while the master script is being fetched, and a plain
// explanation when the original tour has no English script stored for this stop at all.
// Before that, a waypoint whose English happened to be missing simply showed nothing, so
// the whole reference feature looked like it wasn't there.
export default function OriginalScriptReference({ text, loading = false, onRemove }) {
  const hasText = !!String(text || '').trim();

  return (
    <div className="bg-slate-900/70 rounded-md border border-slate-600/60 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-slate-300 text-xs font-medium">
          Original English (reference only — cannot be edited)
        </span>
        {hasText && onRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemove}
            className="ml-auto h-6 px-2 text-xs gap-1 text-slate-400 hover:text-red-300 hover:bg-red-900/30"
            title="Remove this after you're happy with the translation"
          >
            <Trash2 className="w-3 h-3" /> Remove original
          </Button>
        )}
      </div>
      {loading && !hasText ? (
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading the English original…
        </p>
      ) : hasText ? (
        <p dir="ltr" className="text-xs text-slate-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
          {text}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          No English script is stored for this stop yet — import the source file to work from it below.
        </p>
      )}
    </div>
  );
}