import React, { useState, useRef, useEffect } from 'react';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LANGUAGES } from '@/lib/languages';
import { base44 } from '@/api/base44Client';
import { Upload, Loader2, Languages, FileText, ArrowRight, AlertTriangle } from 'lucide-react';
import { extractTextFromFile } from '@/lib/fileTextExtractor';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage } from '@/lib/utils';

// Per the follow-up 23 audit's FOURTH review pass: `onTranslated` resets the whole TTS
// panel's segments/audio/subsection state in NarrationTtsEditor (wipes the document to
// start a fresh pass on the newly-translated/imported text) — but this panel's own
// Import/Translate & Load buttons used to be gated ONLY by this component's own local
// `translating`/`importing` state, completely independent of whether the TTS panel
// itself was mid-commit (a Continue/Save & Finish/per-line save awaiting its own TTS
// call). That let a narrator fire off a translation reset WHILE one of those commits was
// still in flight — the commit's own pending state (captured before the reset) would
// then resolve and resurrect the pre-reset document on top of what should have been
// wiped, discarding the fresh translation and any other unrelated draft in the process.
// `disabled` (passed as the TTS panel's own `passLocked`) closes that off the same way
// every other segments-mutating control on that panel already is — this panel simply
// can't be used to import/translate a replacement script while anything else has the
// floor.
//
// waypointSegmentId/waypointSegmentTitle (follow-up 28, revised in follow-up 29 — see
// CLAUDE_CHANGELOG.md for both): Enda originally reported the imported script always
// ending with an extra "segment code and name" line (e.g. "BOR1a-PS Lidl (Tsesmes) Car
// Park") that broke saving when he tried to delete it. Follow-up 28's investigation
// wrongly concluded that line was deliberately sitting at the bottom of his master
// documents; follow-up 29, after Enda uploaded the actual .odt, found the real cause —
// that title is a heading at the very TOP of his document (correct — it's how he tells
// his files apart), and `fileTextExtractor.js`'s .odt reader had a real bug that silently
// moved every heading to the END of the extracted text, which is what actually produced
// the "extra trailing line". That extractor bug is now fixed at the root (see
// `extractTextFromOdtXml` in fileTextExtractor.js), so this should no longer fire for
// .odt files with a real heading. It's kept in place as a backstop for any OTHER way a
// waypoint's own label could end up as a plain line of text — a .docx/.txt file where the
// title was typed as an ordinary line rather than a heading style, for instance — checking
// the FIRST and LAST non-empty line of a freshly-imported file against this waypoint's own
// known code/title and silently dropping it if — and only if — it matches one of those
// exactly (ignoring case/whitespace/trailing punctuation). Deliberately exact-match-only,
// never fuzzy: it will never touch a real narration line that merely happens to mention
// the location.
function normalizeForLabelMatch(str) {
  return (str || '')
    .trim()
    .toLowerCase()
    .replace(/[\s.:;\-–—]+$/g, '') // drop trailing punctuation/separators first…
    .replace(/\s+/g, ' ')          // …then collapse any remaining internal whitespace
    .trim();
}

function stripWaypointLabelLine(text, segmentId, segmentTitle) {
  if (!text) return text;
  const candidates = [
    [segmentId, segmentTitle].filter(Boolean).join(' '),
    segmentTitle,
    segmentId,
  ]
    .map(normalizeForLabelMatch)
    .filter(Boolean);
  if (candidates.length === 0) return text;

  let lines = text.split(/\r?\n/);

  // Check the last non-empty line first (the originally-reported shape).
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx--;
  if (lastIdx >= 0 && candidates.includes(normalizeForLabelMatch(lines[lastIdx]))) {
    lines.splice(lastIdx, 1);
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  }

  // Then check the first non-empty line (the shape a real heading-style title takes once
  // the .odt extractor bug above is fixed — this is now the normal, correct position for
  // it, so this only matters for other file types/conventions where it isn't a heading).
  let firstIdx = 0;
  while (firstIdx < lines.length && !lines[firstIdx].trim()) firstIdx++;
  if (firstIdx < lines.length && candidates.includes(normalizeForLabelMatch(lines[firstIdx]))) {
    lines.splice(firstIdx, 1);
    while (lines.length > 0 && !lines[0].trim()) lines.shift();
  }

  return lines.join('\n');
}

