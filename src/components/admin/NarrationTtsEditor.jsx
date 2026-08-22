import React, { useState, useRef, useEffect } from 'react';
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
import { Loader2, Sparkles, Pause, Play, Download, Braces, FileText, Square, CheckCircle2 } from 'lucide-react';
import { downloadScriptAsDocx } from '@/lib/docxExporter';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage } from '@/lib/utils';
import { playSegmentsPrecisely, combineSegmentsToWav, blobToBase64 } from '@/lib/audioCombiner';

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

// A "subsection" (per Enda's term) is a run of segment cards ending at a Build & Play /
// Continue control — the same grouping the old flat list already used (every 3rd card,
// plus whatever's left over at the very end), just organized into real groups now
// instead of a modulo check sprinkled through the render.
//
// Per Enda: a subsection must never end right on a pause when there's still a
// narration line after it — a pause exists to lead into whatever comes next, so
// splitting them apart (with the editable box + Continue/Build & Play controls
// wedged in between) visually breaks that pair apart. So a would-be boundary lands
// on a pause is deferred — the pause stays grouped with the text segment that
// follows it — rather than closing the subsection right there.
function chunkIntoSubsections(segments) {
  const subsections = [];
  let current = [];
  segments.forEach((seg, idx) => {
    current.push(seg);
    const isLastOverall = idx === segments.length - 1;
    const endsOnDanglingPause = seg.type === 'pause' && !isLastOverall;
    if (!endsOnDanglingPause && (current.length >= 3 || isLastOverall)) {
      subsections.push(current);
      current = [];
    }
  });
  if (current.length > 0) subsections.push(current);
  return subsections;
}

