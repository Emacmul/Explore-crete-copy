import React, { useState, useRef } from 'react';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { LANGUAGES } from '@/lib/languages';
import { parseScript, rebuildScript, countCharacters, countBreaks } from '@/lib/ttsParser';
import TtsSegmentCard from './TtsSegmentCard';
import TranslationPanel from './TranslationPanel';
import AudioPlayer from '@/components/ui/AudioPlayer';
import { Loader2, Sparkles, Pause, Play, Download, Braces, FileText, Square } from 'lucide-react';
import { downloadScriptAsDocx } from '@/lib/docxExporter';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage } from '@/lib/utils';

const VOICES = [
  { value: 'NEUTRAL', label: 'Default voice (auto)' },
  { value: 'FEMALE', label: 'Female voice' },
  { value: 'MALE', label: 'Male voice' },
];

const LANG_TO_CODE = {
  English: 'en-US', Dutch: 'nl-NL', Czech: 'cs-CZ', German: 'de-DE',
  French: 'fr-FR', Italian: 'it-IT', Arabic: 'ar-XA', Hebrew: 'he-IL',
  Polish: 'pl-PL', Spanish: 'es-ES', Portuguese: 'pt-PT', Turkish: 'tr-TR',
  Russian: 'ru-RU', Hungarian: 'hu-HU',
};

const MAX_CHARS = 5000;

