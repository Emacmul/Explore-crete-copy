import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Save, AlertTriangle, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getNarratorAuthPayload, useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import { parseScript, rebuildScript } from '@/lib/ttsParser';
import { combineSegmentsToWav, blobToBase64 } from '@/lib/audioCombiner';
import { getFnErrorMessage, withTimeout } from '@/lib/utils';

// Kept as its own small copy rather than importing NarrationTtsEditor's own
// LANG_TO_CODE (not exported, and this component is deliberately self-contained —
// see the file comment below for why it doesn't reach into that file at all).
const LANG_TO_CODE = {
  English: 'en-US', Dutch: 'nl-NL', Czech: 'cs-CZ', German: 'de-DE',
  French: 'fr-FR', Italian: 'it-IT', Arabic: 'ar-XA', Hebrew: 'he-IL',
  Polish: 'pl-PL', Spanish: 'es-ES', Portuguese: 'pt-PT', Turkish: 'tr-TR',
  Russian: 'ru-RU', Hungarian: 'hu-HU',
};

const TTS_CALL_TIMEOUT_MS = 30000;
// Voice is fixed rather than offered as a picker — per Enda, this screen has NOTHING
// on it beyond the already-written text and the pause sliders. Nothing about a
// waypoint's originally-chosen voice/gender is persisted anywhere once its audio has
// been finalized (see NarrationTtsEditor's finalizeAndSave — only the combined file
// survives), so there is no real "original" value to default to here either way.
const VOICE = 'NEUTRAL';

/**
 * Per Enda: the old "Waypoint Audio & Break Tags" panel embedded the FULL Narration
 * Script & TTS editor right here beside the map — import/translate, voice/language
 * pickers, per-line wording edits, the whole Parse & Generate / Build & Play / Mark as
 * Done review cycle. That's the same tool used to WRITE a waypoint's script in the
 * first place (Waypoints tab). By the time a narrator is here, tuning a waypoint's
 * timing against a real drive, the wording is already final — "that should have
 * happened in the first editing session" — the only thing left to adjust is how long
 * each pause between lines runs, against how long the real drive to the next waypoint
 * actually takes. The full wording editor gave far more controls than this task needs,
 * and — per Enda's report — no real way to see the pause sliders and the driving time
 * to compare them against side by side with a leg-scoped map at all.
 *
 * This is that purpose-built replacement. It shows the waypoint's own script, broken
 * into its text/pause pieces exactly like NarrationTtsEditor already does elsewhere
 * (parseScript) — but READ-ONLY: no import, no translate, no voice/language picker, no
 * per-line rewording, nothing. Only a pause's own duration slider is ever adjustable.
 *
 * Audio for the (unchanged) text pieces is regenerated automatically the moment a
 * waypoint is opened here — a mechanical necessity, not an invitation to rewrite
 * anything: only the FINAL combined file is ever persisted anywhere (see
 * NarrationTtsEditor's own finalizeAndSave), so there is no already-generated
 * per-line audio left over from the original writing session to reuse. Deliberately
 * self-contained rather than sharing NarrationTtsEditor's own state machine — that
 * file has been through 30+ rounds of careful, narrow bug fixes around its own
 * listen/edit-phase locking, and none of that machinery is relevant to a screen that
 * never allows editing text in the first place.
 *
 * "Test this subsegment" (rename of the old "Test this waypoint") builds a LIVE
 * preview — combining the current, possibly-still-unsaved pause durations with the
 * already-generated line audio into one WAV, entirely in-browser (combineSegmentsToWav,
 * the exact same renderer NarrationTtsEditor's own Mark Segment as Done uses) — and
 * hands its object URL up to the parent (onTestSubsegment), which plays it through the
 * Simulator's own proven drive/geofence engine via jumpToWaypoint's audioOverrideUrl,
 * scoped to just this waypoint's own leg. Nothing is saved by testing — repeatable as
 * many times as it takes. "Save pause timing" renders the same combined file again,
 * uploads it for real (uploadNarrationAudio — the exact same call finalizeAndSave
 * uses), and only THEN calls onSave with the real, uploaded URL plus the updated
 * script text (so the new pause durations are also reflected in narration_script, not
 * just the audio) — followed immediately by onAutoSave(), so this is a real save, not
 * something sitting only in memory until Save Route happens to be clicked separately.
 */
