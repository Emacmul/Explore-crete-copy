import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, CheckCircle, Loader2, FileQuestion } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function DownloadWalkButton({ walk }) {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handleDownloadGpx = async () => {
    setDownloading(true);

    try {
      let url;

      if (walk.gpx_file_uri) {
        const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({
          file_uri: walk.gpx_file_uri,
        });
        url = signed_url;
      } else if (walk.gpx_url) {
        url = walk.gpx_url;
      } else {
        return;
      }

      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${walk.code || walk.name}.gpx`;
      a.click();

      URL.revokeObjectURL(objectUrl);
      setDownloaded(true);
    } finally {
      setDownloading(false);
    }
  };

  if (!walk.gpx_file_uri && !walk.gpx_url) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <FileQuestion className="w-4 h-4" />
        <span>GPX file not yet available</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {downloaded && (
        <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
          <CheckCircle className="w-4 h-4" />
          <span>GPX downloaded!</span>
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={handleDownloadGpx}
        disabled={downloading}
        className="gap-2 border-blue-200 text-blue-600 hover:bg-blue-50"
      >
        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {downloading ? 'Downloading…' : downloaded ? 'Download again' : 'Download GPX'}
      </Button>
    </div>
  );
}