export default function NarrationTtsEditor({ script, audioUrl, onScriptChange, onAudioChange }) {
  const { keys: apiKeys } = useNarratorApiKeys();
  const [selectedVoice, setSelectedVoice] = useState('NEUTRAL');
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [error, setError] = useState('');
  const [segments, setSegments] = useState(null);
  const [segmentAudios, setSegmentAudios] = useState({});
  const [generatingSegmentId, setGeneratingSegmentId] = useState(null);
  const [generatingCombined, setGeneratingCombined] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(null);
  const [debugLog, setDebugLog] = useState([]);
  const textareaRef = useRef(null);
  const currentAudioRef = useRef(null);
  const stopRef = useRef(false);

  const charCount = (script || '').length;
  const overLimit = charCount > MAX_CHARS;

  const addLog = (msg) => setDebugLog((prev) => [...prev, msg]);

  const insertBreakTag = (tag) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onScriptChange((script || '') + tag);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newScript = (script || '').slice(0, start) + tag + (script || '').slice(end);
    onScriptChange(newScript);
    setSegments(null);
    setSegmentAudios({});
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    }, 0);
  };

  const handleTextareaChange = (e) => {
    onScriptChange(e.target.value);
    if (segments) {
      setSegments(null);
      setSegmentAudios({});
    }
  };

  const handleParseAndGenerate = async () => {
    if (!script || !script.trim()) {
      setError('Please import or write a script first.');
      return;
    }
    if (overLimit) {
      setError(`Script exceeds the ${MAX_CHARS} character limit.`);
      return;
    }
    if (!apiKeys.google_tts_api_key) {
      setError('No Google TTS API key found for your account yet. Add your own key via "API Keys" in the header.');
      return;
    }

    setError('');
    setDebugLog([]);
    const parsed = parseScript(script);
    setSegments(parsed);
    setSegmentAudios({});

    const languageCode = LANG_TO_CODE[selectedLanguage] || 'en-US';
    const audios = {};

    for (const seg of parsed) {
      if (seg.type !== 'text') continue;
      setGeneratingSegmentId(seg.id);
      addLog(`Generating segment ${seg.id}…`);
      addLog(`Language: ${languageCode}`);
      addLog(`Text length: ${seg.content.length}`);
      try {
        const response = await base44.functions.invoke('generateTts', {
          text: seg.content,
          gender: selectedVoice,
          language_code: languageCode,
          apiKey: apiKeys.google_tts_api_key,
          ...getNarratorAuthPayload(),
        });
        if (response.data?.url) {
          audios[seg.id] = response.data.url;
          addLog(`Segment ${seg.id}: OK`);
        } else {
          addLog(`Segment ${seg.id}: no URL returned`);
        }
      } catch (err) {
        const msg = getFnErrorMessage(err);
        addLog(`Segment ${seg.id}: ERROR — ${msg}`);
        setError(`Segment ${seg.id} failed: ${msg}`);
      }
    }

    setSegmentAudios(audios);
    setGeneratingSegmentId(null);
    addLog(`Done. ${Object.keys(audios).length} segment(s) generated.`);
  };

  const handleDurationChange = (segmentId, newDuration) => {
    setSegments((prev) => {
      if (!prev) return prev;
      const updated = prev.map((seg) =>
        seg.id === segmentId ? { ...seg, duration: newDuration } : seg
      );
      onScriptChange(rebuildScript(updated));
      return updated;
    });
  };

  const playSegment = (segmentId) => {
    const url = segmentAudios[segmentId];
    if (!url) return;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    const segIndex = segments?.findIndex((s) => s.id === segmentId);
    setCurrentPlayingIndex(segIndex);
    const audio = new Audio(url);
    currentAudioRef.current = audio;
    audio.onended = () => setCurrentPlayingIndex(null);
    audio.onerror = () => setCurrentPlayingIndex(null);
    audio.play().catch(() => setCurrentPlayingIndex(null));
  };

  const handleBuildAndPlay = async () => {
    if (!segments || playing) return;
    stopRef.current = false;
    setPlaying(true);
    setError('');

    for (let i = 0; i < segments.length; i++) {
      if (stopRef.current) break;
      const seg = segments[i];
      setCurrentPlayingIndex(i);

      if (seg.type === 'text' && segmentAudios[seg.id]) {
        await new Promise((resolve) => {
          const audio = new Audio(segmentAudios[seg.id]);
          currentAudioRef.current = audio;
          audio.onended = resolve;
          audio.onerror = resolve;
          audio.play().catch(resolve);
        });
      } else if (seg.type === 'pause') {
        await new Promise((resolve) => {
          setTimeout(resolve, seg.duration * 1000);
        });
      }
    }

    setCurrentPlayingIndex(null);
    setPlaying(false);

    if (stopRef.current) return;

    setGeneratingCombined(true);
    addLog('Generating combined audio…');
    try {
      const response = await base44.functions.invoke('generateTts', {
        text: script,
        gender: selectedVoice,
        language_code: LANG_TO_CODE[selectedLanguage] || 'en-US',
        apiKey: apiKeys.google_tts_api_key,
        ...getNarratorAuthPayload(),
      });
      if (response.data?.url) {
        onAudioChange(response.data.url);
        addLog('Combined audio saved.');
      }
    } catch (err) {
      const msg = getFnErrorMessage(err);
      addLog(`Combined audio ERROR: ${msg}`);
      setError(`Combined audio failed: ${msg}`);
    }
    setGeneratingCombined(false);
  };

  const handleStopPlay = () => {
    stopRef.current = true;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    setPlaying(false);
    setCurrentPlayingIndex(null);
  };

  const handleDownload = async () => {
    // Download the full edited script as .docx (break tags preserved)
    if (script) {
      downloadScriptAsDocx(script, 'narration_script.docx');
    }

    // Download the full combined audio as .mp3
    if (audioUrl) {
      try {
        const response = await fetch(audioUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'narration_audio.mp3';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = 'narration_audio.mp3';
        a.target = '_blank';
        a.click();
      }
    }
  };

  const hasSegmentAudios = Object.keys(segmentAudios).length > 0;

  return (
    <div className="bg-slate-800/50 rounded-lg border border-blue-600/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-blue-400" />
        <Label className="text-white text-sm font-bold">Narration Script & TTS</Label>
        <span className="text-xs text-slate-400 ml-1">import, edit, generate audio</span>
      </div>

      <TranslationPanel onTranslated={(text) => {
        onScriptChange(text);
        setSegments(null);
        setSegmentAudios({});
      }} />

      {/* Insert break tags at cursor */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-500">Insert pause:</span>
        <Button type="button" size="sm" variant="ghost"
          onClick={() => insertBreakTag('<break time="0.5s"/>')}
          className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
          <Pause className="w-3 h-3" /> 0.5s (default)
        </Button>
        {[1, 2, 3].map((s) => (
          <Button key={s} type="button" size="sm" variant="ghost"
            onClick={() => insertBreakTag(`<break time="${s}s"/>`)}
            className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
            <Pause className="w-3 h-3" /> {s}s
          </Button>
        ))}
      </div>

      {/* Editable script textarea */}
      <div>
        <Textarea
          ref={textareaRef}
          value={script || ''}
          onChange={handleTextareaChange}
          placeholder={'Import a script file or write here...\n\nUse <break time="2s"/> for pauses.'}
          rows={6}
          className="bg-slate-700 border-slate-500 text-white text-sm font-mono resize-y"
        />
        <div className="flex items-center justify-between mt-1">
          <span className={`text-xs ${overLimit ? 'text-red-400' : 'text-slate-500'}`}>
            {charCount} / {MAX_CHARS} characters
          </span>
          {charCount > 0 && (
            <span className="text-xs text-green-500">Free via Google TTS (1M chars/month)</span>
          )}
        </div>
      </div>

      {/* Voice + Language */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-slate-400 text-xs mb-1 block">Voice (Google)</Label>
          <Select value={selectedVoice} onValueChange={setSelectedVoice}>
            <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-slate-400 text-xs mb-1 block">Language</Label>
          <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
            <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Parse & Generate */}
      <Button
        type="button"
        onClick={handleParseAndGenerate}
        disabled={generatingSegmentId !== null || overLimit || !script?.trim()}
        className="w-full bg-purple-600 hover:bg-purple-700 gap-2 text-white"
      >
        {generatingSegmentId !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Braces className="w-4 h-4" />}
        {generatingSegmentId !== null ? 'Generating…' : 'Parse & Generate'}
      </Button>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Debug log */}
      {debugLog.length > 0 && (
        <div className="bg-slate-900/60 rounded-lg p-2.5 text-xs text-slate-400 font-mono space-y-0.5 max-h-32 overflow-y-auto">
          {debugLog.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {/* Segments list */}
      {segments && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            <span>{countCharacters(segments)} characters</span>
            <span>·</span>
            <span>{countBreaks(segments)} breaks detected</span>
            <span className="text-slate-600">Use &lt;break time="Xs"/&gt; for pauses</span>
          </div>
          {segments.map((seg, idx) => (
            <TtsSegmentCard
              key={seg.id}
              segment={seg}
              audioUrl={segmentAudios[seg.id]}
              isGenerating={generatingSegmentId === seg.id}
              isPlaying={currentPlayingIndex === idx}
              onPlay={playSegment}
              onDurationChange={handleDurationChange}
            />
          ))}
        </div>
      )}

      {/* Build & Play + Download */}
      {segments && (
        <div className="flex gap-2">
          {playing ? (
            <Button
              type="button"
              onClick={handleStopPlay}
              className="flex-1 bg-red-600 hover:bg-red-700 gap-2 text-white"
            >
              <Square className="w-4 h-4" /> Stop
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleBuildAndPlay}
              disabled={generatingCombined || !hasSegmentAudios}
              className="flex-1 bg-purple-600 hover:bg-purple-700 gap-2 text-white"
            >
              {generatingCombined ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {generatingCombined ? 'Building…' : 'Build & Play'}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={handleDownload}
            disabled={!hasSegmentAudios || playing}
            className="border-slate-500 text-slate-300 gap-2"
          >
            <Download className="w-4 h-4" /> Download
          </Button>
        </div>
      )}

      {/* Current saved audio — always visible once something's been built, with clear
          instructions for how to change it, since it wasn't obvious before how to go back
          and amend a previously-created audio. */}
      {audioUrl && (
        <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-green-400 shrink-0" />
            <span className="text-green-300 text-sm font-medium">
              {segments ? 'Last saved audio (a version below may be newer, unsaved)' : 'Current saved audio'}
            </span>
          </div>
          <AudioPlayer src={audioUrl} className="w-full" />
          <p className="text-xs text-slate-500">
            To change this: edit the script above, click <strong>Parse &amp; Generate</strong>, listen
            to the segments, then click <strong>Build &amp; Play</strong> again to save a new version —
            no need to leave this screen.
          </p>
        </div>
      )}
    </div>
  );
}