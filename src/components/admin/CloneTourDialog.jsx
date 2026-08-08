import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Languages } from 'lucide-react';
import { LANGUAGES } from '@/lib/languages';

export default function CloneTourDialog({ open, tour, onClose, onConfirm }) {
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setLanguage(''); }, [open]);

  const handleConfirm = async () => {
    if (!language) return;
    setBusy(true);
    try {
      await onConfirm(language);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Languages className="w-5 h-5 text-purple-400" /> Clone tour for translation</DialogTitle>
          <DialogDescription className="text-slate-400">
            Creates a private copy of <strong className="text-slate-200">{tour?.name}</strong> that only you can see.
            Translate it, then mark it finished to send it to admins for review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-slate-300 mb-1.5 block">Target language</Label>
            <Select value={language || undefined} onValueChange={setLanguage}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Select language" /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500 mt-1.5">
              The new tour's code will be <span className="font-mono text-purple-300">{tour?.code}-{language || 'LANG'}</span>.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">Cancel</Button>
          <Button onClick={handleConfirm} disabled={!language || busy} className="bg-purple-600 hover:bg-purple-700 gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />} Create clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}