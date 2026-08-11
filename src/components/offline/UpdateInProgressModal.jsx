import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function UpdateInProgressModal({ walkName }) {
  const { t } = useLanguage();
  return (
    <AnimatePresence>
      {walkName && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl p-8 mx-6 max-w-sm w-full text-center"
          >
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{t('update.title')}</h2>
            <p className="text-gray-500 text-sm leading-relaxed whitespace-pre-line">
              {t('update.body')}
            </p>
            <div className="mt-5 flex items-center gap-2 bg-blue-50 rounded-lg px-4 py-3">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
              <p className="text-sm text-blue-700 font-medium truncate">{t('update.updating', { name: walkName })}</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
