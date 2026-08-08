import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, MapPin, User, ShieldCheck, WifiOff, Footprints, Mic } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import { useOfflineWalks } from '../components/offline/useOfflineWalks';
import { motion, AnimatePresence } from 'framer-motion';
import CreteMap from '../components/map/CreteMap';
import WalkList from '../components/walks/WalkList';
import { getAccessibleWalks } from '../lib/membership';
import WalkDetail from '../components/walks/WalkDetail';
import UpdateInProgressModal from '../components/offline/UpdateInProgressModal';
import { isWalkOutdated, saveWalkOffline, preCacheWalkTiles } from '../components/offline/offlineStorage';
import SplashScreen from '../components/onboarding/SplashScreen';
import TourCategoryPicker from '../components/walks/TourCategoryPicker';
import { getTourCategory } from '../lib/tourCategories';
import NewWalkAnnouncementModal, { getUnseenAnnouncement } from '../components/walks/NewWalkAnnouncementModal';

export default function Home() {
  // Auth is already handled once, app-wide, by AuthProvider/AuthContext (the
  // WordPress login) — App.jsx only ever renders this page once that login
  // has succeeded. Home used to also run its own separate, older login check
  // here (base44.auth.*), which is what was silently bouncing WordPress users
  // into the old, unrelated registration screen. That old check — and the
  // registration screen it triggered — has been removed.
  const { user, logout, isAdmin, isNarrator } = useAuth();
  const [selectedWalk, setSelectedWalk] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tapLocation, setTapLocation] = useState(null);
  const [updatingWalkName, setUpdatingWalkName] = useState(null);
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splash_seen'));
  const [newWalkAnnouncement, setNewWalkAnnouncement] = useState(null);
  const [selectedTourCategory, setSelectedTourCategory] = useState(() => sessionStorage.getItem('tour_category'));

  const { getAllOfflineWalks } = useOfflineWalks();
  const offlineCount = getAllOfflineWalks().length;
  const updatingRef = useRef(false);

  const { data: walks = [], isLoading: walksLoading } = useQuery({
    queryKey: ['walks'],
    queryFn: () => base44.entities.Walk.list(),
    enabled: !!user,
  });

  useEffect(() => {
    if (!walks.length) return;

    const unseen = getUnseenAnnouncement(walks);

    if (unseen) {
      setNewWalkAnnouncement(unseen);
    }
  }, [walks]);

  useEffect(() => {
    if (!walks.length || updatingRef.current) return;

    const runUpdates = async () => {
      updatingRef.current = true;

      for (const serverWalk of walks) {
        const outdated = await isWalkOutdated(serverWalk);

        if (outdated) {
          setUpdatingWalkName(serverWalk.name);
          await saveWalkOffline(serverWalk);
          await preCacheWalkTiles(serverWalk, () => {});
          setUpdatingWalkName(null);

          setSelectedWalk(prev => prev?.id === serverWalk.id ? serverWalk : prev);
        }
      }

      updatingRef.current = false;
    };

    runUpdates();
  }, [walks]);

  const handleWalkSelect = async (walk) => {
    const outdated = await isWalkOutdated(walk);

    if (outdated) {
      setUpdatingWalkName(walk.name);
      await saveWalkOffline(walk);
      await preCacheWalkTiles(walk, () => {});
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

  const handleChangeCategory = () => {
    sessionStorage.removeItem('tour_category');
    setSelectedTourCategory(null);
    setSelectedWalk(null);
    setShowDetail(false);
  };

  const accessibleWalks = getAccessibleWalks(walks);
  const categoryWalks = selectedTourCategory
    ? accessibleWalks.filter(w => w.tour_category === selectedTourCategory)
    : accessibleWalks;

  if (!showSplash && !selectedTourCategory) {
    return (
      <TourCategoryPicker onSelect={handleCategorySelect} />
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

      {newWalkAnnouncement && !showSplash && (
        <NewWalkAnnouncementModal
          walk={newWalkAnnouncement}
          onDismiss={() => setNewWalkAnnouncement(null)}
        />
      )}

      <UpdateInProgressModal walkName={updatingWalkName} />

      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
              <MapPin className="w-5 h-5 text-white" />
            </div>

            <div>
              <h1 className="font-bold text-gray-900">Crete Walking Trails</h1>
              <p className="text-xs text-gray-500">Discover the island's beauty</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-600">
              <User className="w-4 h-4" />
              <span>{user?.full_name || user?.email}</span>
            </div>

            {selectedTourCategory && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleChangeCategory}
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <span className="font-mono text-xs font-bold">{selectedTourCategory}</span>
                <span className="hidden sm:inline">Change</span>
              </Button>
            )}

            <Link to={createPageUrl('MyWalks')}>
              <Button variant="outline" size="sm" className="gap-2 border-green-300 text-green-700 hover:bg-green-50 relative">
                <WifiOff className="w-4 h-4" />
                <span className="hidden sm:inline">My Walks</span>

                {offlineCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-green-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                    {offlineCount}
                  </span>
                )}
              </Button>
            </Link>

            <Link to={createPageUrl('MyRecordedWalks')}>
              <Button variant="outline" size="sm" className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50">
                <Footprints className="w-4 h-4" />
                <span className="hidden sm:inline">Recorded Walks</span>
              </Button>
            </Link>

            {isAdmin && (
              <Link to={createPageUrl('Admin')}>
                <Button variant="outline" size="sm" className="gap-2 border-amber-300 text-amber-600 hover:bg-amber-50">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              </Link>
            )}

            {isNarrator && (
              <Link to={createPageUrl('Admin')}>
                <Button variant="outline" size="sm" className="gap-2 border-purple-300 text-purple-700 hover:bg-purple-50">
                  <Mic className="w-4 h-4" />
                  <span className="hidden sm:inline">Narrator</span>
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
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <div className="grid lg:grid-cols-3 gap-4 h-[calc(100vh-180px)]">
          <div className="lg:col-span-1 h-full">
            <WalkList
              walks={categoryWalks}
              selectedWalk={selectedWalk}
              onWalkSelect={handleWalkSelect}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
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
                      <span className="font-medium text-gray-900">Tap the map</span> to find walks near that location,
                      or <span className="font-medium text-gray-900">tap a walk code</span> to see details
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