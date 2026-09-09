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
          }),
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
    return (
      <Button
        size={size}
        variant="outline"
        onClick={handleRemove}
        className="gap-2 border-green-300 text-green-700 hover:border-red-300 hover:text-red-600 hover:bg-red-50 group"
      >
        <CheckCircle className="w-3.5 h-3.5 group-hover:hidden" />
        <Trash2 className="w-3.5 h-3.5 hidden group-hover:block" />
        {showLabel && (
          <>
            <span className="group-hover:hidden">{t('download.savedOffline')}</span>
            <span className="hidden group-hover:block">{t('download.remove')}</span>
          </>
        )}
      </Button>
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
