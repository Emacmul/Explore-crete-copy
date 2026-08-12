import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useOfflineWalks } from '@/components/offline/useOfflineWalks';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Library, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { AnimatePresence, motion } from 'framer-motion';
import WalkCard from '../components/walks/WalkCard';
import WalkDetail from '../components/walks/WalkDetail';
import OfflineBadge from '../components/walks/OfflineBadge';
import DownloadButton from '../components/walks/DownloadButton';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// Shows every tour the customer actually owns (purchased + free samples), regardless of
// whether it's been saved for offline use yet — not just the ones already downloaded.
// Without this, someone could easily forget they already own something and buy it again,
// which is exactly the kind of thing that ends up needing a refund later.
export default function MyWalks() {
  const { t, effectiveNarrationLang } = useLanguage();
  const { token } = useAuth();
  const [selectedWalk, setSelectedWalk] = useState(null);
  const { isDownloaded } = useOfflineWalks();

  // Same query key as Home.jsx's catalog fetch, so this shares the same cached data
  // instead of re-fetching separately or risking the two screens disagreeing.
  const { data: walks = [], isLoading } = useQuery({
    queryKey: ['walkCatalog', token, effectiveNarrationLang],
    queryFn: async () => (await base44.functions.invoke('getWalkCatalog', { token, narrationLang: effectiveNarrationLang })).data.walks || [],
    enabled: !!token,
  });

  const ownedWalks = walks.filter(w => w._accessible !== false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50">
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to={createPageUrl('Home')}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> {t('common.back')}
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Library className="w-5 h-5 text-blue-600" />
            <h1 className="font-bold text-gray-900">{t('mywalks.title')}</h1>
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
              {isLoading ? (
                <div className="text-center py-20 text-gray-400">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin" />
                </div>
              ) : ownedWalks.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                  <Library className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p className="text-xl font-semibold mb-2">{t('mywalks.emptyTitle')}</p>
                  <p className="text-sm mb-6">{t('mywalks.emptyHint')}</p>
                  <Link to={createPageUrl('Home')}>
                    <Button>{t('mywalks.browseWalks')}</Button>
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500 mb-4">
                    {t('mywalks.offlineNote')}
                  </p>
                  <div className="space-y-3 max-w-xl">
                    {ownedWalks.map(walk => {
                      const downloaded = isDownloaded(walk.id);
                      return (
                        <div key={walk.id} className="relative">
                          <div className="absolute top-3 right-10 z-10">
                            {downloaded ? <OfflineBadge /> : <DownloadButton walk={walk} size="sm" showLabel={false} />}
                          </div>
                          <WalkCard
                            walk={walk}
                            isSelected={selectedWalk?.id === walk.id}
                            onClick={() => setSelectedWalk(walk)}
                          />
                        </div>
                      );
                    })}
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
