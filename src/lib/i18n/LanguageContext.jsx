import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { translations } from './index';

const STORAGE_KEY = 'mc_ui_lang';
const DEFAULT_LANG = 'en';

const LanguageContext = createContext(null);

// Provides the current UI language + a t(key, params) translator to the whole customer app.
// The choice persists in localStorage (per-device for now; a profile field can sync it
// across devices later). t() prefers an admin/narrator-corrected override (from the
// Translation entity), then the baseline for the current language, then English, then the
// raw key — so an untranslated or uncorrected key degrades gracefully instead of showing a
// broken token.
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG; } catch { return DEFAULT_LANG; }
  });
  const [overrides, setOverrides] = useState({});

  // Load corrected overrides from the Translation entity and merge over the baseline.
  // Translation.read is public (UI strings aren't sensitive), so this works for every
  // auth state (logged-out login page, WordPress customer, Base44 admin).
  const loadOverrides = useCallback(async () => {
    try {
      const list = await base44.entities.Translation.list('-updated_date', 1000);
      const ov = {};
      for (const r of (list || [])) {
        if (!r || !r.key || !r.lang) continue;
        (ov[r.lang] = ov[r.lang] || {})[r.key] = r.value;
      }
      setOverrides(ov);
    } catch { /* ignore — fall back to baseline strings */ }
  }, []);

  useEffect(() => { loadOverrides(); }, [loadOverrides]);

  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key, params) => {
    const raw =
      (overrides[lang] && overrides[lang][key]) ??
      (translations[lang] && translations[lang][key]) ??
      (translations[DEFAULT_LANG] && translations[DEFAULT_LANG][key]) ??
      key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`
    );
  }, [lang, overrides]);

  const value = useMemo(
    () => ({ lang, setLang, t, reloadTranslations: loadOverrides }),
    [lang, setLang, t, loadOverrides]
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) return { lang: 'en', setLang: () => {}, t: (k) => k, reloadTranslations: async () => {} };
  return ctx;
}