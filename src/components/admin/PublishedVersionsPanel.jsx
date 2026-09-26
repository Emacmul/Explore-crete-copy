import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, History, Undo2, EyeOff, AlertTriangle } from 'lucide-react';
import moment from 'moment';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/use-toast';

/**
 * Published Versions panel (published-versions plan §2, admin UI): every customer-facing
 * version, grouped per (tour family, language) pair — the active version (what customers
 * are served right now), the full version history, rollback to any retired version
 * (scoped to this pair only), and withdrawal of the pair's active version (the new
 * "unpublish": other languages keep their own versions; nothing is deleted, so a
 * withdrawn version can be rolled back to later). Data comes from listTourVersionsAdmin,
 * which resolves each pair's active version exactly the way the serving path does.
 */
export default function PublishedVersionsPanel({ callWalkFn }) {
  const [loading, setLoading] = useState(true);
  const [pairs, setPairs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { kind: 'rollback'|'withdraw', version?, pair }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callWalkFn('listTourVersionsAdmin', {});
      setPairs(data.pairs || []);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load versions', description: err?.message || 'Try again.' });
    }
    setLoading(false);
  }, [callWalkFn]);

  useEffect(() => { load(); }, [load]);

  const runAction = async () => {
    if (!confirmAction || busy) return;
    setBusy(true);
    try {
      if (confirmAction.kind === 'rollback') {
        await callWalkFn('rollbackTourVersion', { published_tour_id: confirmAction.version.id });
        toast({
          title: `Rolled back to version ${confirmAction.version.version_number}`,
          description: `${confirmAction.pair.language} customers now see version ${confirmAction.version.version_number}. Every other language is untouched.`,
        });
      } else {
        const data = await callWalkFn('withdrawTourVersion', {
          family_id: confirmAction.pair.family_id,
          language: confirmAction.pair.language,
        });
        toast({
          title: data?.withdrawn > 0 ? 'Version withdrawn' : 'Nothing to withdraw',
          description: data?.withdrawn > 0
            ? `${confirmAction.pair.language} customers no longer see this tour. The versions are kept and can be rolled back to.`
            : 'This tour and language had no active published version.',
        });
      }
      await load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Action failed', description: err?.message || 'Try again.' });
    }
    setBusy(false);
    setConfirmAction(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" /> Published Versions
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            What customers are served, per tour and language. Sources stay editable; only publishing changes what customers see.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}
          className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </Button>
      </div>

      {loading && pairs.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
        </div>
      ) : pairs.length === 0 ? (
        <div className="text-center py-16 text-slate-500 border border-dashed border-slate-700 rounded-xl">
          <History className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No published versions yet</p>
          <p className="text-sm">Publish a tour from its editor or a finished translation to create version 1.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pairs.map((pair) => (
            <div key={`${pair.family_id}||${pair.language}`}
              className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-emerald-300 font-bold">{pair.family_code || pair.family_id.slice(0, 8)}</span>
                  <span className="text-white font-medium truncate">{pair.language}</span>
                  {pair.resolved_active ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">Active: v{pair.resolved_active.version_number}</Badge>
                  ) : (
                    <Badge variant="outline" className="border-slate-600 text-slate-400">No active version</Badge>
                  )}
                </div>
                <Button
                  variant="outline" size="sm" disabled={busy || !pair.resolved_active}
                  onClick={() => setConfirmAction({ kind: 'withdraw', pair })}
                  className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 gap-1.5">
                  <EyeOff className="w-3.5 h-3.5" /> Withdraw
                </Button>
              </div>

              {pair.anomaly && (
                <div className="flex items-start gap-2 bg-amber-900/40 border border-amber-600/60 rounded-lg p-2.5 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {pair.active_count} active versions for this pair (an interrupted publish/rollback). Customers are
                    deterministically served the newest; the next publish or rollback on this pair repairs it to one.
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                {pair.versions.map((v) => (
                  <div key={v.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 text-sm min-w-0">
                      <span className="font-mono text-slate-300">v{v.version_number}</span>
                      {v.status === 'active' ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-xs">active</Badge>
                      ) : (
                        <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">retired</Badge>
                      )}
                      <span className="text-slate-400 text-xs truncate">
                        published {moment(v.published_at).format('YYYY-MM-DD HH:mm')} by {v.published_by_email || 'admin'}
                      </span>
                    </div>
                    {v.status !== 'active' && (
                      <Button
                        variant="outline" size="sm" disabled={busy}
                        onClick={() => setConfirmAction({ kind: 'rollback', version: v, pair })}
                        className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 gap-1.5 h-7 text-xs">
                        <Undo2 className="w-3.5 h-3.5" /> Roll back here
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !busy && !o && setConfirmAction(null)}>
        <AlertDialogContent className="bg-slate-800 border-2 border-slate-600 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {confirmAction?.kind === 'rollback'
                ? `Roll back to version ${confirmAction?.version?.version_number}?`
                : 'Withdraw the active version?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              {confirmAction?.kind === 'rollback' ? (
                <>
                  {confirmAction?.pair?.language} customers will be served version {confirmAction?.version?.version_number}
                  again. This touches only this tour and language — every other language keeps its current version, and the
                  version rolled back FROM is retained, not deleted.
                </>
              ) : (
                <>
                  {confirmAction?.pair?.language} customers will stop seeing this tour (no active version). Every other
                  language keeps its own published version, and all retired versions are kept so this can be rolled back.
                  Also unpublish the source tour in its editor so the legacy fallback doesn't keep serving it.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600" disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); runAction(); }}
              disabled={busy}
              className={confirmAction?.kind === 'rollback' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (confirmAction?.kind === 'rollback' ? 'Roll back' : 'Withdraw')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}