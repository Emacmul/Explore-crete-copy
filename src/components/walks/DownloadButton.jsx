import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { useOfflineWalks } from '@/components/offline/useOfflineWalks';

export default function DownloadButton({ walk, size = 'sm', showLabel = true }) {
  const { downloadWalk, removeWalk, isDownloaded } = useOfflineWalks();
  const [loading, setLoading] = useState(false);
  const downloaded = isDownloaded(walk.id);

  const handleDownload = async (e) => {
    e.stopPropagation();
    setLoading(true);
    // Simulate brief save delay for UX feedback
    await new Promise(r => setTimeout(r, 400));
    downloadWalk(walk);
    setLoading(false);
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    removeWalk(walk.id);
  };

  if (loading) {
    return (
      <Button size={size} variant="outline" disabled className="gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {showLabel && <span>Saving…</span>}
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
            <span className="group-hover:hidden">Saved Offline</span>
            <span className="hidden group-hover:block">Remove</span>
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
      {showLabel && <span>Save for Offline</span>}
    </Button>
  );
}