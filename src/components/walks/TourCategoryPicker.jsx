import React from 'react';
import { motion } from 'framer-motion';
import { Footprints, MapPin, Car, ChevronRight } from 'lucide-react';
import { TOUR_CATEGORIES } from '@/lib/tourCategories';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const ICONS = { Footprints, MapPin, Car };

const COLOR_STYLES = {
  emerald: {
    bg: 'from-emerald-500 to-green-600',
    ring: 'ring-emerald-300',
    text: 'text-emerald-700',
    hoverBg: 'hover:from-emerald-600 hover:to-green-700',
  },
  amber: {
    bg: 'from-amber-500 to-orange-600',
    ring: 'ring-amber-300',
    text: 'text-amber-700',
    hoverBg: 'hover:from-amber-600 hover:to-orange-700',
  },
  blue: {
    bg: 'from-blue-500 to-indigo-600',
    ring: 'ring-blue-300',
    text: 'text-blue-700',
    hoverBg: 'hover:from-blue-600 hover:to-indigo-700',
  },
};

export default function TourCategoryPicker({ onSelect }) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50 flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4">
          <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-11 h-11 object-contain" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t('picker.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('picker.subtitle')}</p>
      </motion.div>

      <div className="w-full max-w-md space-y-3">
        {TOUR_CATEGORIES.map((cat, index) => {
          const Icon = ICONS[cat.icon] || MapPin;
          const styles = COLOR_STYLES[cat.color] || COLOR_STYLES.blue;

          return (
            <motion.button
              key={cat.code}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onSelect(cat.code)}
              className={`w-full bg-gradient-to-r ${styles.bg} ${styles.hoverBg} text-white rounded-2xl p-5 shadow-lg flex items-center gap-4 transition-all hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] text-left`}
            >
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <Icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-white/25 px-2 py-0.5 rounded font-bold">
                    {cat.code}
                  </span>
                  <h2 className="font-bold text-lg">{t('tour.' + cat.code + '.label')}</h2>
                </div>
                <p className="text-sm text-white/80 mt-0.5">{t('tour.' + cat.code + '.description')}</p>
              </div>
              <ChevronRight className="w-5 h-5 shrink-0 opacity-70" />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}