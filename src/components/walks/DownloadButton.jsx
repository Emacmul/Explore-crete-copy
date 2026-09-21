import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { useOfflineWalks } from '@/components/offline/useOfflineWalks';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/components/ui/use-toast';

export default function DownloadButton({ walk, size = 'sm', showLabel = true }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { downloadWalk, removeWalk, isDownloaded } = useOfflineWalks();
  const [phase, setPhase] = useState('idle'); // 'idle' | 'saving' | 'removing'
  // Two-step remove: first tap asks "are you sure?", second tap removes. The old button removed
  // the download on ONE tap while it was labelled "Saved Offline" - and its "Remove" label only
  // showed when a mouse hovered over it, which a phone never does (Enda, 2026-09-21).
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [progress, setProgress] = useState(0);
  const downloaded = isDownloaded(walk.id);

  const handleDownload = async (e) => {
    e.stopPropagation();
    setPhase('saving');
    setProgress(0);
    try {
      // Saves the full walk data, pre-caches the map tiles, then pre-downloads the
      // narration audio — all into one IndexedDB store, with a real progress %. The
      // walk is only marked "saved offline" once the narration is confirmed complete
      // (see useOfflineWalks.jsx / audit finding U-02) — if it isn't, tell the person
      // instead of silently showing the same success state as a clean download.
      const result = await downloadWalk(walk, p => setProgress(p));
      if (!result?.success) {
        toast({
          variant: 'destructive',
          title: t('download.incompleteTitle'),
          description: t('download.incompleteBody', {
            cached: result?.audio?.cached ?? 0,
            total: result?.audio?.total ?? 0,
          }) + (result?.audio?.failed?.length
            ? ' ' + t('download.incompleteNames', { names: result.audio.failed.map(f => f.name).join(', ') })
            : ''),
        });
      }
    } catch {
      toast({
        variant: 'destructive',
        title: t('download.failedTitle'),
        description: t('download.failedBody'),
      });
    } finally {
      setPhase('idle');
      setProgress(0);
    }
  };

  const handleRemove = async (e) => {
    e.stopPropagation();
    setConfirmingRemove(false);
    setPhase('removing');
    try {
      await removeWalk(walk.id);
    } finally {
      setPhase('idle');
    }
  };

  if (phase === 'saving') {
    return (
      <Button size={size} variant="outline" disabled className="gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {showLabel && <span>{t('download.savingPct', { n: progress })}</span>}
      </Button>
    );
  }

  if (phase === 'removing') {
    return (
      <Button size={size} variant="outline" disabled className="gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {showLabel && <span>{t('download.removing')}</span>}
      </Button>
    );
  }

  if (downloaded) {
    if (confirmingRemove) {
      return (
        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-gray-700">{t('download.removeConfirm')}</p>
          <div className="flex gap-2">
            <Button size={size} variant="outline" onClick={handleRemove} className="gap-2 border-red-300 text-red-700 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> {t('download.removeYes')}
            </Button>
            <Button size={size} variant="outline" onClick={(e) => { e.stopPropagation(); setConfirmingRemove(false); }} className="border-gray-300 text-gray-700 hover:bg-gray-50">
              {t('download.removeNo')}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-sm text-green-700">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{t('download.allChecked')}</span>
        </div>
        <Button
          size={size}
          variant="outline"
          onClick={(e) => { e.stopPropagation(); setConfirmingRemove(true); }}
          className="gap-2 border-gray-300 text-gray-700 hover:border-red-300 hover:text-red-600 hover:bg-red-50 self-start"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {showLabel && <span>{t('download.removeDownload')}</span>}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size={size}
      variant="outline"
      onClick={handleDownload}
      className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
    >
      <Download className="w-3.5 h-3.5" />
      {showLabel && <span>{t('download.saveForOffline')}</span>}
    </Button>
  );
}
