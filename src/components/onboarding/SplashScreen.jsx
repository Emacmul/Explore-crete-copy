import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const SPLASH_IMAGE = '/splash-background.jpg';

export default function SplashScreen({ onDone }) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(true);

  // By the time this screen can render, App.jsx has already confirmed the user is logged in via
  // the WordPress-based auth system — there's nothing left to check here.
  const handleEnter = () => {
    setVisible(false);
    setTimeout(() => {
      onDone();
    }, 400);
  };

  // Lock background scroll while the splash is up. Without this, the app content rendered
  // behind the overlay keeps the document scrollable on a phone, so the Enter button ends up
  // below the visible fold and the customer has to hunt for it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed top-0 left-0 right-0 h-[100dvh] w-full z-[9999] overflow-hidden flex flex-col overscroll-none"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Full-screen background image — a clean photo with no text baked in, so the
              title below is always real, live, translatable text instead. */}
          <img
            src={SPLASH_IMAGE}
            alt={t('app.title')}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Soft overlay at the top for title readability against the sky */}
          <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-black/25 to-transparent" />

          {/* Title — sized with clamp() so it scales in direct proportion to the real
              viewport width on whatever device it's actually rendering on. Reduced from
              8vw to 6vw and allowed to wrap to two lines (break-words, no nowrap) as a
              genuine safety net — even if the vw-based size is ever slightly too large
              for a given device/font combination, it now folds to a second line instead
              of running off the edge of the screen. */}
          <div className="absolute top-0 left-0 right-0 pt-10 px-4 text-center">
            <h1
              className="font-extrabold text-blue-700 leading-tight break-words"
              style={{
                fontSize: 'clamp(1.25rem, 6vw, 2.75rem)',
                textShadow: '0 1px 3px rgba(255,255,255,0.6), 0 2px 12px rgba(0,0,0,0.25)',
              }}
            >
              {t('app.title')}
            </h1>
          </div>

          {/* Subtle dark overlay at the bottom for button readability */}
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/70 to-transparent" />

          {/* Enter button */}
          <div className="absolute bottom-8 left-0 right-0 flex justify-center px-8 pb-[env(safe-area-inset-bottom)]">
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              onClick={handleEnter}
              className="w-full max-w-xs bg-white/20 hover:bg-white/30 active:scale-95 text-white font-semibold text-base py-3 rounded-2xl border border-white/50 backdrop-blur-sm tracking-wide transition-all duration-150"
            >
              {t('splash.enter')}
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
