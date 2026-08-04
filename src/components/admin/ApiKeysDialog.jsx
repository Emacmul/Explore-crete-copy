import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KeyRound, Eye, EyeOff, Save, CheckCircle2 } from 'lucide-react';
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';

export default function ApiKeysDialog({ open, onOpenChange }) {
  const { keys, saveKeys } = useNarratorApiKeys();
  const [googleKey, setGoogleKey] = useState(keys.google_tts_api_key);
  const [groqKey, setGroqKey] = useState(keys.groq_api_key);
  const [showGoogle, setShowGoogle] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSave = () => {
    setError('');
    setSaved(false);
    try {
      saveKeys({ google_tts_api_key: googleKey.trim(), groq_api_key: groqKey.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || 'Could not save your keys. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> My API Keys
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Required for narration and translation. Stored only in this browser — same as VoiceScript and TTS Studio. Not saved anywhere else, and not shared with other narrators.
          </p>

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
              />
              <Button type="button" variant="outline" size="icon" className="border-slate-500 shrink-0" onClick={() => setShowGoogle(s => !s)}>
                {showGoogle ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            {!keys.google_tts_api_key && <p className="text-xs text-slate-500 mt-1">No key saved yet.</p>}
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
              />
              <Button type="button" variant="outline" size="icon" className="border-slate-500 shrink-0" onClick={() => setShowGroq(s => !s)}>
                {showGroq ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            {!keys.groq_api_key && <p className="text-xs text-slate-500 mt-1">No key saved yet.</p>}
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button onClick={handleSave} className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-2">
            {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved' : 'Save API Key'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
