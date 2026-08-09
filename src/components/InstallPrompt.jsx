import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Download, Share } from 'lucide-react';

const DISMISSED_KEY = 'explore_crete_install_prompt_dismissed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Guides a first-time visitor through actually getting the app icon onto their home screen —
// nothing does this automatically on any platform, every browser requires an explicit tap, so
// without this most people (reasonably) never discover the option exists at all.
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch (err) {
      return false;
    }
  });

  useEffect(() => {
    if (isStandalone() || dismissed) return;

    // Android/Chrome: capture the browser's own native install prompt instead of showing it
    // immediately — this lets us show our own banner and trigger the real install dialog only
    // when the person actually taps our button, rather than an unexpected browser popup.
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // iOS Safari has no equivalent API at all — Apple has never supported triggering install
    // programmatically, so the only option is showing plain instructions instead.
    if (isIOS()) {
      setShowIOSInstructions(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, [dismissed]);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch (err) {
      // Storage unavailable — banner will just reappear next visit, not a big deal.
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  if (dismissed || isStandalone()) return null;
  if (!deferredPrompt && !showIOSInstructions) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[1000] max-w-md mx-auto bg-white rounded-xl shadow-2xl border border-gray-200 p-4">
      <button onClick={dismiss} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
        <X className="w-4 h-4" />
      </button>

      {deferredPrompt ? (
        <>
          <p className="font-semibold text-gray-900 mb-1">Add Explore Crete to your home screen</p>
          <p className="text-sm text-gray-600 mb-3">Get one-tap access next time — no need to type the address again.</p>
          <Button onClick={handleInstallClick} className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-2">
            <Download className="w-4 h-4" /> Add to Home Screen
          </Button>
        </>
      ) : (
        <>
          <p className="font-semibold text-gray-900 mb-1">Add Explore Crete to your home screen</p>
          <p className="text-sm text-gray-600 flex items-center gap-1 flex-wrap">
            Tap <Share className="w-4 h-4 inline" /> at the bottom of Safari, then choose
            <strong>"Add to Home Screen."</strong>
          </p>
        </>
      )}
    </div>
  );
}