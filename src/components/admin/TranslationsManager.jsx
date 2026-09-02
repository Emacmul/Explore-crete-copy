import React, { useEffect, useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, RotateCcw, Languages, Wand2, AlertTriangle } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { translations, UI_LANGUAGES, LANGUAGE_NAME_BY_CODE } from '@/lib/i18n';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';

// Back-office editor for UI string overrides. Shows the English source for reference and
// the current value (override if one exists, otherwise the AI baseline) in an editable
// field per language. Save writes a Translation override; Revert deletes it so the
// baseline shows again. Overrides go live for all customers on next app load.
//
// Admins (reached via /Admin) authorize through their Base44 session. Narrators (reached
// via the Narr button, no Base44 session) authorize through the session token narrLogin
// issued at the moment they logged into Narr Studio — the actual password check happened
// there, once; nothing here re-asks for it. That token lives on `user` for as long as
// this browser tab's session lasts.
export default function TranslationsManager({ authMode, user }) {
  const { reloadTranslations } = useLanguage();
  const [activeLang, setActiveLang] = useState('nl');
  const [overrides, setOverrides] = useState({});
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [seedWarning, setSeedWarning] = useState('');
  const [seedingAll, setSeedingAll] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');

  const isNarr = authMode === 'narr';
  const { keys: apiKeys } = useNarratorApiKeys();

  const load = async () => {
    const res = await base44.functions.invoke('getTranslationOverrides', {});
    const list = res?.data?.translations || [];
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
  useEffect(() => { setSeedWarning(''); }, [activeLang]);

  const currentValue = (lang, key) => overrides[lang]?.[key] ?? translations[lang]?.[key] ?? translations.en[key] ?? key;
  // A key with neither a hand-written baseline (translations[lang]) nor a saved override is
  // showing raw English right now — "missing" in the sense the auto-translate pass below
  // fixes. Only en/nl/cs ever got a hand-written baseline, and even nl/cs never got a batch
  // of newer keys added after those blocks were last touched, so this can be non-empty for
  // any language including nl/cs.
  const isMissing = (lang, key) => translations[lang]?.[key] === undefined && !overrides[lang]?.[key];
  const missingKeysForLang = useMemo(
    () => Object.keys(translations.en).filter(k => isMissing(activeLang, k)),
    [activeLang, overrides]
  );
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

  const call = async (payload) => base44.functions.invoke('saveTranslation', {
    ...payload,
    email: isNarr ? user?.email : undefined,
    narrToken: isNarr ? user?.token : undefined,
  });

  const save = async (key) => {
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

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const refreshOverrides = async () => { await load(); await reloadTranslations(); };

  // Does the actual seed-then-save work for ONE language's missing keys, automatically waiting
  // out and retrying any keys that came back rate-limited rather than reporting a 429 as a
  // plain, permanent-looking failure.
  //
  // Enda's first real run (95 Dutch keys) came back "seeded 15 of 95" with no reason given, and
  // a second run (65 keys, after the chunking bug above was fixed) revealed the real, separate
  // cause: this Groq account's rate limit for the model used here is a flat 8000 tokens PER
  // MINUTE, and a small run of calls in a row exhausts that budget in one or two requests — every
  // later one gets rejected within the same minute purely because the budget hasn't refilled yet,
  // not because anything is actually wrong. seedUiTranslations now reports exactly which keys hit
  // that wall (`rate_limited_keys`) and how long Groq says to wait (`retry_after_ms`) instead of
  // retrying or sleeping inside that single backend call — a multi-minute sleep in a serverless
  // function risks the call itself timing out. Waiting is done HERE instead, round by round,
  // where a long wait is just normal, visible UI state (the banner already tells Enda to keep the
  // tab open) rather than a request that might get killed mid-sleep.
  //
  // `onSaved` is called right after every successful save, not just once at the very end — a
  // 22-language run can take the better part of an hour with all the rate-limit waiting built
  // in, and a run that only refreshes the screen once, at the very end, LOOKS identical to a run
  // that saved nothing at all for the entire time it's still going. Enda hit exactly that: 11
  // languages' worth of visible translation progress, checked mid-run, and every one of them
  // still showed "nothing saved" — not because the saves were failing, but because the on-screen
  // overrides hadn't been refreshed from the database since before the run started. Calling
  // `onSaved` after each round means what's on screen is always caught up with what's actually
  // in the database, whether the run is one language or twenty-two.
  //
  // A save that genuinely fails (as opposed to a translation that gets rate-limited) is a
  // different kind of problem — it means every string this pass just translated, and every
  // language after this one, is heading for the exact same wall. Continuing to spend Groq calls
  // on translations that can never be persisted would just repeat Enda's bad experience with
  // extra steps, so a real save failure is thrown as a tagged `fatal` error that stops the whole
  // run (see handleSeedAllMissing's catch below) instead of being logged and quietly continuing.
  const seedMissingForLanguage = async (langCode, targetLanguageName, missingKeys, authPayload, onProgress, onSaved) => {
    let remaining = missingKeys;
    let totalSaved = 0;
    let totalFailed = 0;
    const failureReasons = new Set();
    const placeholderWarnings = [];
    // Per Enda: this only needs to run once per language, and he'd rather wait it out than pay
    // Groq for a higher rate limit — so this is generous on purpose. Worst case (a full ~200-key
    // language, badly depleted budget, ~3min waits each round) is roughly 15 rounds * ~3min ≈
    // 45 minutes, entirely unattended waiting — not fast, but it only has to happen once.
    const MAX_ROUNDS = 15;

    for (let round = 1; round <= MAX_ROUNDS && remaining.length > 0; round++) {
      const entries = {};
      for (const k of remaining) entries[k] = translations.en[k];

      const res = await base44.functions.invoke('seedUiTranslations', {
        entries, target_language: targetLanguageName, apiKey: apiKeys.groq_api_key, ...authPayload,
      });
      const data = res.data || {};
      if (data.error && !data.translations) {
        failureReasons.add(data.error);
        totalFailed += remaining.length;
        break;
      }

      const produced = data.translations || {};
      if (Object.keys(produced).length > 0) {
        let saveData;
        try {
          const saveRes = await base44.functions.invoke('saveTranslationsBulk', {
            lang: langCode, entries: produced, ...authPayload,
          });
          saveData = saveRes.data || {};
        } catch (invokeErr) {
          const err = new Error(`Translations are being produced but NOT saved — saveTranslationsBulk failed (${invokeErr?.message || 'unknown error'}). Stopping rather than spending more Groq calls on translations that can't be persisted. Double-check saveTranslationsBulk is actually deployed in Base44 — it's a separate, newer function from seedUiTranslations and needs its own create-then-redeploy pass, not just a refresh.`);
          err.fatal = true;
          throw err;
        }
        if (saveData.error) {
          const err = new Error(`Translations are being produced but NOT saved (saveTranslationsBulk says: ${saveData.error}). Stopping rather than spending more Groq calls on translations that can't be persisted. Double-check saveTranslationsBulk is actually deployed in Base44 — it's a separate, newer function from seedUiTranslations and needs its own create-then-redeploy pass, not just a refresh.`);
          err.fatal = true;
          throw err;
        }
        (saveData.errors || []).forEach(e => failureReasons.add(e.error || String(e)));
        totalSaved += saveData.saved || 0;
        if ((saveData.saved || 0) > 0) await onSaved?.();
      }
      (data.failure_reasons || []).forEach(r => failureReasons.add(r));
      if (data.placeholder_warning) placeholderWarnings.push(data.placeholder_warning);

      const rateLimited = data.rate_limited_keys || [];
      const otherFailedCount = (data.failed_keys?.length || 0) - rateLimited.length;
      if (otherFailedCount > 0) totalFailed += otherFailedCount;

      if (rateLimited.length === 0) {
        remaining = [];
        break;
      }
      if (round === MAX_ROUNDS) {
        totalFailed += rateLimited.length;
        failureReasons.add(`Still rate-limited on ${rateLimited.length} string(s) after ${MAX_ROUNDS} waits — Groq's per-minute budget for this key is genuinely this tight. Just run Auto-translate again later; it'll pick up only what's still missing.`);
        break;
      }
      // Cap raised from 70s to 3 minutes: a live run showed Groq itself reporting
      // retry_after_ms: 99000 (99s) while every key in the chunk was still rate-limited — the
      // old 70s ceiling would have clamped that down and had this loop knock again *before*
      // Groq's own window had actually passed, getting rejected again and making a recoverable
      // per-minute budget look like a permanent wall. Trust Groq's own number up to 3 minutes;
      // beyond that something bigger than a per-minute limit is going on and no wait length
      // coded here would be the right one anyway.
      const waitMs = Math.min(Math.max(data.retry_after_ms || 10000, 3000), 180000) + 1000;
      onProgress?.(`Rate limit reached — waiting ${Math.ceil(waitMs / 1000)}s before continuing (${rateLimited.length} string${rateLimited.length === 1 ? '' : 's'} left for ${targetLanguageName})…`);
      await sleep(waitMs);
      remaining = rateLimited;
    }

    return { totalSaved, totalFailed, failureReasons: [...failureReasons], placeholderWarnings };
  };

  // Auto-translate every key currently falling back to raw English for activeLang, and save
  // the results as ordinary overrides — the same seeding pass Enda asked for, so a narrator
  // opening a language with no baseline lands on a machine-translated draft to correct rather
  // than a blank slate. Never touches a key that already has a hand-written baseline or a
  // saved override, so it can never clobber a real translation or someone's own correction.
  const handleSeedMissing = async () => {
    if (missingKeysForLang.length === 0) return;
    if (!apiKeys.groq_api_key) {
      toast({ variant: 'destructive', title: 'Groq API key required', description: 'Add your own Groq key under "API Keys" in the Admin Panel header before auto-translating.' });
      return;
    }
    const targetLanguageName = LANGUAGE_NAME_BY_CODE[activeLang] || activeLang;
    const authPayload = { email: isNarr ? user?.email : undefined, narrToken: isNarr ? user?.token : undefined };
    setSeeding(true);
    setSeedWarning('');
    try {
      const { totalSaved, totalFailed, failureReasons, placeholderWarnings } = await seedMissingForLanguage(
        activeLang, targetLanguageName, missingKeysForLang, authPayload, setProgressMessage, refreshOverrides
      );
      toast({
        title: 'Auto-translated',
        description: `Seeded ${totalSaved} of ${missingKeysForLang.length} missing strings for ${targetLanguageName}.${totalFailed ? ` ${totalFailed} couldn't be translated — fill those in by hand.` : ''}`,
      });
      const warnings = [...placeholderWarnings, ...failureReasons];
      if (warnings.length > 0) setSeedWarning(warnings.join(' '));
      await refreshOverrides();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Auto-translate failed', description: err?.message });
      await refreshOverrides(); // show whatever DID get saved before the failure, not a stale pre-run view
    } finally {
      setSeeding(false);
      setProgressMessage('');
    }
  };

  // Per Enda: gating seeding on a human opening each of 23 language tabs one at a time is a
  // self-fulfilling non-action — a language nobody thinks to check never gets backfilled, and
  // "nobody's looked at it" is exactly the state most of these 20 languages are in right now.
  // This backfills every language in one action instead, so nothing depends on someone
  // remembering to click through the full list. Still entirely on-demand (never runs by
  // itself) — it's just one button covering all languages instead of 22 separate ones.
  const handleSeedAllMissing = async () => {
    if (!apiKeys.groq_api_key) {
      toast({ variant: 'destructive', title: 'Groq API key required', description: 'Add your own Groq key under "API Keys" in the Admin Panel header before auto-translating.' });
      return;
    }
    const targets = UI_LANGUAGES.filter(l => l.code !== 'en');
    const authPayload = { email: isNarr ? user?.email : undefined, narrToken: isNarr ? user?.token : undefined };
    setSeedingAll(true);
    setSeedWarning('');
    let totalSeeded = 0;
    let totalFailed = 0;
    let languagesTouched = 0;
    const warnings = [];
    try {
      for (const l of targets) {
        const missing = Object.keys(translations.en).filter(k => isMissing(l.code, k));
        if (missing.length === 0) continue;
        languagesTouched++;
        const targetLanguageName = LANGUAGE_NAME_BY_CODE[l.code] || l.name;
        setProgressMessage(`Translating ${l.native} — ${missing.length} string${missing.length === 1 ? '' : 's'} (language ${languagesTouched} of ${targets.length})…`);

        try {
          const { totalSaved, totalFailed: langFailed, failureReasons, placeholderWarnings } = await seedMissingForLanguage(
            l.code, targetLanguageName, missing, authPayload,
            (msg) => setProgressMessage(`${l.native}: ${msg}`),
            refreshOverrides
          );
          totalSeeded += totalSaved;
          totalFailed += langFailed;
          failureReasons.forEach(r => warnings.push(`${l.native}: ${r}`));
          placeholderWarnings.forEach(w => warnings.push(`${l.native}: ${w}`));
        } catch (langErr) {
          if (langErr?.fatal) {
            // Saving itself is broken — every remaining language would hit the exact same wall,
            // so stop here instead of quietly burning through 20 more Groq passes for nothing
            // (this is the failure Enda actually hit: 11 languages' worth of visible "progress"
            // with nothing persisted). Refresh first so whatever DID save before this shows up.
            await refreshOverrides();
            totalFailed += missing.length;
            warnings.push(`${l.native}: ${langErr.message}`);
            toast({ variant: 'destructive', title: 'Auto-translate stopped', description: langErr.message });
            break;
          }
          // An ordinary per-language hiccup (not a save failure) shouldn't stop the rest — it's
          // simply left missing, and can be retried later from its own tab or by running "all
          // languages" again.
          totalFailed += missing.length;
          warnings.push(`${l.native}: auto-translate failed — ${langErr?.message || 'unknown error'}.`);
        }
      }

      if (languagesTouched === 0) {
        toast({ title: 'Nothing to seed', description: 'Every language already has a baseline or correction for every string.' });
      } else {
        toast({
          title: 'Auto-translate all done',
          description: `Seeded ${totalSeeded} string${totalSeeded === 1 ? '' : 's'} across ${languagesTouched} language${languagesTouched === 1 ? '' : 's'}.${totalFailed ? ` ${totalFailed} couldn't be translated.` : ''}`,
        });
      }
      if (warnings.length > 0) setSeedWarning(warnings.join(' '));
      await refreshOverrides();
    } finally {
      setSeedingAll(false);
      setProgressMessage('');
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

      <div className="flex items-center justify-between gap-3 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm text-slate-300">Backfill every language at once, rather than opening each tab in turn — this can take several minutes for 20+ languages; keep this tab open while it runs.</p>
          {seedingAll && progressMessage && <p className="text-xs text-slate-500 mt-1">{progressMessage}</p>}
        </div>
        <Button size="sm" onClick={handleSeedAllMissing} disabled={seeding || seedingAll} className="bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-white gap-2 shrink-0">
          {seedingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Auto-translate all languages
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {UI_LANGUAGES.map(l => (
          <Button key={l.code} size="sm" variant={activeLang === l.code ? 'default' : 'outline'} onClick={() => setActiveLang(l.code)} className={activeLang === l.code ? 'bg-purple-600 hover:bg-purple-700' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}>
            {l.native}
          </Button>
        ))}
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter keys…" className="ml-auto w-48 bg-slate-800 border-slate-700 text-white h-9" />
      </div>

      {activeLang !== 'en' && (
        <div className="flex items-center justify-between gap-3 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm text-slate-300">
              {missingKeysForLang.length > 0
                ? `${missingKeysForLang.length} string${missingKeysForLang.length === 1 ? '' : 's'} in ${LANGUAGE_NAME_BY_CODE[activeLang] || activeLang} ${missingKeysForLang.length === 1 ? 'has' : 'have'} no baseline or correction yet — showing raw English below until seeded.`
                : `Every string has a baseline or correction for ${LANGUAGE_NAME_BY_CODE[activeLang] || activeLang}.`}
            </p>
            {seeding && progressMessage && <p className="text-xs text-slate-500 mt-1">{progressMessage}</p>}
          </div>
          {missingKeysForLang.length > 0 && (
            <Button size="sm" onClick={handleSeedMissing} disabled={seeding || seedingAll} className="bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-white gap-2 shrink-0">
              {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              Auto-translate {missingKeysForLang.length} missing
            </Button>
          )}
        </div>
      )}
      {seedWarning && (
        <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {seedWarning}
        </div>
      )}

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
                {isMissing(activeLang, key) && <Badge className="text-[10px] bg-slate-700 text-slate-400 border-slate-600">English fallback</Badge>}
              </div>
              <p className="text-xs text-slate-500 mb-1.5">EN: {englishSource(key)}</p>
              <div className="flex items-start gap-2">
                <textarea
                  value={draftValue(activeLang, key)}
                  onChange={e => setDraft(activeLang, key, e.target.value)}
                  rows={1}
                  className="flex-1 bg-slate-700 border-slate-600 text-white text-sm rounded-md px-2.5 py-2 resize-y min-h-[38px] focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <Button size="sm" onClick={() => save(key)} disabled={savingKey === key} className="bg-emerald-600 hover:bg-emerald-700 gap-1 shrink-0">
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