export default function TranslationPanel({ onTranslated, fixedLanguage, disabled = false, waypointSegmentId, waypointSegmentTitle, currentWalkId }) {
  const { keys: apiKeys } = useNarratorApiKeys();
  const [importedText, setImportedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [depositoryFileName, setDepositoryFileName] = useState(''); // set only when the CURRENT importedText came from the shared depository, not a manual pick
  const [checkingDepository, setCheckingDepository] = useState(false);
  const manualImportRef = useRef(false);
  const [targetLanguage, setTargetLanguage] = useState(fixedLanguage || 'English');

  // Per Enda: the language for a translation clone is fixed the moment it's cloned —
  // a narrator must never be able to translate a waypoint's script into a different
  // language than the clone was actually created for. Keeps this in sync if
  // fixedLanguage arrives after the initial render.
  useEffect(() => {
    if (fixedLanguage) setTargetLanguage(fixedLanguage);
  }, [fixedLanguage]);
  const [translating, setTranslating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  // Per Enda: some names in the source script are deliberately left in their own
  // original script (Greek, Cyrillic, Arabic) for the pronunciation dictionary to catch
  // — translateScript's own backend check (see its entry.ts) flags it here if one of
  // those doesn't survive translation intact, so a narrator can fix the spelling before
  // relying on it, rather than never knowing anything went wrong.
  const [preservationWarning, setPreservationWarning] = useState('');
  const fileInputRef = useRef(null);

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    manualImportRef.current = true; // a real manual pick always wins — see the depository effect below
    setError('');
    setPreservationWarning('');
    setDepositoryFileName('');
    setImporting(true);
    try {
      const text = await extractTextFromFile(file);
      if (!text || !text.trim()) {
        setError(`"${file.name}" contains no readable text.`);
        setImportedText('');
        setFileName('');
      } else {
        setImportedText(stripWaypointLabelLine(text, waypointSegmentId, waypointSegmentTitle));
        setFileName(file.name);
      }
    } catch (err) {
      setError(err.message || `Failed to read "${file.name}".`);
      setImportedText('');
      setFileName('');
    }
    setImporting(false);
    e.target.value = '';
  };

  // Per Enda: instead of an admin emailing every narrator each waypoint's master .odt
  // (12-13 emails per tour, and real risk of a narrator working from a stale local
  // copy), this waypoint's file — if the admin has one uploaded to the shared depository
  // for its segment_id — is fetched and pre-filled here automatically, the moment this
  // panel appears, with zero clicking. Reuses the EXACT SAME extraction/label-stripping
  // pipeline as a manual Import File pick (only the source of the raw bytes differs), so
  // everything downstream (Translate & Load, the preview box) behaves identically either
  // way.
  //
  // Runs once per waypoint, not on every keystroke: this component is remounted fresh
  // per waypoint (NarrationTtsEditor's own instance is `key={selectedWpIndex}` in
  // TourSimulator.jsx), so effect deps of just [currentWalkId, waypointSegmentId] are
  // enough — importedText/fileName are guaranteed empty the one time this fires. Never
  // overwrites a file the narrator already picked by hand in the meantime
  // (manualImportRef) — the depository is a convenience, never something that fights the
  // narrator for control of this box. Silent on "nothing there" or on any failure — the
  // manual Import File button always still works as a complete fallback.
  useEffect(() => {
    if (!currentWalkId || !waypointSegmentId) return;
    let cancelled = false;
    (async () => {
      setCheckingDepository(true);
      try {
        const res = await base44.functions.invoke('manageTourImportFiles', {
          action: 'get',
          walkId: currentWalkId,
          segment_id: waypointSegmentId,
          ...getNarratorAuthPayload(),
        });
        const file = res?.data?.file;
        if (!cancelled && !manualImportRef.current && file?.file_url) {
          const fileRes = await fetch(file.file_url);
          if (!fileRes.ok) throw new Error('download failed');
          const blob = await fileRes.blob();
          const niceName = file.filename || `${waypointSegmentId}.odt`;
          const nativeFile = new File([blob], niceName, { type: blob.type || 'application/vnd.oasis.opendocument.text' });
          const text = await extractTextFromFile(nativeFile);
          if (!cancelled && !manualImportRef.current && text && text.trim()) {
            setImportedText(stripWaypointLabelLine(text, waypointSegmentId, waypointSegmentTitle));
            setFileName(niceName);
            setDepositoryFileName(niceName);
          }
        }
      } catch {
        // Background convenience check — never surfaced as an error, see comment above.
      }
      if (!cancelled) setCheckingDepository(false);
    })();
    return () => { cancelled = true; };
  }, [currentWalkId, waypointSegmentId]);

  // The imported file is always the English master script (see this app's workflow —
  // narrators always start from an English original). If the chosen target language is
  // English too — e.g. Enda writing the English version of a tour himself, alongside a
  // Dutch one from the same import — there's genuinely nothing to translate. Skip the
  // Groq call entirely rather than running a same-language "translation" through the
  // model anyway: that would cost real API quota/time for a no-op, and risks the model
  // subtly rewording text that was already exactly right, for no reason at all.
  const isNoOpTranslation = targetLanguage === 'English';

  const handleTranslate = async () => {
    if (!importedText.trim()) {
      setError('Import a file first.');
      return;
    }
    if (isNoOpTranslation) {
      setError('');
      setPreservationWarning('');
      onTranslated(importedText);
      return;
    }
    if (!apiKeys.groq_api_key) {
      setError('No Groq API key found for your account yet. Add your own key via "API Keys" in the header.');
      return;
    }
    setError('');
    setPreservationWarning('');
    setTranslating(true);
    try {
      const response = await base44.functions.invoke('translateScript', {
        text: importedText,
        target_language: targetLanguage,
        apiKey: apiKeys.groq_api_key,
        ...getNarratorAuthPayload(),
      });
      if (response.data?.translated_text) {
        onTranslated(response.data.translated_text);
        if (response.data?.preservation_warning) {
          setPreservationWarning(response.data.preservation_warning);
        }
      } else {
        setError('Translation returned no text.');
      }
    } catch (err) {
      setError(getFnErrorMessage(err, 'Translation failed.'));
    }
    setTranslating(false);
  };

  return (
    <div className="bg-slate-800/60 rounded-lg border border-amber-600/30 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Languages className="w-4 h-4 text-amber-400" />
        <Label className="text-slate-300 text-sm font-medium">Translate Script</Label>
        <span className="text-xs text-slate-500 ml-1">import · translate · load into TTS</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input ref={fileInputRef} type="file" accept=".txt,.docx,.odt,.md,text/plain" className="hidden" onChange={handleImport} />
        <Button
          type="button" size="sm" variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={translating || importing || disabled}
          className="bg-blue-700/30 hover:bg-blue-700/50 border-blue-600/50 text-amber-400 hover:text-amber-300 gap-1.5"
        >
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {importing ? 'Reading…' : fileName ? 'Change File' : 'Import File'}
        </Button>
        {fileName ? (
          <span className="text-xs text-slate-400 flex items-center gap-1 max-w-[220px] truncate">
            <FileText className="w-3 h-3 shrink-0" /> {fileName}
            {depositoryFileName === fileName && (
              <span className="text-emerald-400/80 shrink-0">(shared depository)</span>
            )}
          </span>
        ) : checkingDepository ? (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Checking the shared depository…
          </span>
        ) : null}
      </div>

      {importedText && (
        <div className="bg-slate-900/50 rounded-md border border-slate-700 p-2 max-h-40 overflow-y-auto">
          <p className="text-xs text-slate-500 whitespace-pre-wrap">{importedText}</p>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-slate-400 text-xs mb-1 block">Translate to</Label>
          {fixedLanguage ? (
            <div className="h-8 flex items-center px-3 bg-slate-800 border border-slate-600 rounded-md text-slate-300 text-sm" title="Set when this clone was created — cannot be changed here.">
              {fixedLanguage}
            </div>
          ) : (
            <Select value={targetLanguage} onValueChange={setTargetLanguage} disabled={translating || disabled}>
              <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button
          type="button"
          onClick={handleTranslate}
          // Per the follow-up 23 audit's fifth review pass: this used to be missing
          // `importing` — while a NEW file was still being read (after clicking
          // "Change File" on top of an earlier import), this button stayed enabled and
          // would fire using the PREVIOUS file's still-current `importedText`, loading
          // the wrong document into the TTS panel a moment before the new file's text
          // even finished extracting. Now gated the same way the Import button already is.
          disabled={translating || importing || !importedText.trim() || disabled}
          className="bg-amber-600 hover:bg-amber-700 gap-2 text-white"
        >
          {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {translating ? 'Translating…' : isNoOpTranslation ? 'Load (already English)' : 'Translate & Load'}
        </Button>
      </div>

      {isNoOpTranslation && importedText && (
        <p className="text-xs text-slate-500">
          Target language is English, same as the imported master script — this will load
          the text as-is, no translation step needed.
        </p>
      )}

      {error && (
        <div className="text-red-400 text-xs bg-red-900/30 border border-red-700/50 rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}

      {preservationWarning && (
        <div className="flex items-start gap-1.5 text-amber-300 text-xs bg-amber-900/20 border border-amber-700/50 rounded-md px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{preservationWarning}</span>
        </div>
      )}
    </div>
  );
}