export default function NarrationTtsEditor({ script, audioUrl, onScriptChange, onAudioChange, fixedLanguage }) {
  const { keys: apiKeys } = useNarratorApiKeys();
  const [selectedVoice, setSelectedVoice] = useState('NEUTRAL');
  const [selectedLanguage, setSelectedLanguage] = useState(fixedLanguage || 'English');
  const [error, setError] = useState('');
  const [segments, setSegments] = useState(null);
  const [segmentAudios, setSegmentAudios] = useState({});
  const [generatingSegmentId, setGeneratingSegmentId] = useState(null);
  const [generatingCombined, setGeneratingCombined] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(null);
  // The debug log used to render as a box under Parse & Generate — per Enda, it served
  // no purpose for a narrator and just took up space, so it's no longer shown. Kept as
  // write-only internal bookkeeping (addLog below) rather than ripped out everywhere it
  // was called, in case it's ever useful again behind a future admin/debug view.
  const [, setDebugLog] = useState([]);
  // Which subsection the narrator has reached so far (0-based). Subsections before this
  // one are "done" (with a Replay option); this one is the active Build & Play /
  // Continue; anything after is locked until the narrator works through to it.
  const [subsectionCursor, setSubsectionCursor] = useState(0);
  // Which subsection is actively mid-playback right now, if any — used to show Stop in
  // the right spot instead of a single global control.
  const [activeSubsectionIndex, setActiveSubsectionIndex] = useState(null);
  const textareaRef = useRef(null);
  const currentAudioRef = useRef(null);
  const stopRef = useRef(false);
  const currentPlaybackRef = useRef(null);

  const charCount = (script || '').length;
  const overLimit = charCount > MAX_CHARS;

  // Per Enda: the language for a translation clone is locked in the moment it's cloned
  // (target_language on the walk) — a narrator must never be able to pick a different
  // one here, or the script/TTS language could drift from what the clone actually is
  // (e.g. translating into German while generating Arabic audio, on a Spanish clone).
  // Keeps this in sync if fixedLanguage arrives after the initial render (e.g. the walk
  // is still loading when this component first mounts).
  useEffect(() => {
    if (fixedLanguage) setSelectedLanguage(fixedLanguage);
  }, [fixedLanguage]);

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
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    }, 0);
  };

  // Shared by the top script box AND every duplicate copy of it shown further down
  // (one per subsection — see the segments list below). Per Enda: editing the script
  // anywhere, mid-pass, must NOT wipe out the segments/audio already generated — a
  // narrator working through a long waypoint needs to keep listening/continuing through
  // what's already built, fixing text as they go, without losing their place. The edit
  // only actually changes anything the next time "Parse & Generate" is clicked.
  const handleScriptEdit = (e) => {
    onScriptChange(e.target.value);
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
    setSubsectionCursor(0);
    setActiveSubsectionIndex(null);

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

  // Builds the final combined file and saves it — exactly what the single "Build &
  // Play" button used to do at the very end. Only ever called once, when the LAST
  // subsection finishes playing. Decodes fresh here (rather than reusing an earlier
  // subsection's precomputed clips) since each subsection now plays with its own,
  // separate playSegmentsPrecisely call — there's no single "precomputed" covering the
  // whole script to reuse, and combineSegmentsToWav already supports decoding on its
  // own perfectly well when nothing is passed.
  const finalizeAndSave = async () => {
    setGeneratingCombined(true);
    addLog('Rendering combined audio file…');
    try {
      const wavBlob = await combineSegmentsToWav(segments, segmentAudios);
      addLog(`Combined audio rendered (${(wavBlob.size / 1024 / 1024).toFixed(2)} MB). Uploading…`);
      const audioBase64 = await blobToBase64(wavBlob);
      const response = await base44.functions.invoke('uploadNarrationAudio', {
        audioBase64,
        mimeType: 'audio/wav',
        filename: `narration_${Date.now()}.wav`,
        ...getNarratorAuthPayload(),
      });
      if (response.data?.url) {
        onAudioChange(response.data.url);
        addLog('Combined audio saved.');
        // Per Enda: once the final Build & Play has saved this pass, the editor goes
        // back to the beginning — segments/audio cleared so "Parse & Generate" has to
        // be clicked again to start a fresh pass over the (possibly just-edited)
        // script. Only done on a successful save, so a failed upload doesn't lose the
        // segments/audio the narrator would otherwise have to regenerate from scratch.
        setSegments(null);
        setSegmentAudios({});
        setSubsectionCursor(0);
      } else {
        addLog('Combined audio: no URL returned from upload.');
        setError('Combined audio failed: upload did not return a file URL.');
      }
    } catch (err) {
      const msg = getFnErrorMessage(err);
      addLog(`Combined audio ERROR: ${msg}`);
      setError(`Combined audio failed: ${msg}`);
    }
    setGeneratingCombined(false);
  };

  // Plays ONE subsection's audio on demand — used both by the standalone "Build & Play"
  // button under Parse & Generate (which always plays the very first subsection) and by
  // every "Continue" button further down the list. Per Enda: pressing a control must
  // play the audio that comes AFTER it, never the text already shown above it — so the
  // narrator hears each part fresh, edits the text box that belongs to that part to
  // reflect what needs to change, then presses Continue to move on. Also doubles as
  // "Replay" for a part that's already been heard (targetIndex !== subsectionCursor),
  // which just plays it again without moving the narrator's place forward.
  const handlePlayTarget = async (subsections, targetIndex) => {
    const targetSegments = subsections[targetIndex];
    if (!targetSegments || playing || generatingCombined) return;
    const isReplay = targetIndex !== subsectionCursor;

    stopRef.current = false;
    setPlaying(true);
    setActiveSubsectionIndex(targetIndex);
    setError('');

    let playback = null;
    try {
      playback = await playSegmentsPrecisely(targetSegments, segmentAudios, {
        // playSegmentsPrecisely reports an index into the slice we gave it, not the
        // full segments list — map it back to the card that's actually showing that
        // segment so highlighting lands on the right one.
        onSegmentChange: (localIdx) => {
          const seg = targetSegments[localIdx];
          const globalIdx = seg ? segments.findIndex((s) => s.id === seg.id) : -1;
          if (globalIdx >= 0) setCurrentPlayingIndex(globalIdx);
        },
      });
      currentPlaybackRef.current = playback;
      if (stopRef.current) {
        playback.stop();
      } else {
        await playback.done;
      }
    } catch (err) {
      const msg = getFnErrorMessage(err);
      addLog(`Preview ERROR: ${msg}`);
      setError(`Preview failed: ${msg}`);
      setCurrentPlayingIndex(null);
      setPlaying(false);
      setActiveSubsectionIndex(null);
      currentPlaybackRef.current = null;
      return;
    }

    currentPlaybackRef.current = null;
    setCurrentPlayingIndex(null);
    setPlaying(false);
    setActiveSubsectionIndex(null);

    if (stopRef.current) {
      stopRef.current = false;
      return;
    }
    if (isReplay) return;

    // Not a replay — this was the next part the narrator hadn't heard yet, so move the
    // marker forward. Once every subsection has been played this way, the LAST
    // subsection's own "Save & Finish" control lights up (see the render below) —
    // finalizing is now always a deliberate, separate click, never bundled into a play
    // action, so there's always a chance to edit the last bit of text after hearing it
    // and before it gets saved.
    setSubsectionCursor(targetIndex + 1);
  };

  // The very last subsection has nothing after it to "Continue" into — its control is
  // "Save & Finish" instead, and only renders/uploads/saves (no playback of its own,
  // since its audio was already played by the Continue button before it). Kept separate
  // from handlePlayTarget so a click here can never accidentally play anything.
  const handleFinalizeClick = async () => {
    if (playing || generatingCombined) return;
    await finalizeAndSave();
  };

  const handleStopPlay = () => {
    stopRef.current = true;
    if (currentPlaybackRef.current) {
      currentPlaybackRef.current.stop();
      currentPlaybackRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }
    setPlaying(false);
    setActiveSubsectionIndex(null);
    setCurrentPlayingIndex(null);
  };

  const handleDownload = async () => {
    // Download the full edited script as .docx (break tags preserved)
    if (script) {
      downloadScriptAsDocx(script, 'narration_script.docx');
    }

    // Download the full combined audio, keeping whatever extension it was actually
    // saved with — combined audio built by the exact-silence combiner is a .wav file
    // now (see audioCombiner.js), while any older tour's combined audio saved before
    // this fix is still a real .mp3; hardcoding .mp3 here would mislabel the newer
    // ones even though playback itself doesn't care about the extension.
    if (audioUrl) {
      const extMatch = audioUrl.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
      const ext = extMatch ? extMatch[1] : 'mp3';
      const downloadName = `narration_audio.${ext}`;
      try {
        const response = await fetch(audioUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = downloadName;
        a.target = '_blank';
        a.click();
      }
    }
  };

  const hasSegmentAudios = Object.keys(segmentAudios).length > 0;
  const subsections = segments ? chunkIntoSubsections(segments) : [];

  return (
    <div className="bg-slate-800/50 rounded-lg border border-blue-600/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-blue-400" />
        <Label className="text-white text-sm font-bold">Narration Script & TTS</Label>
        <span className="text-xs text-slate-400 ml-1">import, edit, generate audio</span>
      </div>

      <TranslationPanel
        onTranslated={(text) => {
          onScriptChange(text);
          setSegments(null);
          setSegmentAudios({});
          setSubsectionCursor(0);
        }}
        fixedLanguage={fixedLanguage}
      />

      {/* Insert break tags at cursor */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-slate-500">Insert pause:</span>
        {/* 0.1s — a mid-sentence pause is often much shorter than half a second; 0.5s
            alone made that impossible to express with a quick-insert button. */}
        <Button type="button" size="sm" variant="ghost"
          onClick={() => insertBreakTag('<break time="0.1s"/>')}
          className="text-slate-400 hover:text-slate-200 h-7 px-2 text-xs gap-1">
          <Pause className="w-3 h-3" /> 0.1s
        </Button>
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

      {/* Editable script textarea — same pastel yellow as every duplicate copy further
          down (per Enda: every editable script box must look identical, so it's never
          ambiguous which boxes on this panel are text you can type into). */}
      <div>
        <Textarea
          ref={textareaRef}
          value={script || ''}
          onChange={handleScriptEdit}
          placeholder={'Import a script file or write here...\n\nUse <break time="2s"/> for pauses.'}
          rows={6}
          className="bg-amber-100 border-amber-300 text-black placeholder:text-amber-900/50 text-sm font-mono resize-y focus-visible:ring-amber-400"
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
          {fixedLanguage ? (
            <div className="h-8 flex items-center px-3 bg-slate-800 border border-slate-600 rounded-md text-slate-300 text-sm" title="Set when this clone was created — cannot be changed here.">
              {fixedLanguage}
            </div>
          ) : (
            <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
              <SelectTrigger className="bg-slate-700 border-slate-500 text-white h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => <SelectItem key={lang} value={lang}>{lang}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
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

      {/* Segments list, grouped into subsections (a run of up to 3 cards, kept intact
          around pauses — see chunkIntoSubsections above). Per Enda: a control must
          always play the audio that comes AFTER it, never the part already shown above
          it — the narrator should hear a part fresh, THEN read/edit its text, not the
          other way round. That means the very first part needs its own standalone
          "Build & Play" button positioned right under Parse & Generate below, since
          there's no earlier control to have played it. From there, the "Continue"
          button at the end of each subsection's block plays the NEXT subsection down;
          the narrator listens, edits that subsection's own text box to reflect what
          they just heard, then presses Continue again. The very last subsection has
          nothing left to Continue into, so its control is "Save & Finish" instead — it
          renders and saves the combined file and sends the editor back to the top for a
          fresh Parse & Generate pass. */}
      {segments && subsections.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            <span>{countCharacters(segments)} characters</span>
            <span>·</span>
            <span>{countBreaks(segments)} breaks detected</span>
            <span className="text-slate-600">Use &lt;break time="Xs"/&gt; for pauses</span>
          </div>

          {/* Standalone starter control — plays the very first subsection's audio.
              Nothing comes before this one, so it's always "Build & Play", never
              "Continue". */}
          {(() => {
            const topIsPlayingThis = playing && activeSubsectionIndex === 0;
            const topAlreadyPlayed = subsectionCursor > 0;
            if (topIsPlayingThis) {
              return (
                <Button type="button" onClick={handleStopPlay} className="w-full bg-red-600 hover:bg-red-700 gap-2 text-white">
                  <Square className="w-4 h-4" /> Stop
                </Button>
              );
            }
            if (topAlreadyPlayed) {
              return (
                <div className="flex gap-2 items-center">
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-4 h-4" /> Played
                  </span>
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={() => handlePlayTarget(subsections, 0)}
                    disabled={playing || generatingCombined}
                    className="border-slate-500 text-slate-300 gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" /> Replay
                  </Button>
                </div>
              );
            }
            return (
              <Button
                type="button"
                onClick={() => handlePlayTarget(subsections, 0)}
                disabled={playing || generatingCombined || !hasSegmentAudios}
                className="w-full bg-purple-600 hover:bg-purple-700 gap-2 text-white"
              >
                <Play className="w-4 h-4" /> Build & Play
              </Button>
            );
          })()}

          {subsections.map((subsectionSegments, si) => {
            const isLastBlock = si === subsections.length - 1;
            const targetIndex = si + 1; // the NEXT subsection this block's control plays
            const isPlayingThis = playing && activeSubsectionIndex === targetIndex;
            const status = subsectionCursor > targetIndex ? 'done' : subsectionCursor === targetIndex ? 'active' : 'locked';
            const finalizeReady = subsectionCursor >= subsections.length;
            const isSavingThis = generatingCombined && isLastBlock;

            return (
              <div key={`subsection-${si}`} className="space-y-2 pt-2 border-t border-slate-700/60 first:border-t-0 first:pt-0">
                {subsectionSegments.map((seg) => {
                  const globalIdx = segments.findIndex((s) => s.id === seg.id);
                  return (
                    <TtsSegmentCard
                      key={seg.id}
                      segment={seg}
                      audioUrl={segmentAudios[seg.id]}
                      isGenerating={generatingSegmentId === seg.id}
                      isPlaying={currentPlayingIndex === globalIdx}
                      onPlay={playSegment}
                      onDurationChange={handleDurationChange}
                    />
                  );
                })}

                {/* Duplicate, editable script box — same text, same handler as the box
                    at the top, so an edit made here is just as real. Per Enda: this is
                    where you write down the changes needed after hearing THIS
                    subsection's audio (played by the control above this block, or by
                    the standalone Build & Play button for the very first one) — not a
                    box you fill in before listening. Deliberately styled unlike the dark
                    narration cards around it (a muted pastel yellow with black text) so
                    it reads clearly as an editing tool wedged into the list, not another
                    narration block. */}
                <div>
                  <Label className="text-amber-200/80 text-xs mb-1 block">Edit script (takes effect on the next Parse & Generate)</Label>
                  <Textarea
                    value={script || ''}
                    onChange={handleScriptEdit}
                    rows={4}
                    className="bg-amber-100 border-amber-300 text-black placeholder:text-amber-900/50 text-sm font-mono resize-y focus-visible:ring-amber-400"
                  />
                </div>

                <div className="flex gap-2 items-center">
                  {isLastBlock ? (
                    finalizeReady ? (
                      <Button
                        type="button"
                        onClick={handleFinalizeClick}
                        disabled={playing || generatingCombined}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 gap-2 text-white"
                      >
                        {isSavingThis ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {isSavingThis ? 'Saving…' : 'Save & Finish'}
                      </Button>
                    ) : (
                      <Button type="button" disabled className="flex-1 bg-slate-700 text-slate-500 gap-2 cursor-not-allowed">
                        <CheckCircle2 className="w-4 h-4" /> Save & Finish
                      </Button>
                    )
                  ) : isPlayingThis ? (
                    <Button type="button" onClick={handleStopPlay} className="flex-1 bg-red-600 hover:bg-red-700 gap-2 text-white">
                      <Square className="w-4 h-4" /> Stop
                    </Button>
                  ) : status === 'done' ? (
                    <>
                      <span className="flex items-center gap-1.5 text-sm text-emerald-400 shrink-0">
                        <CheckCircle2 className="w-4 h-4" /> Played
                      </span>
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => handlePlayTarget(subsections, targetIndex)}
                        disabled={playing || generatingCombined}
                        className="border-slate-500 text-slate-300 gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" /> Replay
                      </Button>
                    </>
                  ) : status === 'active' ? (
                    <Button
                      type="button"
                      onClick={() => handlePlayTarget(subsections, targetIndex)}
                      disabled={playing || generatingCombined || !hasSegmentAudios}
                      className="flex-1 bg-purple-600 hover:bg-purple-700 gap-2 text-white"
                    >
                      <Play className="w-4 h-4" /> Continue
                    </Button>
                  ) : (
                    <Button type="button" disabled className="flex-1 bg-slate-700 text-slate-500 gap-2 cursor-not-allowed">
                      <Play className="w-4 h-4" /> Continue
                    </Button>
                  )}
                  <Button
                    type="button" variant="outline"
                    onClick={handleDownload}
                    disabled={!hasSegmentAudios || playing}
                    className="border-slate-500 text-slate-300 gap-2"
                  >
                    <Download className="w-4 h-4" /> Download
                  </Button>
                </div>
              </div>
            );
          })}
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
            To change this: edit the script above, click <strong>Parse &amp; Generate</strong>, then click
            <strong> Build &amp; Play</strong> to hear the first part. Edit the yellow text box under it to
            reflect what you just heard, then click <strong>Continue</strong> to hear the next part — repeat
            down the list. Once you have heard and adjusted every part, <strong>Save &amp; Finish</strong>
            saves the new version. No need to leave this screen.
          </p>
        </div>
      )}
    </div>
  );
}
