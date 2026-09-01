import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, Search, Loader2, Plus, Pencil, Check, X, Copy, ArrowRightToLine, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage, withTimeout } from '@/lib/utils';

// Per Enda: the pronunciation dictionary that steers PCV audio now works for every
// language, but it only helps if the SAME spelling — original script, e.g. Greek names in Greek letters —
// appears in both LinguaGloss (the separate dictionary app) and the actual tour script.
// This pop-up is the bridge between the two: check a word is right, copy/insert the
// dictionary's exact spelling into the script, or add a script word LinguaGloss doesn't
// have yet — without ever leaving this editor. Talks to LinguaGloss entirely through the
// pronunciationDictionary backend function (see its own comment for the API-key story);
// this component knows nothing about that, it only calls the one function.
//
// Deliberately self-contained (fetches its own data, owns its own add/edit state) so it
// can be dropped into any subsegment block — TtsSegmentCard.jsx and WaypointPaceEditor.jsx
// both mount one independently — without either of those already-intricate files needing
// to know anything about dictionaries.
//
// onInsert is optional: when the caller CAN take text right now (a line's quick-editor is
// open, or WaypointPaceEditor's box is simply always-editable), it's a function that
// splices the given word in at that line's cursor. When it's not provided (e.g. this
// line's editor isn't open yet), every row still offers Copy — the dictionary is always at
// least a read/verify/add tool, never blocked by an unrelated lock.
export default function PronunciationDictionaryDialog({ open, onClose, onInsert, initialQuery = '' }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [query, setQuery] = useState(initialQuery);

  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ original_word: '', language_origin: '', ipa_notation: '' });
  const [savingId, setSavingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const [newWord, setNewWord] = useState(initialQuery);
  const [newLanguage, setNewLanguage] = useState('');
  const [newIpa, setNewIpa] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await withTimeout(
        base44.functions.invoke('pronunciationDictionary', { action: 'list', ...getNarratorAuthPayload() }),
        20000,
        'Loading the dictionary is taking too long — please try again.'
      );
      if (res?.data?.error) throw new Error(res.data.error);
      setEntries(res?.data?.entries || []);
      setLanguages(res?.data?.languages || []);
    } catch (err) {
      setError(getFnErrorMessage(err, 'Could not load the pronunciation dictionary.'));
    }
    setLoading(false);
  }, []);

  // Fresh, real data every time this opens — several people may add/edit entries from
  // different waypoints (or from LinguaGloss directly), so a cached list would risk
  // showing a word as "missing" when it was really just added a minute ago elsewhere.
  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery || '');
    setNewWord(initialQuery || '');
    setNewLanguage('');
    setNewIpa('');
    setAddError('');
    setEditingId(null);
    load();
  }, [open, initialQuery, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? entries
      : entries.filter((e) =>
          (e.original_word || '').toLowerCase().includes(q)
          || (e.language_origin || '').toLowerCase().includes(q)
          || (e.ipa_notation || '').toLowerCase().includes(q)
        );
    return [...list].sort((a, b) => (a.original_word || '').localeCompare(b.original_word || ''));
  }, [entries, query]);

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setEditDraft({
      original_word: entry.original_word || '',
      language_origin: entry.language_origin || '',
      ipa_notation: entry.ipa_notation || '',
    });
  };

  const saveEdit = async (id) => {
    if (!editDraft.original_word.trim() || !editDraft.language_origin.trim()) return;
    setSavingId(id);
    setError('');
    try {
      const res = await base44.functions.invoke('pronunciationDictionary', {
        action: 'update',
        id,
        original_word: editDraft.original_word.trim(),
        language_origin: editDraft.language_origin.trim(),
        ipa_notation: editDraft.ipa_notation.trim(),
        ...getNarratorAuthPayload(),
      });
      if (res?.data?.error) throw new Error(res.data.error);
      const saved = res.data.entry;
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...saved } : e)));
      setEditingId(null);
    } catch (err) {
      setError(getFnErrorMessage(err, 'Could not save that change.'));
    }
    setSavingId(null);
  };

  const handleAdd = async () => {
    setAddError('');
    if (!newWord.trim()) { setAddError('A word or name is required.'); return; }
    if (!newLanguage.trim()) { setAddError('Pick a language.'); return; }
    setAdding(true);
    try {
      const res = await base44.functions.invoke('pronunciationDictionary', {
        action: 'create',
        original_word: newWord.trim(),
        language_origin: newLanguage.trim(),
        ipa_notation: newIpa.trim(),
        ...getNarratorAuthPayload(),
      });
      if (res?.data?.error) throw new Error(res.data.error);
      setEntries((prev) => [...prev, res.data.entry]);
      setNewWord('');
      setNewIpa('');
    } catch (err) {
      setAddError(getFnErrorMessage(err, 'Could not add that entry.'));
    }
    setAdding(false);
  };

  const handleCopy = async (entry) => {
    try {
      await navigator.clipboard.writeText(entry.original_word);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1500);
    } catch { /* clipboard blocked by the browser — Insert (when available) still works */ }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="max-w-2xl bg-slate-900 border-slate-700 max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Pronunciation Dictionary
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-slate-400 -mt-2">
          A word has to match EXACTLY between here and the tour script — same original-language
          spelling (e.g. Greek names in Greek script) — or PCV audio won't pick up the right
          pronunciation.{' '}
          {onInsert ? 'Insert drops the dictionary’s exact spelling straight into this line.' : 'Copy it, then paste it into the script yourself.'}
        </p>

        <div className="relative shrink-0">
          <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the dictionary…"
            className="bg-slate-800 border-slate-600 text-white pl-8"
            autoFocus
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0" /> <span className="flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={load} className="bg-red-900/20 border-red-500 text-red-200 hover:bg-red-900/40 shrink-0">Retry</Button>
          </div>
        )}

        {/* The one required scroll bar — everything above/below this stays put, only the
            entry list itself scrolls, so a long dictionary never pushes the Add-new form
            (or the search box) off screen. */}
        <div className="flex-1 min-h-[140px] overflow-y-auto border border-slate-700 rounded-lg divide-y divide-slate-800">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm p-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading dictionary…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-slate-500 italic p-4">
              {entries.length === 0 ? 'No entries in the dictionary yet — add the first one below.' : 'No entries match your search.'}
            </div>
          ) : (
            filtered.map((entry) => (
              <div key={entry.id} className="p-2.5">
                {editingId === entry.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editDraft.original_word}
                      onChange={(e) => setEditDraft((d) => ({ ...d, original_word: e.target.value }))}
                      className="bg-amber-100 border-amber-300 text-black text-sm"
                      placeholder="Word or name, original script"
                    />
                    <div className="flex gap-2">
                      <Select value={editDraft.language_origin} onValueChange={(v) => setEditDraft((d) => ({ ...d, language_origin: v }))}>
                        <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-9 text-sm w-36 shrink-0">
                          <SelectValue placeholder="Language" />
                        </SelectTrigger>
                        <SelectContent>
                          {languages.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input
                        value={editDraft.ipa_notation}
                        onChange={(e) => setEditDraft((d) => ({ ...d, ipa_notation: e.target.value }))}
                        placeholder="IPA notation (optional)"
                        className="bg-amber-100 border-amber-300 text-black text-sm font-mono flex-1"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={savingId === entry.id} className="bg-blue-700/30 hover:bg-blue-700/50 border-blue-600/50 text-slate-200">
                        <X className="w-3.5 h-3.5 mr-1" /> Cancel
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(entry.id)} disabled={savingId === entry.id} className="bg-blue-600 hover:bg-blue-500 text-white">
                        {savingId === entry.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{entry.original_word}</span>
                        <span className="text-[11px] text-slate-500 uppercase tracking-wide">{entry.language_origin}</span>
                      </div>
                      {entry.ipa_notation && <span className="text-xs text-slate-400 font-mono">{entry.ipa_notation}</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(entry)}
                        title="Copy this spelling"
                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-700 text-slate-400 transition-colors"
                      >
                        {copiedId === entry.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      {onInsert && (
                        <button
                          type="button"
                          onClick={() => onInsert(entry.original_word)}
                          title="Insert into this line"
                          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-700 text-purple-400 transition-colors"
                        >
                          <ArrowRightToLine className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        title="Edit this entry"
                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-700 text-slate-400 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-700 pt-3 space-y-2 shrink-0">
          <Label className="text-slate-300 text-sm">Not in the dictionary yet? Add it</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              placeholder="Word or name, original script"
              className="bg-slate-800 border-slate-600 text-white flex-1"
            />
            <Select value={newLanguage} onValueChange={setNewLanguage}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white sm:w-36 shrink-0">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                {languages.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={newIpa}
              onChange={(e) => setNewIpa(e.target.value)}
              placeholder="IPA (optional)"
              className="bg-slate-800 border-slate-600 text-white font-mono sm:w-36"
            />
            <Button onClick={handleAdd} disabled={adding} className="bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 gap-1.5">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </Button>
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
