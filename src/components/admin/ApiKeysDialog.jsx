import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KeyRound, Eye, EyeOff, Save, CheckCircle2, Loader2 } from 'lucide-react';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';

// required=true is a hard lock, not a dismissable reminder: every admin/narrator works
// across all three tour types (walk/hike, WalkAbout, driving), so there's no "doesn't
// need a key" case — both a Google TTS key AND a Groq key are mandatory before anyone
// can do anything else in the backend. When required, this dialog cannot be closed by
// the X button, clicking outside, or Escape (see handleOpenChange below), and Save stays
// disabled until BOTH fields actually have something in them.
export default function ApiKeysDialog({ open, onOpenChange, required = false, onSaved }) {
  const { keys, loading, error: loadError, loadedOk, saveKeys, reload } = useNarratorApiKeys();
  const [googleKey, setGoogleKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [showGoogle, setShowGoogle] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleOpenChange = (next) => {
    if (required && !next) return; // no dismissing this one until both keys are saved
    onOpenChange(next);
  };

  // The keys load asynchronously from the server now, rather than being available
  // instantly from localStorage — sync the editable fields once the real, current values
  // actually arrive, rather than only ever capturing whatever was there on first render.
  useEffect(() => {
    if (!loading) {
      setGoogleKey(keys.google_tts_api_key || '');
      setGroqKey(keys.groq_api_key || '');
    }
  }, [loading, keys.google_tts_api_key, keys.groq_api_key]);

  const handleSave = async () => {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await saveKeys({ google_tts_api_key: googleKey.trim(), groq_api_key: groqKey.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save your keys. Please try again.');
    }
    setSaving(false);
  };

  const bothKeysFilled = !!googleKey.trim() && !!groqKey.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`max-w-md bg-slate-900 border-slate-700${required ? ' [&>button]:hidden' : ''}`}
        onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined}
        onPointerDownOutside={required ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> {required ? 'Add Your API Keys to Continue' : 'My API Keys'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            {required
              ? 'Every admin and narrator needs their own Google TTS and Groq keys before using any tour tools — every tour type needs them sooner or later. Enter both below to continue.'
              : 'Required for narration and translation. Saved to your own account — works from any browser or device, survives clearing this site\'s data, and is never visible to other narrators.'}
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your saved keys…
            </div>
          ) : (
            <>
              {loadError && (
                <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 space-y-2">
                  <p>{loadError}</p>
                  <p className="text-red-300/80">
                    Saving is disabled until this loads correctly — retrying first makes
                    sure a real saved key can't get overwritten by a blank field.
                  </p>
                  <Button type="button" size="sm" variant="outline" className="border-red-700/50 text-red-200" onClick={() => reload()}>
                    Retry loading
                  </Button>
                </div>
              )}

              <div>
                <Label className="text-slate-300 text-sm mb-1.5 block">Google API Key <span className="text-slate-500 font-normal">(text-to-speech)</span></Label>
                <div className="flex gap-2">
                  <Input
                    type={showGoogle ? 'text' : 'password'}
                    value={googleKey}
                    onChange={e => setGoogleKey(e.target.value)}
                    placeholder="Paste your Google API key"
                    className="bg-slate-700 border-slate-500 text-white font-mono text-sm"
                    autoComplete="off"
                    disabled={!loadedOk}
                  />
                  <Button type="button" variant="outline" size="icon" className="border-slate-500 shrink-0" onClick={() => setShowGoogle(s => !s)}>
                    {showGoogle ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                {loadedOk && !keys.google_tts_api_key && <p className="text-xs text-slate-500 mt-1">No key saved yet.</p>}
              </div>

              <div>
                <Label className="text-slate-300 text-sm mb-1.5 block">Groq API Key <span className="text-slate-500 font-normal">(translation)</span></Label>
                <div className="flex gap-2">
                  <Input
                    type={showGroq ? 'text' : 'password'}
                    value={groqKey}
                    onChange={e => setGroqKey(e.target.value)}
                    placeholder="Paste your Groq API key"
                    className="bg-slate-700 border-slate-500 text-white font-mono text-sm"
                    autoComplete="off"
                    disabled={!loadedOk}
                  />
                  <Button type="button" variant="outline" size="icon" className="border-slate-500 shrink-0" onClick={() => setShowGroq(s => !s)}>
                    {showGroq ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                {loadedOk && !keys.groq_api_key && <p className="text-xs text-slate-500 mt-1">No key saved yet.</p>}
              </div>

              {error && (
                <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                onClick={handleSave}
                disabled={saving || !loadedOk || (required && !bothKeysFilled)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saving
                  ? 'Saving…'
                  : saved
                    ? 'Saved'
                    : !loadedOk
                      ? 'Load your keys first'
                      : required && !bothKeysFilled
                        ? 'Enter both keys to continue'
                        : 'Save API Key'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
