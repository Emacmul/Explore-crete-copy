import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, MapPin } from 'lucide-react';

const UPSELL_KEY = 'wanderer_upsell_last_shown';
const SHOW_INTERVAL_DAYS = 3;

export function shouldShowUpsell() {
  const last = localStorage.getItem(UPSELL_KEY);
  if (!last) return true;
  const daysSince = (Date.now() - parseInt(last)) / (1000 * 60 * 60 * 24);
  return daysSince >= SHOW_INTERVAL_DAYS;
}

export function markUpsellShown() {
  localStorage.setItem(UPSELL_KEY, Date.now().toString());
}

export default function WandererUpsellSplash({ onDismiss }) {
  const handleDismiss = () => {
    markUpsellShown();
    onDismiss();
  };

  const handleUpgrade = () => {
    markUpsellShown();
    window.open('https://magicalcrete.com/home-v2/memberships/', '_blank');
    onDismiss();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleDismiss} />

        {/* Card */}
        <motion.div
          className="relative w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', damping: 22 }}
        >
          {/* Hero */}
          <div className="bg-gradient-to-br from-amber-500 to-amber-600 px-6 pt-8 pb-6 text-white text-center">
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <MapPin className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold mb-1">Unlock More of Crete</h2>
            <p className="text-amber-100 text-sm">
              You're missing out on exclusive trails only available to Explorer, Pathfinder & Wayfinder members.
            </p>
          </div>

          {/* Perks */}
          <div className="px-6 py-5 space-y-3">
            {[
              { tier: 'Explorer', desc: 'Access all Base walks + C1 extension routes' },
              { tier: 'Pathfinder', desc: 'C2 routes, GPS recording & personal trail library' },
              { tier: 'Wayfinder', desc: 'Everything + photos, notes & walk sharing' },
            ].map(({ tier, desc }) => (
              <div key={tier} className="flex items-start gap-3">
                <Star className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="text-sm font-semibold text-gray-800">{tier} </span>
                  <span className="text-sm text-gray-500">{desc}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 space-y-2">
            <button
              onClick={handleUpgrade}
              className="w-full bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-semibold py-3 rounded-xl transition-all"
            >
              View Membership Options
            </button>
            <button
              onClick={handleDismiss}
              className="w-full text-gray-400 hover:text-gray-600 text-sm py-2 transition-colors"
            >
              Thanks, not now
            </button>
          </div>

          {/* Dismiss X */}
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}