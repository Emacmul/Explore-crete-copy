import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RotateCcw, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

// Admin view of chargebacks that revoked access. Creem sends no "dispute won" event, so
// when a dispute is resolved in our favor an admin clicks Restore here — it re-creates the
// deleted Purchase (or re-activates the expired membership) via the restoreDispute function.
export default function DisputesManager() {
  const [disputes, setDisputes] = useState([]);
  const [walks, setWalks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);

  const load = useCallback(async () => {
    const [list, walkList] = await Promise.all([
      base44.entities.Dispute.list('-created_date', 200),
      base44.entities.Walk.list('-name', 500),
    ]);
    setDisputes(list || []);
    setWalks(walkList || []);
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const walkName = (id) => (walks.find(w => w.id === id) || {}).name;

  const handleRestore = async (dispute) => {
    setRestoringId(dispute.id);
    try {
      const res = await base44.functions.invoke('restoreDispute', { disputeId: dispute.id });
      const data = res.data || {};
      if (data.restored) {
        toast({
          title: 'Access restored',
          description: `${dispute.buyer_email} — ${dispute.access_target === 'membership' ? 'membership reactivated' : 'walk re-granted'}.`,
        });
        await load();
      } else {
        toast({ variant: 'destructive', title: 'Could not restore', description: data.reason || data.error || 'Unknown error.' });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Restore failed', description: err?.message });
    } finally {
      setRestoringId(null);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Loading disputes…</div>;
  }

  const revoked = disputes.filter(d => d.status === 'revoked');
  const restored = disputes.filter(d => d.status === 'restored');

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-rose-400" /> Chargeback disputes</h2>
        <p className="text-sm text-slate-400">Each row is a chargeback that revoked access. When Creem resolves the dispute in your favor, click <strong>Restore</strong> to put access back.</p>
      </div>

      {revoked.length === 0 && restored.length === 0 ? (
        <div className="text-center py-10 text-slate-500 border border-dashed border-slate-700 rounded-xl">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No chargebacks recorded</p>
        </div>
      ) : (
        <div className="space-y-2">
          {revoked.map(d => (
            <div key={d.id} className="bg-slate-800 border border-rose-800/50 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white truncate">{d.buyer_email}</p>
                <p className="text-xs text-slate-400">
                  {d.access_target === 'membership' ? 'Annual membership' : (walkName(d.walk_id) || 'Walk purchase')}
                  {d.product_id ? ` · ${d.product_id}` : ''}
                  {d.reason ? ` · ${d.reason}` : ''}
                </p>
                <p className="text-xs text-slate-500">{new Date(d.created_date).toLocaleString()}</p>
              </div>
              <Button size="sm" onClick={() => handleRestore(d)} disabled={restoringId === d.id} className="bg-emerald-600 hover:bg-emerald-700 gap-2 shrink-0">
                {restoringId === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Restore
              </Button>
            </div>
          ))}
          {restored.map(d => (
            <div key={d.id} className="bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3 opacity-70">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-300 truncate">{d.buyer_email}</p>
                <p className="text-xs text-slate-500">
                  {d.access_target === 'membership' ? 'Annual membership' : (walkName(d.walk_id) || 'Walk purchase')}
                  {d.restored_at ? ` · restored ${new Date(d.restored_at).toLocaleString()}` : ''}
                </p>
              </div>
              <Badge className="bg-emerald-900 text-emerald-300 border-emerald-700 shrink-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Restored</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}