export default function WaypointPaceEditor({ waypoint, fixedLanguage, onSave, onAutoSave, onTestSubsegment, testDisabled, testDisabledReason }) {
  const { keys: apiKeys } = useNarratorApiKeys();
  const [segments, setSegments] = useState(null);
  const [segmentAudios, setSegmentAudios] = useState({});
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const lastPreviewUrlRef = useRef(null);

  const script = waypoint?.narration_script || '';

  // Runs once per mount — the parent renders this component with `key={selectedWpIndex}`
  // (see TourSimulator.jsx), so switching to a different waypoint in the dropdown fully
  // remounts this component fresh rather than this effect needing to re-detect a change
  // itself. Loads (regenerates) audio for every text piece in this waypoint's own
  // script, exactly once, so the pause sliders below have something real to preview and
  // combine against straight away.
  useEffect(() => {
    let cancelled = false;
    const parsed = parseScript(script);
    if (parsed.length === 0) return;
    if (!apiKeys.google_tts_api_key) {
      setError('No Google TTS API key found for your account yet. Add your own key via "API Keys" in the header.');
      return;
    }
    setLoading(true);
    const languageCode = LANG_TO_CODE[fixedLanguage] || 'en-US';
    (async () => {
      const audios = {};
      for (const seg of parsed) {
        if (seg.type !== 'text') continue;
        try {
          const response = await withTimeout(
            base44.functions.invoke('generateTts', {
              text: seg.content,
              gender: VOICE,
              language_code: languageCode,
              apiKey: apiKeys.google_tts_api_key,
              ...getNarratorAuthPayload(),
            }),
            TTS_CALL_TIMEOUT_MS,
            "Loading this waypoint's audio for editing took too long — try re-selecting it."
          );
          if (response.data?.url) audios[seg.id] = response.data.url;
        } catch (err) {
          if (!cancelled) setError(`Could not load audio for editing: ${getFnErrorMessage(err)}`);
        }
      }
      if (!cancelled) {
        setSegments(parsed);
        setSegmentAudios(audios);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke whatever live-preview blob URL this component created, on unmount (switching
  // waypoints) or before building a fresh one — an object URL left un-revoked keeps its
  // whole audio blob alive in memory for as long as the tab stays open.
  useEffect(() => () => {
    if (lastPreviewUrlRef.current) URL.revokeObjectURL(lastPreviewUrlRef.current);
  }, []);

  const handleDurationChange = (segmentId, newDuration) => {
    setSegments((prev) => prev ? prev.map((seg) => (seg.id === segmentId ? { ...seg, duration: newDuration } : seg)) : prev);
    setDirty(true);
  };

  // Per Enda's follow-up 35 report (same reasoning as NarrationTtsEditor's own
  // regenerateSegmentAudio): a segment's audio URL can go stale between when it was
  // generated and when it's actually needed for combining/preview. Self-heals by
  // re-requesting fresh audio for just the one piece that failed to fetch.
  const regenerateSegmentAudio = async (seg) => {
    if (seg.type !== 'text' || !apiKeys.google_tts_api_key) return null;
    try {
      const languageCode = LANG_TO_CODE[fixedLanguage] || 'en-US';
      const response = await withTimeout(
        base44.functions.invoke('generateTts', {
          text: seg.content,
          gender: VOICE,
          language_code: languageCode,
          apiKey: apiKeys.google_tts_api_key,
          ...getNarratorAuthPayload(),
        }),
        TTS_CALL_TIMEOUT_MS,
        "Re-generating this line's audio took too long — try again."
      );
      const freshUrl = response.data?.url;
      if (!freshUrl) return null;
      setSegmentAudios((prev) => ({ ...prev, [seg.id]: freshUrl }));
      return freshUrl;
    } catch {
      return null;
    }
  };

  const handleTest = async () => {
    if (!segments || testing || saving) return;
    setTesting(true);
    setError('');
    try {
      const wavBlob = await combineSegmentsToWav(segments, segmentAudios, undefined, { onRegenerateAudio: regenerateSegmentAudio });
      const blobUrl = URL.createObjectURL(wavBlob);
      if (lastPreviewUrlRef.current) URL.revokeObjectURL(lastPreviewUrlRef.current);
      lastPreviewUrlRef.current = blobUrl;
      onTestSubsegment(blobUrl);
    } catch (err) {
      setError(`Could not build a preview: ${getFnErrorMessage(err)}`);
    }
    setTesting(false);
  };

  const handleSave = async () => {
    if (!segments || saving || testing) return;
    setSaving(true);
    setError('');
    try {
      const wavBlob = await combineSegmentsToWav(segments, segmentAudios, undefined, { onRegenerateAudio: regenerateSegmentAudio });
      const audioBase64 = await blobToBase64(wavBlob);
      const response = await withTimeout(
        base44.functions.invoke('uploadNarrationAudio', {
          audioBase64,
          mimeType: 'audio/wav',
          filename: `narration_${Date.now()}.wav`,
          ...getNarratorAuthPayload(),
        }),
        TTS_CALL_TIMEOUT_MS * 2,
        'Uploading the updated audio took too long (check your connection) — nothing has been lost, just try again.'
      );
      if (!response.data?.url) throw new Error('Upload did not return a file URL.');
      // One atomic update — per follow-up 53's own fix (see CLAUDE_CHANGELOG.md), three
      // separate onWaypointUpdate calls for audio_clip_url/trigger_audio/waypoint_done
      // in a row silently raced each other and only the LAST one survived. This is the
      // exact same class of bug the "really saved" complaint that started this whole
      // request was about, so it's done here as one single call from the start.
      onSave({
        narration_script: rebuildScript(segments),
        audio_clip_url: response.data.url,
        trigger_audio: true,
        waypoint_done: true,
      });
      setDirty(false);
      onAutoSave?.();
    } catch (err) {
      setError(`Could not save: ${getFnErrorMessage(err)}`);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      {!script && (
        <div className="text-sm text-slate-500 italic border border-dashed border-slate-600 rounded-lg p-4">
          No narration script for this waypoint yet — write it in the Waypoints tab first.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading this waypoint's audio for editing…
        </div>
      )}

      {segments && segments.length > 0 && (
        <div className="space-y-2">
          {segments.map((seg) => (
            seg.type === 'text' ? (
              <p key={seg.id} className="text-sm text-slate-200 bg-slate-900/40 border border-slate-700 rounded-lg p-2.5 whitespace-pre-wrap break-words">
                {seg.content}
              </p>
            ) : (
              <div key={seg.id} className="bg-slate-800 rounded-lg border border-slate-600 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Pause
                  </span>
                  <span className="text-xs font-medium text-amber-400">{seg.duration.toFixed(1)}s</span>
                </div>
                <Slider
                  value={[seg.duration]}
                  min={0.1}
                  max={120}
                  step={0.1}
                  onValueChange={(val) => handleDurationChange(seg.id, val[0])}
                  disabled={loading || saving || testing}
                />
              </div>
            )
          ))}
        </div>
      )}

      {segments && segments.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleTest}
            disabled={loading || testing || saving || testDisabled}
            title={testDisabled ? testDisabledReason : 'Drive from this waypoint to the next one, playing this exact pause timing'}
            className="bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/50 text-white gap-2"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Test this subsegment
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={loading || saving || testing || !dirty}
            title={dirty ? 'Save this pause timing as the real, live audio for this waypoint' : 'Nothing changed yet'}
            className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save pause timing'}
          </Button>
        </div>
      )}
    </div>
  );
}
