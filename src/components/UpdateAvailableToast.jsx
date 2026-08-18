import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, X } from 'lucide-react';

// Whether the app auto-updates or needs a manual step depends on how someone is using it
// right now, not on anything they have to do:
//
// - Closing the app/tab and reopening it (or a normal browser refresh) always gets the
//   latest deployed version automatically — no action needed. Navigation requests are
//   network-first in the service worker (public/sw.js), so a fresh load never serves a
//   stale cached page.
// - The one case that needs a real prompt is someone who leaves the app open for a while
//   (very plausible for a narrator mid-session) while a new version gets deployed behind
//   them. The service worker still activates the new version in the background — that
//   part is automatic — but jumping straight to a reload with zero warning risks losing
//   whatever wasn't saved yet (an in-progress recording, an unsaved script edit). This
//   banner is that warning: it appears once the new version is ready and lets them choose
//   when it's safe to reload, instead of it happening to them without notice.
//
// index.html's inline service-worker script dispatches the 'explore-crete:update-available'
// window event the moment a new version has taken over in the background; this component
// just listens for it. Mounted once, globally, in App.jsx so it works the same whether
// someone's on the customer front end, the Admin Panel, or Narr Studio.
export default function UpdateAvailableToast() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = () => setAvailable(true);
    window.addEventListener('explore-crete:update-available', handler);
    return () => window.removeEventListener('explore-crete:update-available', handler);
  }, []);

  if (!available || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[1100] max-w-md mx-auto bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700 p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
        <RefreshCw className="w-4 h-4 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">A new version is available</p>
        <p className="text-xs text-slate-400">Update now to get the latest fixes and features.</p>
      </div>
      <Button
        size="sm"
        onClick={() => window.location.reload()}
        className="bg-blue-600 hover:bg-blue-500 text-white shrink-0"
      >
        Update
      </Button>
      {/* Dismissable, not forced — someone mid-recording can finish first and update on
          their own next visit; closing/reopening picks up the new version regardless. */}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-slate-500 hover:text-slate-300 shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
