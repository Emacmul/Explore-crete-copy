import React, { useState, useRef } from 'react';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LANGUAGES } from '@/lib/languages';
import { base44 } from '@/api/base44Client';
import { Upload, Loader2, Languages, FileText, ArrowRight } from 'lucide-react';
import { extractTextFromFile } from '@/lib/fileTextExtractor';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';

export default function TranslationPanel({ onTranslated }) {
  const { keys: apiKeys } = useNarratorApiKeys();
  const [importedText, setImportedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [translating, setTranslating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setImporting(true);
    try {
      const text = await extractTextFromFile(file);
      if (!text || !text.trim()) {
        setError(`"${file.name}" contains no readable text.`);
        setImportedText('');
        setFileName('');
      } else {
        setImportedText(text);
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

  const handleTranslate = async () => {
    if (!importedText.trim()) {
      setError('Import a file first.');
      return;
    }
    if (!apiKeys.groq_api_key) {
      setError('No Groq API key found for your account yet. Add your own key via "API Keys" in the header.');
      return;
    }
    setError('');
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
      } else {
        setError('Translation returned no text.');
      }
    } catch (err) {
      setError(err.message || 'Translation failed.');
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
          disabled={translating || importing}
          className="border-slate-500 text-slate-300 gap-1.5"
        >
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {importing ? 'Reading…' : fileName ? 'Change File' : 'Import File'}
        </Button>
        {fileName && (
          <span className="text-xs text-slate-400 flex items-center gap-1 max-w-[180px] truncate">
            <FileText className="w-3 h-3 shrink-0" /> {fileName}
          </span>
        )}
      </div>

      {importedText && (
        <div className="bg-slate-900/50 rounded-md border border-slate-700 p-2 max-h-20 overflow-y-auto">
          <p className="text-xs text-slate-500 whitespace-pre-wrap">{importedText.slice(0, 250)}{importedText.length > 250 ? '…' : ''}</p>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-slate-400 text-xs mb-1 block">Translate to</Label>
          <Select value={targetLanguage} onValueChange={setTargetLanguage} disabled={translating}>
            <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang} value={lang}>{lang}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          onClick={handleTranslate}
          disabled={translating || !importedText.trim()}
          className="bg-amber-600 hover:bg-amber-700 gap-2 text-white"
        >
          {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {translating ? 'Translating…' : 'Translate & Load'}
        </Button>
      </div>

      {error && (
        <div className="text-red-400 text-xs bg-red-900/30 border border-red-700/50 rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}
    </div>
  );
}