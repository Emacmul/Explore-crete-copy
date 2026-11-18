import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * "Before You Set Off" safety notes.
 *
 * Shown in full — and un-collapsible — until the customer confirms they've read it (that
 * confirmation is the gate that unlocks Start Walk / Start Tour, and every tap is logged).
 * Once confirmed the long text collapses down to one compact line, with a button to reopen
 * the full recommendations whenever they want to re-read them mid-tour.
 */
export default function SafetyNotesCard({ safetyNotes, confirmed, submitting, onConfirm }) {
  const { t } = useLanguage();
  const [reopened, setReopened] = useState(false);

  const showFullText = !confirmed || reopened;

  if (!showFullText) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-emerald-800 text-sm font-medium break-words">{t('detail.safetyConfirmed')}</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setReopened(true)}
          className="h-7 gap-1 px-2 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
        >
          {t('detail.openSafety')} <ChevronDown className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
          <h3 className="font-bold text-red-700">{t('detail.beforeYouSetOff')}</h3>
        </div>
        {confirmed && (
          <button
            type="button"
            onClick={() => setReopened(false)}
            className="text-xs text-red-700 underline shrink-0"
          >
            {t('detail.hideSafety')}
          </button>
        )}
      </div>

      <p className="text-red-700 text-sm leading-relaxed whitespace-pre-line">
        {safetyNotes || t('detail.defaultSafetyNotes')}
      </p>

      {/* Deliberate forcing function: Start Walk / Start Tour stays disabled until this is
          tapped, and every tap is logged via logSafetyConfirmation. */}
      {confirmed ? (
        <div className="mt-3 flex items-center gap-2 text-emerald-700 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {t('detail.safetyConfirmed')}
        </div>
      ) : (
        <Button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="mt-3 w-full sm:w-auto gap-2 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" /> {t('detail.confirmSafety')}
        </Button>
      )}
    </div>
  );
}