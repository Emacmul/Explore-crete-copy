import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Languages, Loader2 } from 'lucide-react';
import AutoGrowTextarea from '@/components/admin/AutoGrowTextarea';
import WaypointEnglishReference from '@/components/admin/WaypointEnglishReference';
import { stillMatchesMaster } from '@/lib/fieldTranslation';

// A translation clone's stop name and short description — the two fields a customer sees
// in the app's "Tour Stops" list and while driving. Auto-translated the moment this stop is
// opened (useStopFieldTranslation); this panel is where the narrator checks and corrects
// that draft, same "Translate" + editable-box pattern used for the tour's Description /
// Safety Notes and for narration scripts.
//
// Per Enda (2026-11-24): in a Hebrew/Arabic clone the read-only English original now sits
// above each box (WaypointEnglishReference), so the narrator keeps both on screen and
// writes the translation into its own box instead of overwriting the English in place.
// Extracted out of TourSimulator.jsx (which is at the platform's editable size limit) —
// behaviour is unchanged.
export default function StopTextTranslationPanel({
  form, selectedWp, selectedWpIndex, toRawIndex, onWaypointUpdate,
  masterWp, translateStopField, translatingStopField, stopFieldError,
}) {
  if (!selectedWp || !form.clone_of) return null;

  const notYetTranslated = (field) =>
    form.target_language
    && form.target_language !== 'English'
    && masterWp
    && stillMatchesMaster(selectedWp[field], masterWp[field]);

  const translateButton = (field, what) => form.target_language && (
    <Button
      type="button" size="sm" variant="outline"
      onClick={() => translateStopField(field)}
      disabled={translatingStopField === field}
      title={`Translate this stop's ${what} into ${form.target_language} and fill this box with it.`}
      className="bg-blue-700/30 hover:bg-blue-700/50 border-blue-600/50 text-amber-400 hover:text-amber-300 shrink-0 gap-1.5 h-8"
    >
      {translatingStopField === field ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
      Translate
    </Button>
  );

  const heading = (label, field, what) => (
    <div className="flex items-center gap-2">
      <Languages className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="text-xs text-slate-400 shrink-0">{label}:</span>
      {translateButton(field, what)}
      {notYetTranslated(field) && (
        <span className="flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-900/30 border border-amber-700/50 rounded-full px-2 py-0.5 shrink-0">
          <AlertTriangle className="w-3 h-3" /> Still English
        </span>
      )}
    </div>
  );

  return (
    <div className="bg-slate-800/60 border border-amber-600/30 rounded-lg px-3 py-2 space-y-2.5">
      {heading('Stop name', 'segment_title', 'name')}
      <WaypointEnglishReference
        walkId={form.id}
        targetLanguage={form.target_language}
        masterWp={masterWp}
        field="segment_title"
      />
      <Input
        value={selectedWp.segment_title || ''}
        onChange={e => onWaypointUpdate(toRawIndex(selectedWpIndex), 'segment_title', e.target.value)}
        placeholder="This stop's name, as shown to a customer"
        className="bg-slate-700 border-slate-600 text-white text-sm"
      />
      {stopFieldError.segment_title && <p className="text-xs text-red-400">{stopFieldError.segment_title}</p>}

      {heading('Stop description', 'description', 'description')}
      <WaypointEnglishReference
        walkId={form.id}
        targetLanguage={form.target_language}
        masterWp={masterWp}
        field="description"
      />
      <AutoGrowTextarea
        value={selectedWp.description || ''}
        onChange={e => onWaypointUpdate(toRawIndex(selectedWpIndex), 'description', e.target.value)}
        placeholder="A short description of this stop, as shown to a customer"
        rows={3}
        className="bg-slate-700 border-slate-600 text-white text-sm"
      />
      {stopFieldError.description && <p className="text-xs text-red-400">{stopFieldError.description}</p>}
    </div>
  );
}