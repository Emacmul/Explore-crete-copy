import React from 'react';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { UI_LANGUAGES } from '@/lib/i18n';
import { Mic2 } from 'lucide-react';

// Compact dropdown for the customer header. Picks the NARRATION language independently of
// the UI language — defaults to "match UI" (so a Dutch-UI customer hears Dutch narration by
// default) but is separately changeable afterward. `availableLangs` is the set of languages
// that actually have a published narration somewhere in the loaded catalogue (always
// includes English), so the picker never offers a language nothing is available in.
//
// This is easy to mistake for a second, redundant language picker if it isn't clearly
// labeled — it looks nearly identical to the UI language picker sitting right next to it.
// The visible "Narration:" prefix exists specifically so it reads, at a glance, as "this
// controls the spoken tour audio," not "why are there two of these."
export default function NarrationLanguagePicker({ availableLangs = [] }) {
  const { lang, t, narrationPref, setNarrationPref } = useLanguage();
  const value = narrationPref || '__auto__';
  const uiName = UI_LANGUAGES.find((l) => l.code === lang)?.native || 'English';
  // Always show the current pref even if it's no longer in the available set, so the trigger
  // never goes blank.
  const langs = Array.from(new Set([...availableLangs, narrationPref].filter(Boolean)));

  return (
    <Select value={value} onValueChange={(v) => setNarrationPref(v === '__auto__' ? null : v)}>
      <SelectTrigger className="h-8 w-[230px] gap-1.5 text-xs border-slate-300" aria-label={t('home.narration')}>
        <Mic2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="text-slate-500 font-medium">{t('home.narration')}:</span>
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