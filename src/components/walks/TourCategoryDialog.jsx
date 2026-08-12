import React from 'react';
import { motion } from 'framer-motion';
import { Footprints, MapPin, Car, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TOUR_CATEGORIES } from '@/lib/tourCategories';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const ICONS = { Footprints, MapPin, Car };

const COLOR_STYLES = {
  emerald: { bg: 'from-emerald-500 to-green-600', hoverBg: 'hover:from-emerald-600 hover:to-green-700' },
  amber: { bg: 'from-amber-500 to-orange-600', hoverBg: 'hover:from-amber-600 hover:to-orange-700' },
  blue: { bg: 'from-blue-500 to-indigo-600', hoverBg: 'hover:from-blue-600 hover:to-indigo-700' },
};

// The tour-type picker, shown as a non-blocking dialog (opened from the header's
// "Change tour type" button) instead of a full interstitial screen on login.
export default function TourCategoryDialog({ open, onSelect, onClose }) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-xl font-bold">{t('picker.title')}</DialogTitle>
          <DialogDescription>{t('picker.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6 space-y-3">
          {TOUR_CATEGORIES.map((cat, index) => {
            const Icon = ICONS[cat.icon] || MapPin;
            const styles = COLOR_STYLES[cat.color] || COLOR_STYLES.blue;
            return (
              <motion.button
                key={cat.code}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => onSelect(cat.code)}
                className={`w-full bg-gradient-to-r ${styles.bg} ${styles.hoverBg} text-white rounded-2xl p-4 shadow-lg flex items-center gap-4 transition-all hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] text-left rtl:text-right`}
              >
                <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-white/25 px-2 py-0.5 rounded font-bold">{cat.code}</span>
                    <h2 className="font-bold">{t('tour.' + cat.code + '.label')}</h2>
                  </div>
                  <p className="text-sm text-white/80 mt-0.5">{t('tour.' + cat.code + '.description')}</p>
                </div>
                <ChevronRight className="w-5 h-5 shrink-0 opacity-70 rtl:rotate-180" />
              </motion.button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}