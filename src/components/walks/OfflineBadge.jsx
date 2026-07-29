import React from 'react';
import { WifiOff } from 'lucide-react';

export default function OfflineBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
      <WifiOff className="w-3 h-3" />
      Offline ready
    </span>
  );
}