import React, { useState, useEffect } from 'react';
import { WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import { useOfflineWalks } from './useOfflineWalks';
import WalkCard from '../walks/WalkCard';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function OfflineWalksBanner({ onWalkSelect, selectedWalk }) {
  const { t } = useLanguage();
  // Reads through the hook (not the raw storage functions) specifically because the hook
  // filters to the SIGNED-IN account's own downloads — see useOfflineWalks.jsx's reload()
  // (audit finding U-04, 2026-09-09 review). A second account on a shared device must never
  // see this list populated with someone else's paid offline tours.
  const { offlineWalks } = useOfflineWalks();
  const [expanded, setExpanded] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      setExpanded(true); // auto-expand when going offline
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (offlineWalks.length === 0) return null;

  return (
    <div className={`rounded-xl border overflow-hidden ${!isOnline ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <WifiOff className={`w-4 h-4 ${!isOnline ? 'text-amber-600' : 'text-gray-500'}`} />
          <span className={`font-medium text-sm ${!isOnline ? 'text-amber-700' : 'text-gray-700'}`}>
            {!isOnline ? t('offline.modePrefix') : ''}{t(offlineWalks.length === 1 ? 'offline.savedWalkOne' : 'offline.savedWalkMany', { n: offlineWalks.length })}
          </span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-200">
          {offlineWalks.map(walk => (
            <WalkCard
              key={walk.id}
              walk={walk}
              isSelected={selectedWalk?.id === walk.id}
              onClick={() => onWalkSelect(walk)}
            />
          ))}
        </div>
      )}
    </div>
  );
}