import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { translations, LANGUAGE_NAME_BY_CODE, UI_LANGUAGES } from './index';

const STORAGE_KEY = 'mc_ui_lang';
const NARRATION_KEY = 'mc_narration_lang';
const DEFAULT_LANG = 'en';

const LanguageContext = createContext(null);

// Provides the UI language AND a separate, independent narration-language preference.
//
// UI language (lang): chrome strings only — buttons, labels, hints. Persists per-device in
// localStorage.
//
// Narration preference (narrationPref): which spoken language the customer wants tours
// narrated in — a full language name ("Dutch") or null = "follow the UI language". It is
// independent of the UI language (the customer can change it on its own afterward) but
// defaults to matching the UI language when first set, via effectiveNarrationLang.
//
// t() prefers an admin/narrator-corrected override (from the Translation entity), then the
// baseline for the current language, then English, then the raw key — so an untranslated
// or uncorrected key degrades gracefully instead of showing a broken token.
export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG; } catch { return DEFAULT_LANG; }
  });
  const [narrationPref, setNarrationPrefState] = useState(() => {
    try { return localStorage.getItem(NARRATION_KEY) || null; } catch { return null; }
  });
  const [overrides, setOverrides] = useState({});

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

  // Flip the document direction + language for RTL UI languages (Hebrew, Arabic) so the
  // whole layout mirrors — text alignment, flex row order, icon flips — instead of staying
  // left-to-right. Restored to 'ltr' for any other language.
  useEffect(() => {
    const def = UI_LANGUAGES.find((l) => l.code === lang);
    document.documentElement.dir = def?.rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const setNarrationPref = useCallback((name) => {
    if (!name) {
      setNarrationPrefState(null);
      try { localStorage.removeItem(NARRATION_KEY); } catch { /* ignore */ }
    } else {
      setNarrationPrefState(name);
      try { localStorage.setItem(NARRATION_KEY, name); } catch { /* ignore */ }
    }
  }, []);

  // Effective narration language: the customer's explicit choice, or — when unset — the
  // narration language matching their UI language (Dutch UI → Dutch narration by default).
  const effectiveNarrationLang = narrationPref || LANGUAGE_NAME_BY_CODE[lang] || 'English';

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
    () => ({ lang, setLang, t, reloadTranslations: loadOverrides, narrationPref, effectiveNarrationLang, setNarrationPref }),
    [lang, setLang, t, loadOverrides, narrationPref, effectiveNarrationLang, setNarrationPref]
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      lang: 'en', setLang: () => {}, t: (k) => k, reloadTranslations: async () => {},
      narrationPref: null, effectiveNarrationLang: 'English', setNarrationPref: () => {},
    };
  }
  return ctx;
}