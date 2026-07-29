import React, { useState, useEffect } from 'react';
import { WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import { getAllOfflineWalks } from './offlineStorage';
import WalkCard from '../walks/WalkCard';

export default function OfflineWalksBanner({ onWalkSelect, selectedWalk }) {
  const [offlineWalks, setOfflineWalks] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    getAllOfflineWalks().then(setOfflineWalks);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      setExpanded(true); // auto-expand when going offline
      getAllOfflineWalks().then(setOfflineWalks);
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
            {!isOnline ? 'Offline mode — ' : ''}{offlineWalks.length} saved walk{offlineWalks.length !== 1 ? 's' : ''}
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