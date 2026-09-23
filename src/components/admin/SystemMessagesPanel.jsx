import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Languages, Loader2, AlertTriangle, Mic, Volume2, CheckCircle2 } from 'lucide-react';
import { getNarratorAuthPayload, useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import { translateWalkField, stillMatchesMaster } from '@/lib/fieldTranslation';
import { generateSystemMessageAudio } from '@/lib/systemMessageAudio';
import { getFnErrorMessage } from '@/lib/utils';

// Per Enda (follow-up, 2026-09-22): the spoken off-route/GPS/speed alerts use the
// phone's own built-in robotic voice (browser speechSynthesis, English-only) — "sound
// disgustingly horrible". This panel is where a tour gets real PCV (Professional Cloned
// Voice) audio for those four messages instead, in the narrator's own voice, in the
// tour's own language: edit/translate the text below, then "Generate PCV audio" turns
// today's box text into a real audio file via ElevenLabs. Publishing a driving tour is
// blocked server-side (saveWalkForBackend) until all four have audio — see that
// function's own comment.
//
// Rendered ONCE per tour inside the Narration & Simulate tab (not per-waypoint) —
// these are tour-level messages, not tied to any one stop.
const MESSAGES = [
  { field: 'off_route_text', audioField: 'off_route_audio_url', label: 'Off-route alert' },
  { field: 'gps_no_signal_text', audioField: 'gps_no_signal_audio_url', label: 'No GPS signal alert' },
  { field: 'gps_low_accuracy_text', audioField: 'gps_low_accuracy_audio_url', label: 'Weak GPS signal alert' },
  { field: 'speed_hint_text', audioField: 'speed_hint_audio_url', label: 'Driving-too-fast reminder' },
];

export default function SystemMessagesPanel({ form, set, masterWalk }) {
  const { keys: apiKeys } = useNarratorApiKeys();
  const [translating, setTranslating] = useState(null); // field currently translating, or null
  const [generating, setGenerating] = useState(null); // field currently generating audio, or null
  const [errors, setErrors] = useState({});
  const [playingField, setPlayingField] = useState(null);

  const handleTranslate = async (field) => {
    if (!form.id || !form.clone_of || !form.target_language) return;
    setErrors(prev => ({ ...prev, [field]: '' }));
    if (!apiKeys.groq_api_key) {
      setErrors(prev => ({ ...prev, [field]: 'No Groq API key found for your account yet. Add your own key via "API Keys" in the header.' }));
      return;
    }
    setTranslating(field);
    try {
      const translated = await translateWalkField({
        field,
        walkId: form.id,
        targetLanguage: form.target_language,
        apiKeys,
        authPayload: getNarratorAuthPayload(),
      });
      set(field, translated);
      // The text just changed — any previously generated audio no longer matches it,
      // so clear it rather than leave a stale recording sitting under new text. This
      // also puts the publish gate back in force until fresh audio is generated.
      set(MESSAGES.find(m => m.field === field).audioField, '');
    } catch (err) {
      setErrors(prev => ({ ...prev, [field]: getFnErrorMessage(err, 'Could not translate this text.') }));
    }
    setTranslating(null);
  };

  const handleGenerateAudio = async (field, audioField) => {
    setErrors(prev => ({ ...prev, [field]: '' }));
    const text = (form[field] || '').trim();
    if (!text) {
      setErrors(prev => ({ ...prev, [field]: 'Nothing to generate audio for — fill in the text first.' }));
      return;
    }
    if (!apiKeys.elevenlabs_api_key || !apiKeys.elevenlabs_voice_id) {
      setErrors(prev => ({ ...prev, [field]: 'Add your ElevenLabs API key and voice ID under "API Keys" in the header first.' }));
      return;
    }
    setGenerating(field);
    try {
      const url = await generateSystemMessageAudio({ text, apiKeys, authPayload: getNarratorAuthPayload() });
      set(audioField, url);
    } catch (err) {
      setErrors(prev => ({ ...prev, [field]: getFnErrorMessage(err, 'Could not generate audio.') }));
    }
    setGenerating(null);
  };

  const handlePlay = (field, url) => {
    if (!url) return;
    const audio = new Audio(url);
    setPlayingField(field);
    audio.onended = () => setPlayingField(null);
    audio.onerror = () => setPlayingField(null);
    audio.play().catch(() => setPlayingField(null));
  };

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Spoken System Messages</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          The off-route, GPS and speed alerts a customer hears while driving this tour.
          Edit the text below for this tour's language, then generate real PCV audio in
          your own voice. A driving tour can't be published until all four have audio.
        </p>
      </div>

      {MESSAGES.map(({ field, audioField, label }) => {
        const notYetTranslated = form.target_language
          && form.target_language !== 'English'
          && masterWalk
          && stillMatchesMaster(form[field], masterWalk[field]);
        const hasAudio = !!form[audioField];
        return (
          <div key={field} className="bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Languages className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs text-slate-300 font-medium shrink-0">{label}</span>
              {form.clone_of && form.target_language && (
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => handleTranslate(field)}
                  disabled={translating === field}
                  title={`Translate the original tour's ${label.toLowerCase()} into ${form.target_language} and fill this box with it.`}
                  className="bg-blue-700/30 hover:bg-blue-700/50 border-blue-600/50 text-amber-400 hover:text-amber-300 shrink-0 gap-1.5 h-7 text-xs"
                >
                  {translating === field ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
                  Translate
                </Button>
              )}
              {notYetTranslated && (
                <span className="flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-900/30 border border-amber-700/50 rounded-full px-2 py-0.5 shrink-0">
                  <AlertTriangle className="w-3 h-3" /> Still English — not translated yet
                </span>
              )}
              <span className="ml-auto" />
              {hasAudio ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-900/30 border border-emerald-700/50 rounded-full px-2 py-0.5 shrink-0">
                  <CheckCircle2 className="w-3 h-3" /> PCV audio ready
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-800 border border-slate-600 rounded-full px-2 py-0.5 shrink-0">
                  <AlertTriangle className="w-3 h-3" /> No audio yet
                </span>
              )}
            </div>
            <Textarea
              value={form[field] || ''}
              onChange={e => {
                set(field, e.target.value);
                // Text edited by hand — clear any audio generated for the old wording,
                // same reasoning as after a translate.
                if (form[audioField]) set(audioField, '');
              }}
              rows={3}
              className="bg-slate-700 border-slate-600 text-white text-sm resize-none"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button" size="sm"
                onClick={() => handleGenerateAudio(field, audioField)}
                disabled={generating === field}
                className="bg-purple-700/40 hover:bg-purple-700/60 border border-purple-600/50 text-purple-200 gap-1.5 h-7 text-xs"
              >
                {generating === field ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
                {generating === field ? 'Generating…' : hasAudio ? 'Regenerate PCV audio' : 'Generate PCV audio'}
              </Button>
              {hasAudio && (
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => handlePlay(field, form[audioField])}
                  disabled={playingField === field}
                  className="border-slate-600 text-slate-300 gap-1.5 h-7 text-xs"
                >
                  {playingField === field ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
                  {playingField === field ? 'Playing…' : 'Play'}
                </Button>
              )}
            </div>
            {errors[field] && <p className="text-xs text-red-400">{errors[field]}</p>}
          </div>
        );
      })}
      <p className="text-xs text-slate-500">
        Remember to press <span className="text-amber-400 font-medium">Save Route</span> after
        generating audio — like every other change here, it only becomes real once saved.
      </p>
    </div>
  );
}
