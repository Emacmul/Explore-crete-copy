import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Footprints, Plus, Loader2, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import WalkRecorder from '@/components/recorded/WalkRecorder';
import RecordedWalkCard from '@/components/recorded/RecordedWalkCard';
import { useAuth } from '@/lib/AuthContext';

export default function MyRecordedWalks() {
  // Reachable only after the custom WordPress login (App.jsx gates unauthenticated
  // users), so `user` from useAuth is the WordPress session — never redirect to the
  // Base44 platform login.
  const { user } = useAuth();
  const [appUser, setAppUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showRecorder, setShowRecorder] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) { setIsLoading(false); return; }
    const init = async () => {
      try {
        const appUsers = await base44.entities.AppUser.filter({ user_id: user.id });
        setAppUser(appUsers[0] || null);
      } catch (err) {
        console.error('AppUser lookup error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [user]);

  const canRecord = appUser?.is_member === true;

  const { data: myWalks = [] } = useQuery({
    queryKey: ['recorded-walks', user?.id],
    queryFn: () => base44.entities.RecordedWalk.filter(
      { owner_user_id: user.id },
      '-recorded_at'
    ),
    enabled: !!user && canRecord,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-amber-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50">
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            </Link>

            <div className="flex items-center gap-2">
              <Footprints className="w-5 h-5 text-amber-600" />
              <h1 className="font-bold text-gray-900">My Recorded Walks</h1>
            </div>
          </div>

          {canRecord && !showRecorder && (
            <Button
              onClick={() => setShowRecorder(true)}
              size="sm"
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              <Plus className="w-4 h-4" /> Record Walk
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        <AnimatePresence mode="wait">
          {showRecorder && canRecord && (
            <motion.div
              key="recorder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-[calc(100vh-120px)]"
            >
              <WalkRecorder
                user={user}
                appUser={appUser}
                onSaved={() => {
                  setShowRecorder(false);
                  queryClient.invalidateQueries({ queryKey: ['recorded-walks'] });
                }}
                onCancel={() => setShowRecorder(false)}
              />
            </motion.div>
          )}

          {!showRecorder && !canRecord && (
            <motion.div
              key="member-required"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="mt-8 bg-white rounded-2xl border shadow-sm overflow-hidden">
                <div className="bg-gradient-to-br from-amber-500 to-amber-600 p-8 text-white text-center">
                  <Lock className="w-14 h-14 mx-auto mb-3 opacity-90" />
                  <h2 className="text-2xl font-bold mb-2">Members Only</h2>
                  <p className="text-amber-100 text-sm max-w-xs mx-auto">
                    Recording and submitting your own walks is available to Magical Crete members.
                  </p>
                </div>

                <div className="p-6 space-y-4">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Members can record their own walks and submit them for review. Approved walks may be published as community walks after checking by Magical Crete.
                  </p>

                  <a
                    href="https://magicalcrete.com/home-v2/memberships/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white">
                      View Membership
                    </Button>
                  </a>
                </div>
              </div>
            </motion.div>
          )}

          {!showRecorder && canRecord && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {myWalks.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Footprints className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p className="text-lg font-semibold text-gray-500 mb-1">
                    No recorded walks yet
                  </p>
                  <p className="text-sm mb-6">
                    Tap "Record Walk" to start tracking your first walk.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myWalks.map(walk => (
                    <RecordedWalkCard
                      key={walk.id}
                      walk={walk}
                      isOwner
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}