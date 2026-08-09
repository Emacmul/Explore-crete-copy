import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Gift } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';

// Lets an admin manually add a single tour to a specific user's library (birthday raffle
// winner, etc.). Calls the admin-only grantWalk function, which records a "manual" Purchase
// against the user's email — the same record the customer's catalogue already reads to
// decide entitlement, so the gifted tour appears in their library on next load.
export default function GiftWalkDialog({ appUser, onClose }) {
  const [walks, setWalks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [walkId, setWalkId] = useState('');
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    base44.entities.Walk.list('-name', 500)
      .then(list => setWalks(list || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectedWalk = walks.find(w => w.id === walkId);
  const grantable = !!walkId && !!selectedWalk?.creem_product_id;

  const handleGrant = async () => {
    if (!grantable) return;
    setGranting(true);
    try {
      const res = await base44.functions.invoke('grantWalk', { walkId, buyerEmail: appUser.email });
      const data = res.data || {};
      if (data.granted) {
        toast({ title: 'Walk gifted', description: `${appUser.email} now has "${data.walk_name}".` });
        onClose();
      } else if (data.reason === 'already_owned') {
        toast({ title: 'Already in library', description: `${appUser.email} already owns "${data.walk_name}".` });
        onClose();
      } else {
        toast({ variant: 'destructive', title: 'Could not gift walk', description: data.error || data.reason || 'Unknown error.' });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Grant failed', description: err?.message });
    } finally {
      setGranting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gift className="w-4 h-4 text-amber-400" /> Gift a free walk</DialogTitle>
          <DialogDescription className="text-slate-400">
            Manually add a tour to {appUser.email}'s library.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-slate-300 mb-1.5 block">Tour to gift</Label>
            {loading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading tours…</div>
            ) : (
              <Select value={walkId} onValueChange={setWalkId}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Select a tour" /></SelectTrigger>
                <SelectContent>
                  {walks.map(w => (
                    <SelectItem key={w.id} value={w.id} disabled={!w.creem_product_id}>
                      {w.name} ({w.code}){w.creem_product_id ? '' : ' — no product id'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedWalk && !selectedWalk.creem_product_id && (
              <p className="text-xs text-amber-400 mt-1.5">
                This tour has no Creem product id set, so it can't be gifted yet — add one in the Walk editor first.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">Cancel</Button>
          <Button onClick={handleGrant} disabled={granting || !grantable} className="bg-amber-500 hover:bg-amber-600 gap-2">
            {granting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />} Gift walk
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}