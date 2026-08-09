import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { translations } from './index';

const STORAGE_KEY = 'mc_ui_lang';
const DEFAULT_LANG = 'en';

const LanguageContext = createContext(null);

// Provides the current UI language + a t(key, params) translator to the whole customer app.
// The choice persists in localStorage (per-device for now; a profile field can sync it
// across devices later). t() falls back to English, then to the raw key, so untranslated
// screens degrade gracefully to English instead of showing a broken key.
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG; } catch { return DEFAULT_LANG; }
  });

  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key, params) => {
    const raw =
      (translations[lang] && translations[lang][key]) ??
      (translations[DEFAULT_LANG] && translations[DEFAULT_LANG][key]) ??
      key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`
    );
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) return { lang: 'en', setLang: () => {}, t: (k) => k };
  return ctx;
}