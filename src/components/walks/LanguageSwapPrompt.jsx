import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Languages, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// A real "do you want to swap?" prompt — the only place a customer's tour language can
// ever actually change after their very first, automatic default pick. Nothing here
// happens without an explicit tap: closing the dialog (the X, clicking outside, or "Not
// now") behaves exactly like Decline — it does NOT swap, it just means "ask me again some
// other time" is also not guaranteed; a genuine "no" is what gets recorded either way, so
// the customer's copy is never changed by accident via a stray dismiss.
//
// Shown one tour at a time, even if several have offers pending, so a customer is never
// asked to make more than one language decision at once.
export default function LanguageSwapPrompt({ walk, token, onDone }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(null); // 'accept' | 'decline' | null

  if (!walk || !walk._swap_offer) return null;

  const respond = async (action) => {
    setBusy(action);
    try {
      await base44.functions.invoke('setTourLanguagePref', {
        token,
        walkId: walk.id,
        language: walk._swap_offer.language,
        action,
      });
    } finally {
      setBusy(null);
      onDone();
    }
  };

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) respond('decline'); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-blue-600" />
            {t('swap.title')}
          </DialogTitle>
          <DialogDescription>
            {t('swap.body', { walkName: walk.name, language: walk._swap_offer.language })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => respond('decline')} disabled={!!busy}>
            {busy === 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('swap.no')}
          </Button>
          <Button onClick={() => respond('accept')} disabled={!!busy} className="bg-blue-600 hover:bg-blue-700">
            {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('swap.yes', { language: walk._swap_offer.language })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
