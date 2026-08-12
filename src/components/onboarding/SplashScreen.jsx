import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const SPLASH_IMAGE = '/splash-background.jpg';

export default function SplashScreen({ onDone }) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(true);

  const handleEnter = () => {
    setVisible(false);
    setTimeout(() => {
      onDone();
    }, 400);
  };

  // Lock background scroll completely on mobile touch devices
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    
    document.body.style.overflow = 'hidden';
    // Fixes rubber-banding scroll bypass on iOS Safari
    document.body.style.position = 'fixed'; 
    document.body.style.width = '100%';

    return () => { 
      document.body.style.overflow = prevOverflow; 
      document.body.style.position = prevPosition;
      document.body.style.width = '';
    };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          // FIXED: Changed h-[100dvh] to inset-0 to prevent layout jumps from address bars.
          // FIXED: Removed conflicting 'flex flex-col' since children are explicitly positioned absolute.
          className="fixed inset-0 w-full z-[9999] overflow-hidden overscroll-none touch-none"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Full-screen background image */}
          <img
            src={SPLASH_IMAGE}
            alt={t('app.title')}
            // FIXED: Added object-center and transform-gpu to keep layout scaling centered and highly performant
            className="absolute inset-0 w-full h-full object-cover object-center transform-gpu"
          />

          {/* Soft overlay at the top for title readability against the sky */}
          <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-black/25 to-transparent pointer-events-none" />

          {/* Title area */}
          {/* FIXED: Replaced arbitrary pt-10 with safe-area-inset for modern notch/dynamic island phones */}
          <div className="absolute top-0 left-0 right-0 pt-[calc(env(safe-area-inset-top)+1.5rem)] px-6 text-center z-10">
            <h1
              className="font-extrabold text-blue-700 leading-tight break-words select-none"
              style={{
                fontSize: 'clamp(1.5rem, 6vw, 2.5rem)',
                textShadow: '0 1px 3px rgba(255,255,255,0.7), 0 2px 12px rgba(0,0,0,0.3)',
              }}
            >
              {t('app.title')}
            </h1>
          </div>

          {/* Subtle dark overlay at the bottom for button readability */}
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

          {/* Enter button */}
          {/* FIXED: Structured bottom padding specifically to prevent button clipping behind browser navigation pills */}
          <div className="absolute bottom-0 left-0 right-0 flex justify-center px-8 pb-[calc(env(safe-area-inset-bottom)+2rem)] z-10">
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              onClick={handleEnter}
              className="w-full max-w-xs bg-white/20 hover:bg-white/30 active:scale-95 text-white font-semibold text-base py-3.5 rounded-2xl border border-white/50 backdrop-blur-sm tracking-wide transition-all duration-150 shadow-lg"
            >
              {t('splash.enter')}
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
