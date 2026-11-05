import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Check, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage } from '@/lib/utils';

// Add-or-edit form for ONE pronunciation dictionary entry, used inline from
// PronunciationCheckPanel: the admin sees a word in the script, finds it missing (or its
// IPA wrong), and fixes the dictionary right there without opening the full dictionary
// window. Saving goes through the same pronunciationDictionary backend function the
// dictionary window uses — `id` present means update, absent means create.
export default function PronunciationEntryForm({ initial = {}, languages = [], onSaved, onCancel }) {
  const [word, setWord] = useState(initial.original_word || '');
  const [language, setLanguage] = useState(initial.language_origin || '');
  const [ipa, setIpa] = useState(initial.ipa_notation || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    if (!word.trim()) { setError('A word or name is required.'); return; }
    if (!language.trim()) { setError('Pick a language.'); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('pronunciationDictionary', {
        action: initial.id ? 'update' : 'create',
        ...(initial.id ? { id: initial.id } : {}),
        original_word: word.trim(),
        language_origin: language.trim(),
        ipa_notation: ipa.trim(),
        ...getNarratorAuthPayload(),
      });
      if (res?.data?.error) throw new Error(res.data.error);
      onSaved?.(res.data.entry);
    } catch (err) {
      setError(getFnErrorMessage(err, 'Could not save that entry.'));
    }
    setSaving(false);
  };

  return (
    <div className="rounded border border-slate-600 bg-slate-800/60 p-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="Word or name, exactly as it appears in the script"
          className="h-7 text-xs flex-1 min-w-[160px] bg-slate-900 border-slate-600 text-slate-100"
        />
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="h-7 text-xs w-[140px] bg-slate-900 border-slate-600 text-slate-100">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            {languages.map((l) => (
              <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={ipa}
          onChange={(e) => setIpa(e.target.value)}
          placeholder="IPA (optional)"
          className="h-7 text-xs w-[150px] font-mono bg-slate-900 border-slate-600 text-slate-100"
        />
        <Button size="sm" className="h-7 px-2" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300" onClick={onCancel} disabled={saving}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}