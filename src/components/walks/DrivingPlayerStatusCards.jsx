import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, AlertTriangle } from 'lucide-react';
import { wpKeyFor } from '@/lib/drivingPlayerHelpers';

/**
 * Presentational status strip + warning cards for DrivingTourPlayer — extracted from the
 * component file (2026-10-24) to keep it under the platform's editable-size limit. Pure
 * display: every value and callback arrives as a prop; nothing is computed here. The
 * full history/reasoning for each card lives in DrivingTourPlayer.jsx next to where its
 * props are derived.
 */
export default function DrivingPlayerStatusCards({
  t, status, statusMeta,
  gpsIssueActive, gpsIssue, gpsIssueTitle, offRouteActive,
  currentPos, gpsAccuracy, accuracyIsWeak, lastTriggered,
  showResumeCard, resumeWp, resumeError, handleResumeNarration, canStart, savedOffline,
  nextStopActive, nextStop, playTriggerAudio,
}) {
  return (
    <>
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          gpsIssueActive ? 'bg-red-500 animate-pulse' :
          status === 'running' ? 'bg-green-400 animate-pulse' :
          status === 'paused' ? 'bg-amber-400' : 'bg-slate-500'
        }`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${statusMeta.color}`}>
            {statusMeta.label}
          </div>
          {currentPos && (
            <div className={`text-xs font-mono ${accuracyIsWeak ? 'text-amber-400' : 'text-slate-500'}`}>
              {currentPos[0].toFixed(5)}, {currentPos[1].toFixed(5)}
              {gpsAccuracy != null && ` (±${Math.round(gpsAccuracy)}m)`}
              {accuracyIsWeak && ` — ${t('player.gpsWeakSignal')}`}
            </div>
          )}
        </div>
        {lastTriggered && (
          <div className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-full shrink-0 max-w-[45%] truncate">
            ▶ {lastTriggered}
          </div>
        )}
      </div>

      {/* "Resume narration" — shown when narration was interrupted (camera, another
          app, the phone locking, a page reload) and nothing is playing right now.
          While the tour is running and the phone merely paused the clip, this appears
          the moment that pause is detected; after a reload it appears as soon as the
          tour screen is opened again. A deliberate Stop never leaves one behind. */}
      {showResumeCard && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 bg-blue-900/30 border border-blue-500 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs text-blue-300 break-words">{t('player.resumeNarrationNote')}</p>
            {resumeWp && (
              <p className="text-sm font-medium text-blue-100 truncate">
                {resumeWp.segment_title || resumeWp.name || resumeWp.segment_id}
              </p>
            )}
            {resumeError && (
              <p className="text-xs text-red-300 mt-0.5 break-words">{t('player.resumeUnavailable')}</p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleResumeNarration}
            disabled={status === 'idle' && !canStart}
            title={status === 'idle' && !canStart ? (!savedOffline ? t('player.mustSaveFirst') : t('player.mustConfirmSafetyFirst')) : undefined}
            className="shrink-0 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" /> {t('player.resumeNarration')}
          </Button>
        </div>
      )}

      {/* A failed resume must never vanish silently: when the restored clip couldn't
          load, the snapshot is cleared (there is nothing left to resume) and with it
          the resume card — so this notice lives OUTSIDE the card and keeps showing the
          way forward. It clears when the customer manually plays a stop, starts a
          fresh tour, or stops the tour — never because the card disappeared. */}
      {resumeError && !showResumeCard && (
        <div className="mx-4 mb-3 flex items-start gap-2 bg-blue-900/30 border border-blue-500 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-200 min-w-0 break-words">{t('player.resumeUnavailable')}</p>
        </div>
      )}

      {/* "Next stop" card — always present rather than only appearing once trouble is
          detected. Tapping Play queues behind whatever's currently playing
          (playTriggerAudio) — it never interrupts audio in progress, it only starts
          once that finishes, exactly like every other trigger path in this player. */}
      {nextStopActive && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 bg-slate-700/40 border border-slate-600 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">{t('player.nextStopLabel')}</p>
            <p className="text-sm font-medium text-slate-100 truncate">
              {nextStop.segment_title || nextStop.name || nextStop.segment_id}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => playTriggerAudio(nextStop, wpKeyFor(nextStop))}
            title={t('detail.playStopTitle')}
            // Per Enda (2026-10-21): the "Next stop" Play button must be visible at a
            // glance while driving, not a faint outline a driver has to hunt for. Same
            // solid high-contrast bold treatment as the Start/Pause/Stop controls.
            className="shrink-0 gap-1.5 bg-green-500 hover:bg-green-600 text-white font-bold text-sm px-4 h-10 shadow-lg shadow-green-900/40"
          >
            <Play className="w-4 h-4" /> {t('detail.playStop')}
          </Button>
        </div>
      )}

      {/* GPS sustained-failure / sustained-too-imprecise warning — per audit finding U-07,
          this must be genuinely hard to miss, not a small status-bar colour change alone.
          A 'no_signal' issue stays up until a fresh fix of any accuracy comes back in; a
          'low_accuracy' issue needs a fix that's actually precise enough. */}
      {gpsIssueActive && (
        <div className="mx-4 mb-3 flex items-start gap-2 bg-red-900/30 border border-red-600 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-300 break-words">{gpsIssueTitle}</p>
            <p className="text-xs text-red-300/90 mt-0.5 break-words">{gpsIssue.message}</p>
          </div>
        </div>
      )}

      {/* Off-route warning — per Anoushka/Enda (follow-up 156). Separate from the GPS-issue
          banner above and can appear at the same time as (or instead of) it; this only ever
          shows once a fix has been TRUSTED and it's the trusted position itself that's far
          from the route. Clears once a trusted fix comes back close enough to the route. */}
      {offRouteActive && (
        <div className="mx-4 mb-3 flex items-start gap-2 bg-amber-900/30 border border-amber-600 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-300 break-words">{t('player.offRouteTitle')}</p>
            <p className="text-xs text-amber-300/90 mt-0.5 break-words">{t('player.offRouteMessage')}</p>
          </div>
        </div>
      )}
    </>
  );
}