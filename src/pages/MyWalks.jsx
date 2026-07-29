import React, { useState } from 'react';
import { useOfflineWalks } from '@/components/offline/useOfflineWalks';
import { Button } from '@/components/ui/button';
import { ArrowLeft, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { AnimatePresence, motion } from 'framer-motion';
import WalkCard from '../components/walks/WalkCard';
import WalkDetail from '../components/walks/WalkDetail';
import OfflineBadge from '../components/walks/OfflineBadge';

export default function MyWalks() {
  const [selectedWalk, setSelectedWalk] = useState(null);
  const { getAllOfflineWalks } = useOfflineWalks();
  const offlineWalks = getAllOfflineWalks();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50">
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={createPageUrl('Home')}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <WifiOff className="w-5 h-5 text-green-600" />
            <h1 className="font-bold text-gray-900">My Downloaded Walks</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <AnimatePresence mode="wait">
          {selectedWalk ? (
            <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="h-[calc(100vh-100px)]">
              <WalkDetail walk={selectedWalk} onClose={() => setSelectedWalk(null)} />
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {offlineWalks.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                  <WifiOff className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p className="text-xl font-semibold mb-2">No walks downloaded yet</p>
                  <p className="text-sm mb-6">Go back and tap "Download" on any walk to save it for offline use.</p>
                  <Link to={createPageUrl('Home')}>
                    <Button>Browse Walks</Button>
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500 mb-4">
                    These walks are saved on your device and work without internet.
                  </p>
                  <div className="space-y-3 max-w-xl">
                    {offlineWalks.map(walk => (
                      <div key={walk.id} className="relative">
                        <div className="absolute top-3 right-10 z-10">
                          <OfflineBadge />
                        </div>
                        <WalkCard
                          walk={walk}
                          isSelected={selectedWalk?.id === walk.id}
                          onClick={() => setSelectedWalk(walk)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}