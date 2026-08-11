import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function About() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-700 to-teal-900 p-6">
      <div className="w-full max-w-2xl mx-auto">
        <div className="text-center mb-8 pt-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4">
            <img src="/explore-crete-logo.png" alt={t('app.title')} className="w-11 h-11 object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-white">{t('about.pageTitle')}</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-4 text-gray-700 leading-relaxed">
          <p>{t('about.paragraph1')}</p>
          <p>{t('about.paragraph2')}</p>
          <p>{t('about.paragraph3')}</p>

          <div className="pt-4 border-t flex flex-wrap items-center justify-between gap-3">
            <Link to="/Contact" className="inline-flex items-center gap-2 text-sm text-teal-700 font-medium hover:underline">
              <Mail className="w-4 h-4" />
              {t('about.contactUs')}
            </Link>
            <Link to="/Login" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:underline">
              <ArrowLeft className="w-4 h-4" />
              {t('common.backToApp')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
