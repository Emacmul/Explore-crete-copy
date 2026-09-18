import { useEffect, useRef } from 'react';

// Per Enda: "Twice now I'm testing the complete BOR1 locations, and twice my computer
// screen goes black while the audio keeps playing. This is highly annoying because I
// can't see the car, and so don't know if everything is working as it should. I know
// this is either a windows or a Chrome setting. Either way, I need this disabled for
// everybody when they are working in the app."
//
// This is a computer's own screen/monitor-off timer, not a crash or a bug in anything
// this app does — it fires purely from a lack of mouse/keyboard activity, and a tour or
// a test genuinely has none of that: it just plays audio and drives a map marker on its
// own for however long the drive takes, even though the app is very much "in use" the
// whole time. The fix isn't "tell every narrator to change their own computer's power
// settings" — easy to forget, has to be redone per computer, and wouldn't help a real
// customer driving with their own phone or laptop mounted somewhere either. Instead,
// the page itself asks the browser to keep the screen on for as long as the app is open
// and actually the one on screen, using the browser's own Screen Wake Lock API — built
// for precisely this "something is actively happening with no direct input" situation
// (the same thing a video-calling app or a recipe app uses to stop your screen going
// dark mid-call or mid-recipe).
//
// Mounted once, globally, in App.jsx — same placement as UpdateAvailableToast — so it
// applies the same way whether someone's testing in the Admin Panel, reviewing in Narr
// Studio, or a customer is actually driving a live tour on the front end.
//
// A wake lock is automatically, silently released by the BROWSER ITSELF the instant the
// tab is minimized, switched away from, or the device's own screen is manually locked —
// that's the spec working as intended, not something to fight. What this component adds
// is re-requesting it every time the tab becomes visible again, so it's always back in
// effect whenever the app is genuinely the thing on screen, without needing a page
// reload to pick it back up.
//
// Feature-detected first (`'wakeLock' in navigator`) — not supported in every browser
// (older Safari/iOS chief among them). Where it isn't, this component simply does
// nothing at all, silently — the app behaves exactly as it always did there, just
// without this particular fix; nothing else about the app depends on it.
export default function ScreenWakeLock() {
  const wakeLockRef = useRef(null);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    // Guards against a request that resolves AFTER this component has already been
    // told to clean up (e.g. a very fast unmount) — without this, a lock could be
    // stored into a ref nothing will ever release again.
    let cancelled = false;

    const requestLock = async () => {
      // Already holding one — nothing to do. Also avoids piling up a second in-flight
      // request if visibilitychange fires more than once in quick succession.
      if (wakeLockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        // The browser can release this out from under us on its own (tab hidden,
        // device screen locked by the OS, battery saver kicking in on some
        // platforms) — clearing the ref here means the visibility handler below
        // knows to ask again next time the tab is genuinely visible, rather than
        // wrongly believing a lock is still held.
        lock.addEventListener('release', () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
      } catch {
        // Most often the tab simply isn't visible at this exact moment (the spec
        // itself refuses the request then) — nothing to show a narrator for this;
        // the visibilitychange listener below retries automatically once it is.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestLock();
    };

    requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  return null;
}
