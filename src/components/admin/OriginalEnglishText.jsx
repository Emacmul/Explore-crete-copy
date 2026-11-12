import React from 'react';
import { FileText } from 'lucide-react';

// Read-only English original shown above an editable translated box.
//
// Plain text in a dark panel, never a field of any kind, so it can never be edited or
// mistaken for one of the yellow editable boxes below it. Forced to dir="ltr" — it's
// English, even inside an RTL clone's `rtl-fields` wrapper.
//
// `unavailable` covers the best-effort master lookup failing (a very fresh clone whose
// master isn't in the tour list yet); `empty` is shown when the master genuinely has no
// English text stored for this particular field.
export default function OriginalEnglishText({ text, unavailable = false, empty = 'No English text is stored for this field.' }) {
  const value = String(text || '').trim();
  return (
    <div className="rounded-md border border-slate-600/60 bg-slate-900/70 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-slate-300 text-xs font-medium">
          Original English (reference only — cannot be edited)
        </span>
      </div>
      {unavailable ? (
        <p className="text-xs text-slate-500">The English original could not be loaded.</p>
      ) : value ? (
        <p dir="ltr" className="text-xs text-slate-400 whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-xs text-slate-500">{empty}</p>
      )}
    </div>
  );
}