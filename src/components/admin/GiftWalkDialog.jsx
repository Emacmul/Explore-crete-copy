import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Gift } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';

// Lets an admin manually add a single tour to a specific user's library (birthday raffle
// winner, etc.). Calls the admin-only grantWalk function, which records a "manual" Purchase
// against the user's email — the same record the customer's catalogue already reads to
// decide entitlement, so the gifted tour appears in their library on next load.
export default function GiftWalkDialog({ appUser, onClose, narrAuth = {} }) {
  const [walks, setWalks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [walkId, setWalkId] = useState('');
  const [granting, setGranting] = useState(false);

  // Tour list comes from getWalksForBackend, not a direct entity read (audit N2, 2026-09-23):
  // Walk's own RLS only recognises a native Base44 admin session, but this dialog lives in
  // the admin backend where sign-in is a WordPress login plus a narr session — a direct
  // entities.Walk.list() came back empty or errored for exactly the admins who gift walks.
  // grantWalk already accepted narrAuth; the read now matches.
  useEffect(() => {
    base44.functions.invoke('getWalksForBackend', { ...narrAuth })
      .then(res => setWalks(res.data?.walks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectedWalk = walks.find(w => w.id === walkId);
  const grantable = !!walkId;
  // A draft tour is never gifted as a Purchase (per Enda, 2026-11-21), even if a Creem
  // product id has already been filled in ahead of launch: a Purchase only makes a tour
  // visible once it is approved, so purchase-gifting a draft would silently give the
  // tester nothing. Drafts therefore always go through tester access
  // (grantTesterAccess) — the same free copy, visible and unlocked for this one person,
  // while the tour stays unpublished and absent from everyone else's catalogue. A
  // published tour with no product id still needs tester access too, since a Purchase
  // would have nothing to key on.
  const needsTesterAccess = (walk) => !!walk && (walk.approved !== true || !walk.creem_product_id);
  const asTesterAccess = needsTesterAccess(selectedWalk);

  const handleGrant = async () => {
    if (!grantable) return;
    setGranting(true);
    try {
      const res = asTesterAccess
        ? await base44.functions.invoke('grantTesterAccess', { walkId, testerEmail: appUser.email, ...narrAuth })
        : await base44.functions.invoke('grantWalk', { walkId, buyerEmail: appUser.email, ...narrAuth });
      const data = res.data || {};
      if (data.granted) {
        toast({
          title: asTesterAccess ? 'Tester access given' : 'Walk gifted',
          description: asTesterAccess
            ? `${appUser.email} can now open "${data.walk_name}". It stays unpublished for everyone else.`
            : `${appUser.email} now has "${data.walk_name}".`,
        });
        onClose();
      } else if (data.reason === 'already_owned' || data.reason === 'already_granted') {
        toast({ title: 'Already has it', description: `${appUser.email} already has "${data.walk_name}".` });
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
              <>
                {/* A plain native dropdown, deliberately not the shared Radix Select: inside
                    this dialog its popup list could be seen but no row could be picked from it
                    (Enda, 2026-11-21 — the tour was in the list, but selecting it did nothing).
                    A native select draws the list itself, so the dialog's overlay and focus trap
                    cannot swallow the click, and a long tour list gets type-ahead search free. */}
                <select
                  value={walkId}
                  onChange={(e) => setWalkId(e.target.value)}
                  className="w-full h-9 rounded-md border border-slate-600 bg-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="" className="bg-slate-800 text-white">Select a tour…</option>
                  {walks.map(w => (
                    <option key={w.id} value={w.id} className="bg-slate-800 text-white">
                      {w.name} ({w.code}){needsTesterAccess(w) ? ' — tester access' : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
            {asTesterAccess && (
              <p className="text-xs text-amber-400 mt-1.5">
                {selectedWalk?.approved !== true
                  ? 'This tour is still a draft, so it will be given as tester access: it appears in '
                  : 'This tour has no Creem product id, so it will be given as tester access: it appears in '}
                {appUser.email}'s library only, unlocked, and stays unpublished for everyone else.
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