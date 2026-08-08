import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SPLASH_IMAGE = 'https://media.base44.com/images/public/69a7d073cd7cd9b51cfe0fd0/40f0351cc_Walkingappsplashacreen.jpg';

export default function SplashScreen({ onDone }) {
  const [visible, setVisible] = useState(true);

  // By the time this screen can render, App.jsx has already confirmed the user is logged in via
  // the WordPress-based auth system — there's nothing left to check here. This used to check
  // Base44's own separate native login instead, which customers never actually have a session
  // in, so it was incorrectly sending real customers off to Base44's own generic login page.
  const handleEnter = () => {
    setVisible(false);
    setTimeout(() => {
      onDone();
    }, 400);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Full-screen background image */}
          <img
            src={SPLASH_IMAGE}
            alt="Magical Crete Walking App"
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Subtle dark overlay at the bottom for button readability */}
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/70 to-transparent" />

          {/* Enter button */}
          <div className="absolute bottom-12 left-0 right-0 flex justify-center px-8">
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              onClick={handleEnter}
              className="w-full max-w-xs bg-white/20 hover:bg-white/30 active:scale-95 text-white font-semibold text-base py-3 rounded-2xl border border-white/50 backdrop-blur-sm tracking-wide transition-all duration-150"
            >
              Enter
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}