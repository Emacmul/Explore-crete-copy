import React, { useEffect, useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, RotateCcw, Languages, Lock } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { translations, UI_LANGUAGES } from '@/lib/i18n';

// Back-office editor for UI string overrides. Shows the English source for reference and
// the current value (override if one exists, otherwise the AI baseline) in an editable
// field per language. Save writes a Translation override; Revert deletes it so the
// baseline shows again. Overrides go live for all customers on next app load.
//
// Admins (reached via /Admin) authorize through their Base44 session; narrators (reached
// via the Narr button, no Base44 session) enter their Narr password once, which the
// saveTranslation function verifies against AppUser — the same check narrLogin uses.
export default function TranslationsManager({ authMode, user }) {
  const { reloadTranslations } = useLanguage();
  const [activeLang, setActiveLang] = useState('nl');
  const [overrides, setOverrides] = useState({});
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  const needsPassword = authMode === 'narr';
  const [narrPassword, setNarrPassword] = useState('');

  const load = async () => {
    const list = await base44.entities.Translation.list('-updated_date', 1000);
    const ov = {};
    for (const r of (list || [])) {
      if (!r || !r.key || !r.lang) continue;
      (ov[r.lang] = ov[r.lang] || {})[r.key] = r.value;
    }
    setOverrides(ov);
    setDrafts({});
    setLoading(false);
  };

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  const currentValue = (lang, key) => overrides[lang]?.[key] ?? translations[lang]?.[key] ?? translations.en[key] ?? key;
  const englishSource = (key) => translations.en[key] ?? '';

  const draftValue = (lang, key) => {
    if (drafts[lang] && drafts[lang][key] !== undefined) return drafts[lang][key];
    return currentValue(lang, key);
  };
  const setDraft = (lang, key, v) => {
    setDrafts(prev => ({ ...prev, [lang]: { ...(prev[lang] || {}), [key]: v } }));
  };
  const isDirty = (lang, key) => draftValue(lang, key) !== currentValue(lang, key);
  const hasOverride = (lang, key) => !!overrides[lang]?.[key];

  const keys = useMemo(() => {
    const all = Object.keys(translations.en);
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(k => k.toLowerCase().includes(q) || (translations.en[k] || '').toLowerCase().includes(q));
  }, [search]);

  const ensureAuth = () => {
    if (needsPassword && !narrPassword) {
      toast({ variant: 'destructive', title: 'Enter your Narr password to save.' });
      return false;
    }
    return true;
  };

  const call = async (payload) => base44.functions.invoke('saveTranslation', {
    ...payload,
    email: needsPassword ? user?.email : undefined,
    narrPassword: needsPassword ? narrPassword : undefined,
  });

  const save = async (key) => {
    if (!ensureAuth()) return;
    setSavingKey(key);
    try {
      const res = await call({ key, lang: activeLang, value: draftValue(activeLang, key) });
      const data = res.data || {};
      if (data.ok) {
        toast({ title: 'Saved', description: `${activeLang}: ${key}` });
        await load();
        await reloadTranslations();
      } else {
        toast({ variant: 'destructive', title: 'Save failed', description: data.error || 'Unknown error.' });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
    } finally {
      setSavingKey(null);
    }
  };

  const revert = async (key) => {
    if (!ensureAuth()) return;
    setSavingKey(key);
    try {
      const res = await call({ key, lang: activeLang, mode: 'delete' });
      const data = res.data || {};
      if (data.ok) {
        toast({ title: 'Reverted', description: `${activeLang}: ${key} → baseline` });
        await load();
        await reloadTranslations();
      } else {
        toast({ variant: 'destructive', title: 'Revert failed', description: data.error || 'Unknown error.' });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Revert failed', description: err?.message });
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Loading translations…</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2"><Languages className="w-5 h-5 text-purple-400" /> UI Translations</h2>
        <p className="text-sm text-slate-400">Correct any string that reads unnaturally. Overrides go live for all customers on next load.</p>
      </div>

      {needsPassword && (
        <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-3 flex items-center gap-3">
          <Lock className="w-4 h-4 text-amber-400 shrink-0" />
          <Input type="password" value={narrPassword} onChange={e => setNarrPassword(e.target.value)} placeholder="Your Narr password (authorizes edits)" className="bg-slate-700 border-slate-600 text-white h-8" />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {UI_LANGUAGES.map(l => (
          <Button key={l.code} size="sm" variant={activeLang === l.code ? 'default' : 'outline'} onClick={() => setActiveLang(l.code)} className={activeLang === l.code ? 'bg-purple-600 hover:bg-purple-700' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}>
            {l.native}
          </Button>
        ))}
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter keys…" className="ml-auto w-48 bg-slate-800 border-slate-700 text-white h-9" />
      </div>

      <div className="space-y-2">
        {keys.map(key => {
          const dirty = isDirty(activeLang, key);
          const ov = hasOverride(activeLang, key);
          return (
            <div key={key} className="bg-slate-800 border border-slate-700 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs text-slate-400">{key}</span>
                {ov && <Badge className="text-[10px] bg-purple-900 text-purple-300 border-purple-700">edited</Badge>}
                {dirty && <Badge className="text-[10px] bg-amber-900 text-amber-300 border-amber-700">unsaved</Badge>}
              </div>
              <p className="text-xs text-slate-500 mb-1.5">EN: {englishSource(key)}</p>
              <div className="flex items-start gap-2">
                <textarea
                  value={draftValue(activeLang, key)}
                  onChange={e => setDraft(activeLang, key, e.target.value)}
                  rows={1}
                  className="flex-1 bg-slate-700 border-slate-600 text-white text-sm rounded-md px-2.5 py-2 resize-y min-h-[38px] focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <Button size="sm" onClick={() => save(key)} disabled={!dirty || savingKey === key} className="bg-emerald-600 hover:bg-emerald-700 gap-1 shrink-0">
                  {savingKey === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                </Button>
                {ov && (
                  <Button size="sm" variant="outline" onClick={() => revert(key)} disabled={savingKey === key} className="border-slate-600 text-slate-300 hover:bg-slate-700 gap-1 shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" /> Revert
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}