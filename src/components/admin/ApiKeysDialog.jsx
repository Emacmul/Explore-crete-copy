import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KeyRound, Eye, EyeOff, Save, CheckCircle2, Loader2 } from 'lucide-react';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';

// required=true is a hard lock, not a dismissable reminder: every admin/narrator works
// across all three tour types (walk/hike, WalkAbout, driving), so there's no "doesn't
// need a key" case — a single Google API key (enabled for both Cloud Text-to-Speech and
// Cloud Translation) is mandatory before anyone can do anything else in the backend.
// When required, this dialog cannot be closed by the X button, clicking outside, or
// Escape (see handleOpenChange below), and Save stays disabled until the Google API key
// field actually has something in it.
export default function ApiKeysDialog({ open, onOpenChange, required = false, onSaved }) {
  const { keys, loading, error: loadError, loadedOk, saveKeys, reload } = useNarratorApiKeys();
  const [googleKey, setGoogleKey] = useState('');
  const [showGoogle, setShowGoogle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleOpenChange = (next) => {
    if (required && !next) return; // no dismissing this one until the Google key is saved
    onOpenChange(next);
  };

  // The keys load asynchronously from the server now, rather than being available
  // instantly from localStorage — sync the editable field once the real, current value
  // actually arrives, rather than only ever capturing whatever was there on first render.
  useEffect(() => {
    if (!loading) {
      setGoogleKey(keys.google_tts_api_key || '');
    }
  }, [loading, keys.google_tts_api_key]);

  const handleSave = async () => {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await saveKeys({ google_tts_api_key: googleKey.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Could not save your key. Please try again.');
    }
    setSaving(false);
  };

  const googleKeyFilled = !!googleKey.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`max-w-md bg-slate-900 border-slate-700${required ? ' [&>button]:hidden' : ''}`}
        onEscapeKeyDown={required ? (e) => e.preventDefault() : undefined}
        onPointerDownOutside={required ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> {required ? 'Add Your API Key to Continue' : 'My API Key'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            {required
              ? 'Every admin and narrator needs their own Google API key before using any tour tools — it powers both narration (text-to-speech) and script translation. Enter it below to continue.'
              : 'Required for narration (text-to-speech) and script translation. Saved to your own account — works from any browser or device, survives clearing this site\'s data, and is never visible to other narrators.'}
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your saved key…
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
                <Label className="text-slate-300 text-sm mb-1.5 block">Google API Key <span className="text-slate-500 font-normal">(text-to-speech &amp; translation)</span></Label>
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
                <p className="text-xs text-slate-500 mt-1.5">
                  One key covers both narration and translation — enable both the Cloud
                  Text-to-Speech and Cloud Translation APIs in the same Google Cloud project.
                </p>
              </div>

              {error && (
                <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                onClick={handleSave}
                disabled={saving || !loadedOk || (required && !googleKeyFilled)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saving
                  ? 'Saving…'
                  : saved
                    ? 'Saved'
                    : !loadedOk
                      ? 'Load your key first'
                      : required && !googleKeyFilled
                        ? 'Enter your Google API key to continue'
                        : 'Save API Key'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}