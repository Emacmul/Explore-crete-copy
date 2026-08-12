import React from 'react';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LANGUAGE_NAME_BY_CODE } from '@/lib/i18n';
import { Mic2 } from 'lucide-react';

// Compact dropdown for the customer header. Picks the NARRATION language independently of
// the UI language — defaults to "match UI" (so a Dutch-UI customer hears Dutch narration by
// default) but is separately changeable afterward. `availableLangs` is the set of languages
// that actually have a published narration somewhere in the loaded catalogue (always
// includes English), so the picker never offers a language nothing is available in.
export default function NarrationLanguagePicker({ availableLangs = [] }) {
  const { lang, t, narrationPref, setNarrationPref } = useLanguage();
  const value = narrationPref || '__auto__';
  const uiName = LANGUAGE_NAME_BY_CODE[lang] || 'English';
  // Always show the current pref even if it's no longer in the available set, so the trigger
  // never goes blank.
  const langs = Array.from(new Set([...availableLangs, narrationPref].filter(Boolean)));

  return (
    <Select value={value} onValueChange={(v) => setNarrationPref(v === '__auto__' ? null : v)}>
      <SelectTrigger className="h-8 w-[160px] text-xs gap-1 border-slate-300" aria-label={t('home.narration')}>
        <Mic2 className="w-3.5 h-3.5 text-slate-500" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__auto__">{t('home.narrationMatchUi')} ({uiName})</SelectItem>
        {langs.map(l => (
          <SelectItem key={l} value={l}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}