import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Smartphone, Sun, ShieldCheck } from 'lucide-react';
import * as wakeLockService from '@/lib/wakeLockService';

/**
 * Shown for driving_audio_tour routes. Warns the user that the app
 * must stay open and the screen on for GPS audio triggers to fire.
 * Optionally activates a screen wake lock to prevent auto-lock.
 */
export default function DrivingModeNotice() {
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Listen for browser-initiated wake lock releases + release on unmount
  useEffect(() => {
    const unsubscribe = wakeLockService.onReleased(() => {
      setWakeLockActive(false);
    });
    return () => {
      unsubscribe();
      wakeLockService.release();
    };
  }, []);

  // Re-acquire wake lock if the tab becomes visible again
  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState === 'visible' && wakeLockActive) {
        const ok = await wakeLockService.reacquireIfVisible();
        setWakeLockActive(ok);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [wakeLockActive]);

  const toggleWakeLock = useCallback(async () => {
    if (wakeLockActive) {
      await wakeLockService.release();
      setWakeLockActive(false);
    } else {
      const ok = await wakeLockService.acquire();
      setWakeLockActive(ok);
    }
  }, [wakeLockActive]);

  if (acknowledged) {
    return (
      <Card className="bg-amber-50 border-amber-300 p-3 flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
        <p className="text-xs text-amber-800 flex-1">
          Driving Mode active — keep this app in the foreground.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAcknowledged(false)}
          className="text-amber-700 hover:bg-amber-100 h-7 px-2 text-xs"
        >
          View again
        </Button>
      </Card>
    );
  }

  return (
    <Card className="bg-amber-50 border-amber-400 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
        <h3 className="font-bold text-amber-900">Driving Mode — Read Before Starting</h3>
      </div>

      <div className="space-y-2 text-sm text-amber-900">
        <p className="font-medium">
          Keep this app open and the screen on during the tour.
          Audio triggers may not work if the phone is locked or another app is opened.
        </p>

        <div className="flex items-start gap-2 text-amber-800">
          <Smartphone className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            The phone cannot be used for other apps during the tour —
            switching away pauses GPS tracking and audio playback.
          </p>
        </div>

        <div className="flex items-start gap-2 text-amber-800">
          <Sun className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Mount your phone on the dashboard so the screen stays visible
            and GPS signal is strong.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleWakeLock}
          className={`border-amber-400 ${
            wakeLockActive
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'text-amber-700 hover:bg-amber-100'
          }`}
        >
          <Sun className="w-4 h-4" />
          {wakeLockActive ? 'Screen staying on' : 'Keep screen on'}
        </Button>

        <Button
          size="sm"
          onClick={() => setAcknowledged(true)}
          className="bg-amber-600 text-white hover:bg-amber-700"
        >
          I understand
        </Button>
      </div>
    </Card>
  );
}