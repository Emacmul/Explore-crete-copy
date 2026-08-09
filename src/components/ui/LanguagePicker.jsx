import React from 'react';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { UI_LANGUAGES } from '@/lib/i18n';

// Compact dropdown for the customer header. Shows the current UI language in its own
// native name; switching updates localStorage immediately and every wired string swaps
// on the next render.
export default function LanguagePicker() {
  const { lang, setLang } = useLanguage();
  return (
    <Select value={lang} onValueChange={setLang}>
      <SelectTrigger className="h-8 w-[124px] text-xs gap-1 border-slate-300" aria-label="Interface language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UI_LANGUAGES.map(l => (
          <SelectItem key={l.code} value={l.code}>{l.native}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}