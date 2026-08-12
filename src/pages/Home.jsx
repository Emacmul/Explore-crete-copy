import React, { useState, useEffect, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, User, ShieldCheck, Mic, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import { useOfflineWalks } from '../components/offline/useOfflineWalks';
import { motion, AnimatePresence } from 'framer-motion';
import CreteMap from '../components/map/CreteMap';
import WalkList from '../components/walks/WalkList';
import WalkDetail from '../components/walks/WalkDetail';
import UpdateInProgressModal from '../components/offline/UpdateInProgressModal';
import { isWalkOutdated, replaceWalkOffline, preCacheWalkTiles, preCacheWalkAudio } from '../components/offline/offlineStorage';
import SplashScreen from '../components/onboarding/SplashScreen';
import { getTourCategory, TOUR_CATEGORIES } from '../lib/tourCategories';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import InstallPrompt from '../components/InstallPrompt';
import LanguagePicker from '@/components/ui/LanguagePicker';
import NarrationLanguagePicker from '@/components/ui/NarrationLanguagePicker';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function Home() {
  const { user, logout, token } = useAuth();
  const { t, effectiveNarrationLang } = useLanguage();
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWalk, setSelectedWalk] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tapLocation, setTapLocation] = useState(null);
  const [updatingWalkName, setUpdatingWalkName] = useState(null);
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splash_seen'));
  const [selectedTourCategory, setSelectedTourCategory] = useState(() => sessionStorage.getItem('tour_category') || 'WHT');
  const [userRole, setUserRole] = useState(null); // 'admin' | 'narrator' | null — which back-end button (Admin or Narr) to show

  const { getAllOfflineWalks } = useOfflineWalks();
  const offlineCount = getAllOfflineWalks().length;
  const updatingRef = useRef(false);

  useEffect(() => {
    const checkRegistration = async () => {
      try {
        // Onboarding runs through a token-identified backend function (asServiceRole)
        // rather than direct client-SDK writes: real customers log in through
        // WordPress and have NO Base44 session, so RLS (which keys off the Base44
        // user) can't identify them. The function ensures their AppUser row exists
        // and is linked — and never touches role, which only changes via
        // saveAppUserAdmin (admin-gated).
        const res = await base44.functions.invoke('ensureAppUserOnboarding', {
          token,
          email: user.email,
          display_name: user.full_name || user.display_name,
        });
        const role = res.data?.role;
        if (role === 'admin' || role === 'narrator') {
          setUserRole(role);
        }
      } catch (error) {
        console.error('Registration check error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (user) checkRegistration();
  }, [user]);

  // The catalogue comes from getWalkCatalog (not a raw Walk.list()) so the SERVER can
  // withhold protected content — narration scripts, audio URLs, the full route line and
  // the GPX — from walks the caller hasn't bought. Each walk carries `_accessible` (true if
  // it's a free sample or the caller owns its creem_product_id), so the client shows a Buy
  // button / paywall for the rest without ever receiving their protected data.
  //
  // The caller is identified from the WordPress-issued token the client already holds (the
  // same way syncLibrary does) — NOT Base44's own session, which real customers never have
  // (they log in through WordPress only). The server decides entitlement by email; the
  // browser never sees protected fields for walks it doesn't own.
  const { data: walks = [], isLoading: walksLoading, refetch: refetchWalks, isFetching: walksRefreshing } = useQuery({
    queryKey: ['walkCatalog', token, effectiveNarrationLang],
    queryFn: async () => (await base44.functions.invoke('getWalkCatalog', { token, narrationLang: effectiveNarrationLang })).data.walks || [],
    enabled: !!user && !!token,
  });

  // The languages that actually have a published narration somewhere in the loaded
  // catalogue — feeds the narration picker so it never offers a language nothing is
  // available in. English (the original) is always present.
  const availableNarrationLangs = useMemo(() => {
    const set = new Set(['English']);
    walks.forEach(w => (w._available_langs || []).forEach(l => set.add(l)));
    return [...set];
  }, [walks]);

  useEffect(() => {
    if (!walks.length || updatingRef.current) return;

    const runUpdates = async () => {
      updatingRef.current = true;

      for (const serverWalk of walks) {
        // Skip walks the caller doesn't own — they have no protected content to cache, and
        // pre-caching tiles/audio for a locked walk would be wasted work on teaser data.
        if (serverWalk._accessible === false) continue;

        const outdated = await isWalkOutdated(serverWalk);

        if (outdated) {
          setUpdatingWalkName(serverWalk.name);
          await replaceWalkOffline(serverWalk);
          await preCacheWalkTiles(serverWalk, () => {});
          await preCacheWalkAudio(serverWalk, () => {});
          setUpdatingWalkName(null);

          setSelectedWalk(prev => prev?.id === serverWalk.id ? serverWalk : prev);
        }
      }

      updatingRef.current = false;
    };

    runUpdates();
  }, [walks]);

  const handleWalkSelect = async (walk) => {
    // A locked walk has no protected content to cache — just open its paywall.
    if (walk._accessible === false) {
      setSelectedWalk(walk);
      setShowDetail(true);
      return;
    }

    const outdated = await isWalkOutdated(walk);

    if (outdated) {
      setUpdatingWalkName(walk.name);
      await replaceWalkOffline(walk);
      await preCacheWalkTiles(walk, () => {});
      await preCacheWalkAudio(walk, () => {});
      setUpdatingWalkName(null);
    }

    setSelectedWalk(walk);
    setShowDetail(true);
  };

  const handleMapClick = (latlng) => {
    setTapLocation(latlng);

    const nearbyWalks = walks.filter(walk => {
      const distance = Math.sqrt(
        Math.pow(walk.start_lat - latlng.lat, 2) +
        Math.pow(walk.start_lng - latlng.lng, 2)
      );

      return distance < 0.2;
    });

    if (nearbyWalks.length > 0) {
      setSelectedWalk(nearbyWalks[0]);
    }
  };

  const handleLogout = () => {
    logout();
  };

  const handleCategorySelect = (code) => {
    sessionStorage.setItem('tour_category', code);
    setSelectedTourCategory(code);
    setSelectedWalk(null);
    setShowDetail(false);
  };

  const accessibleWalks = walks.filter(w => w.approved !== false);
  const categoryWalks = selectedTourCategory
    ? accessibleWalks.filter(w => w.tour_category === selectedTourCategory)
    : accessibleWalks;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50">
      {showSplash && (
        <SplashScreen
          onDone={() => {
            sessionStorage.setItem('splash_seen', '1');
            setShowSplash(false);
          }}
        />
      )}

      <UpdateInProgressModal walkName={updatingWalkName} />
      <InstallPrompt />

      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-10 h-10 rounded-xl shadow-lg object-contain" />

            <div>
              <h1 className="font-bold text-gray-900">{t('app.title')}</h1>
              <p className="text-xs text-gray-500">{t('app.tagline')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <LanguagePicker />
            <NarrationLanguagePicker availableLangs={availableNarrationLangs} />

            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-600">
              <User className="w-4 h-4" />
              <span>{user?.full_name || user?.email}</span>
            </div>

            {selectedTourCategory && (
              <Select value={selectedTourCategory} onValueChange={handleCategorySelect}>
                <SelectTrigger className="h-8 w-auto gap-2 text-xs border-blue-300 text-blue-700">
                  <span className="sm:hidden">{t('home.change')}:</span>
                  <span className="hidden sm:inline">{t('home.changeTourType')}:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOUR_CATEGORIES.map(cat => (
                    <SelectItem key={cat.code} value={cat.code}>
                      {t('tour.' + cat.code + '.label')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Link to={createPageUrl('MyWalks')}>
              <Button variant="outline" size="sm" className="gap-2 border-green-300 text-green-700 hover:bg-green-50 relative">
                <WifiOff className="w-4 h-4" />
                <span className="hidden sm:inline">{t('home.myLibrary')}</span>

                {offlineCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-green-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                    {offlineCount}
                  </span>
                )}
              </Button>
            </Link>

            {userRole === 'admin' && (
              <Link to={createPageUrl('Admin')}>
                <Button variant="outline" size="sm" className="gap-2 border-amber-300 text-amber-600 hover:bg-amber-50">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('home.admin')}</span>
                </Button>
              </Link>
            )}
            {(userRole === 'admin' || userRole === 'narrator') && (
              <Link to={createPageUrl('Narr')}>
                <Button variant="outline" size="sm" className="gap-2 border-purple-300 text-purple-600 hover:bg-purple-50">
                  <Mic className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('home.narr')}</span>
                </Button>
              </Link>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{t('home.logout')}</span>
            </Button>
          </div>
        </div>
      </header>

      <footer className="border-t bg-white/60 py-3">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-center gap-4 text-xs text-gray-500">
          <Link to="/About" className="hover:text-gray-800 hover:underline">About</Link>
          <span>·</span>
          <Link to="/Contact" className="hover:text-gray-800 hover:underline">Contact</Link>
        </div>
      </footer>

      <main className="max-w-7xl mx-auto p-4">
        <div className="grid lg:grid-cols-3 gap-4 h-[calc(100vh-180px)]">
          <div className="lg:col-span-1 h-full">
            <WalkList
              walks={categoryWalks}
              selectedWalk={selectedWalk}
              onWalkSelect={handleWalkSelect}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRefresh={refetchWalks}
              refreshing={walksRefreshing}
              tourCategoryCode={selectedTourCategory}
            />
          </div>

          <div className="lg:col-span-2 h-full relative">
            <AnimatePresence mode="wait">
              {showDetail && selectedWalk ? (
                <motion.div
                  key="detail"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full"
                >
                  <WalkDetail
                    walk={selectedWalk}
                    onClose={() => setShowDetail(false)}
                    accessible={selectedWalk._accessible ?? true}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="map"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full"
                >
                  <div className="h-full rounded-2xl overflow-hidden shadow-xl border">
                    {walksLoading ? (
                      <div className="h-full bg-gray-100 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                      </div>
                    ) : (
                      <CreteMap
                        walks={categoryWalks}
                        selectedWalk={selectedWalk}
                        onWalkSelect={handleWalkSelect}
                        onMapClick={handleMapClick}
                      />
                    )}
                  </div>

                  <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-lg border">
                    <p className="text-sm text-gray-600 text-center">
                      {t('home.mapHint')}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}