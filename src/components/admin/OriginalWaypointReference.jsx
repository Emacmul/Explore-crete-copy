import React from 'react';
import { FileText } from 'lucide-react';

/**
 * Read-only English original, shown above a walking clone's editable Name/Description.
 *
 * Per Enda (2026-11-05): a Hebrew/Arabic narrator translating a Walk/Hike (WHT) clone
 * only ever saw the ALREADY-TRANSLATED text — clone creation fills every waypoint name
 * and description automatically — with no way to check it against the English master
 * they were translating. The narration-side reference box (OriginalScriptReference)
 * never helped here, because a plain walk has no narration script to show: its whole
 * translatable text is these waypoint name/description fields.
 *
 * Deliberately not a field of any kind: plain text in a dark panel, so it can never be
 * edited or mistaken for the yellow editable boxes below. Forced to dir="ltr" — it's
 * English, even inside an RTL clone's `rtl-fields` wrapper.
 *
 * `original` is the matching master waypoint ({ name, description }); it can be null
 * while the tour list is still loading or if the master isn't reachable, in which case
 * a short explanation is shown instead of an empty gap.
 */
export default function OriginalWaypointReference({ original }) {
  const name = String(original?.name || '').trim();
  const description = String(original?.description || '').trim();

  return (
    <div className="rounded-md border border-slate-600/60 bg-slate-900/70 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-slate-300 text-xs font-medium">
          Original English (reference only — cannot be edited)
        </span>
      </div>
      {!original ? (
        <p className="text-xs text-slate-500">The English original for this stop could not be loaded.</p>
      ) : (
        <>
          {name && (
            <p dir="ltr" className="text-xs text-slate-300">
              <span className="text-slate-500">Name: </span>{name}
            </p>
          )}
          {description ? (
            <p dir="ltr" className="text-xs text-slate-400 whitespace-pre-wrap">{description}</p>
          ) : (
            <p className="text-xs text-slate-500">No English description is stored for this stop.</p>
          )}
        </>
      )}
    </div>
  );
}