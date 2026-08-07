import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, User, ShieldCheck, WifiOff } from 'lucide-react';
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
import RegistrationForm from '../components/onboarding/RegistrationForm';
import TourCategoryPicker from '../components/walks/TourCategoryPicker';
import { getTourCategory } from '../lib/tourCategories';
import InstallPrompt from '../components/InstallPrompt';

export default function Home() {
  const { user, logout } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWalk, setSelectedWalk] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tapLocation, setTapLocation] = useState(null);
  const [updatingWalkName, setUpdatingWalkName] = useState(null);
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splash_seen'));
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [selectedTourCategory, setSelectedTourCategory] = useState(() => sessionStorage.getItem('tour_category'));
  const [isStaff, setIsStaff] = useState(false); // admin or narrator — controls whether the Admin link shows at all

  const { getAllOfflineWalks } = useOfflineWalks();
  const offlineCount = getAllOfflineWalks().length;
  const updatingRef = useRef(false);

  useEffect(() => {
    const checkRegistration = async () => {
      try {
        const appUsers = await base44.entities.AppUser.filter({ user_id: user.id });
        let finalAppUser = appUsers[0] || null;

        if (finalAppUser && finalAppUser.registration_complete) {
          setRegistrationComplete(true);
        } else if (finalAppUser) {
          // AppUser record exists (matched by user_id) but was never marked complete (e.g.
          // created before this fix) — WordPress registration already collected everything
          // needed, so just mark it complete now instead of showing the old in-app form again.
          await base44.entities.AppUser.update(finalAppUser.id, { registration_complete: true });
          finalAppUser = { ...finalAppUser, registration_complete: true };
          setRegistrationComplete(true);
        } else {
          // No record matched by user_id — but Enda may have already invited this person as an
          // admin/narrator via the Users Manager, which creates their AppUser record ahead of
          // time (with their role already set) but with no user_id yet, since they hadn't
          // logged in. Check by email before assuming this is a brand new person — otherwise
          // this would create a second, separate record with no role at all, silently locking
          // a newly invited admin/narrator out of the Admin Panel.
          const byEmail = await base44.entities.AppUser.filter({ email: (user.email || '').toLowerCase() });
          const invited = byEmail.find(u => !u.user_id);

          if (invited) {
            await base44.entities.AppUser.update(invited.id, {
              user_id: user.id,
              registration_complete: true,
            });
            finalAppUser = { ...invited, user_id: user.id, registration_complete: true };
          } else {
            // Genuinely this person's first login after registering through WordPress. Create
            // the record straight away, already complete, instead of asking them to re-enter
            // information WordPress's registration form already collected a moment ago. Name is
            // filled in on a best-effort basis from whatever WordPress provides
            // (full_name/display_name) — never required, since the app itself doesn't collect
            // it anymore.
            const nameParts = (user.full_name || user.display_name || '').trim().split(/\s+/);
            const created = await base44.entities.AppUser.create({
              user_id: user.id,
              email: user.email,
              first_name: nameParts[0] || '',
              last_name: nameParts.slice(1).join(' ') || '',
              registration_complete: true,
            });
            finalAppUser = created;
          }
          setRegistrationComplete(true);
        }

        // This login is WordPress-based (see AuthContext.jsx) and carries no role field of its
        // own — unlike Admin.jsx, which checks Base44's separate native login. The AppUser
        // record's own `role` field is the only real source of truth here.
        if (finalAppUser && (finalAppUser.role === 'admin' || finalAppUser.role === 'narrator')) {
          setIsStaff(true);
        }
      } catch (error) {
        console.error('Registration check error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (user) checkRegistration();
  }, [user]);

  const { data: walks = [], isLoading: walksLoading, refetch: refetchWalks, isFetching: walksRefreshing } = useQuery({
    queryKey: ['walks'],
    queryFn: () => base44.entities.Walk.list(),
    enabled: !!user,
  });

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!registrationComplete && !showSplash) {
    return (
      <RegistrationForm
        user={user}
        onComplete={() => setRegistrationComplete(true)}
      />
    );
  }

  if (registrationComplete && !showSplash && !selectedTourCategory) {
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

      <UpdateInProgressModal walkName={updatingWalkName} />
      <InstallPrompt />

      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/explore-crete-logo.png" alt="Explore Crete" className="w-10 h-10 rounded-xl shadow-lg object-contain" />

            <div>
              <h1 className="font-bold text-gray-900">Explore Crete</h1>
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
                <span className="sm:hidden">Change</span>
                <span className="hidden sm:inline">Change tour type</span>
              </Button>
            )}

            <Link to={createPageUrl('MyWalks')}>
              <Button variant="outline" size="sm" className="gap-2 border-green-300 text-green-700 hover:bg-green-50 relative">
                <WifiOff className="w-4 h-4" />
                <span className="hidden sm:inline">My Library</span>

                {offlineCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-green-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                    {offlineCount}
                  </span>
                )}
              </Button>
            </Link>

            {isStaff && (
              <Link to={createPageUrl('Admin')}>
                <Button variant="outline" size="sm" className="gap-2 border-amber-300 text-amber-600 hover:bg-amber-50">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="hidden sm:inline">Admin</span>
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