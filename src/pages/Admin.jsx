import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, ShieldCheck, ArrowLeft, Mic, KeyRound } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';
import WalkEditor from '../components/admin/WalkEditor';
import WalkAdminList from '../components/admin/WalkAdminList';
import WalksDashboard from '../components/admin/WalksDashboard';
import AdminStartScreen from '../components/admin/AdminStartScreen';
import UsersManager from '../components/admin/UsersManager';
import ApiKeysDialog from '../components/admin/ApiKeysDialog';
import { getRouteTypeForCategory } from '@/lib/tourCategories';
import { useAuth } from '@/lib/AuthContext';
import Login from './Login';

export default function Admin() {
  const { user: authUser, isAuthenticated, isLoadingAuth, logout } = useAuth();
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingWalk, setEditingWalk] = useState(null);
  const [view, setView] = useState('start');
  const [focusWaypointIndex, setFocusWaypointIndex] = useState(null);
  const [showApiKeysDialog, setShowApiKeysDialog] = useState(false);
  const [walks, setWalks] = useState([]);
  const [walksLoading, setWalksLoading] = useState(true);

  useEffect(() => {
    const resolveRole = async () => {
      // Staff (admins/narrators) sign in through the same custom WordPress login
      // the rest of the app uses — NOT Base44 platform auth. Gate on the WordPress
      // session from AuthContext, then look up the staff role by email.
      if (isLoadingAuth) return;
      if (!isAuthenticated || !authUser?.email) {
        setIsLoading(false); // not signed in → render the custom Login below
        return;
      }
      try {
        const appUsers = await base44.entities.AppUser.filter({ email: authUser.email });
        if (appUsers.length > 0 && (appUsers[0].role === 'admin' || appUsers[0].role === 'narrator')) {
          setUser(authUser);
          setUserRole(appUsers[0].role);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error('Staff role lookup error:', err);
      }
      // Authenticated WordPress user without a staff role → send to the front end.
      window.location.href = createPageUrl('Home');
    };
    resolveRole();
  }, [isLoadingAuth, isAuthenticated, authUser]);

  // Load the walks list once. Every action below (save, delete, mark-checked) updates this local
  // state directly and only in response to that specific action's own confirmed result — nothing
  // reacts to background events from elsewhere, which removes any risk of a delayed or unrelated
  // event changing what's on screen.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    base44.entities.Walk.list('-created_date').then((initial) => {
      if (!cancelled) {
        setWalks(initial || []);
        setWalksLoading(false);
      }
    }).catch((err) => {
      console.error('Failed to load walks:', err);
      if (!cancelled) setWalksLoading(false);
    });
    return () => { cancelled = true; };
  }, [user]);

  const refreshWalks = async () => {
    setWalksLoading(true);
    try {
      const fresh = await base44.entities.Walk.list('-created_date');
      setWalks(fresh || []);
    } catch (err) {
      console.error('Failed to refresh walks:', err);
    }
    setWalksLoading(false);
  };

  const handleSave = async (walkData) => {
    let saved;
    if (walkData.id) {
      saved = await base44.entities.Walk.update(walkData.id, walkData);
      setWalks((prev) => prev.map(w => w.id === walkData.id ? { ...w, ...walkData, ...saved } : w));
    } else {
      saved = await base44.entities.Walk.create(walkData);
      setWalks((prev) => [{ ...walkData, ...saved }, ...prev]);
    }
    // Deliberately does NOT close the editor or reset focus here — Save persists changes and keeps
    // the admin/narrator working; only clicking Back actually leaves the editing screen.
    return saved;
  };

  const handleDelete = async (walkId) => {
    const result = await base44.entities.Walk.delete(walkId);
    if (result && result.success === false) {
      throw new Error('The server did not confirm this delete.');
    }
    // Re-fetch the real list from the server rather than just removing this walk from what's
    // on screen — that way what the admin sees right after deleting is what the server actually
    // has, not a guess that could be wrong if the delete takes a moment to fully land.
    const fresh = await base44.entities.Walk.list('-created_date');
    setWalks(fresh || []);
  };

  const handleToggleFree = async (walkId, nextValue) => {
    await base44.entities.Walk.update(walkId, { is_sample_walk: nextValue });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, is_sample_walk: nextValue } : w));
  };

  const handleMarkChecked = async (walkId) => {
    const checkedAt = new Date().toISOString();
    await base44.entities.Walk.update(walkId, { announced_at: checkedAt });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, announced_at: checkedAt } : w));
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (isLoading || !user || !userRole) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
      </div>
    );
  }

  const showBackToStart = editingWalk !== null || view !== 'start';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="bg-slate-900 border-b border-slate-700 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${userRole === 'admin' ? 'bg-amber-500' : 'bg-purple-500'}`}>
              {userRole === 'admin' ? <ShieldCheck className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
            </div>
            <div>
              <h1 className="font-bold text-white">
                {userRole === 'admin' ? 'Admin Panel' : 'Narration Studio'}
              </h1>
              <p className="text-xs text-slate-400">
                {user?.full_name || user?.email} · {userRole}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showBackToStart && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setEditingWalk(null); setView('start'); }}
                className="text-slate-300 hover:text-white gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Start
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowApiKeysDialog(true)}
              className="text-slate-300 hover:text-white gap-2"
            >
              <KeyRound className="w-4 h-4" /> API Keys
            </Button>
            <Link to={createPageUrl('Home')}>
              <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white gap-2">
                Front End
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => logout()} className="text-slate-300 hover:text-white gap-2">
              <LogOut className="w-4 h-4" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <ApiKeysDialog open={showApiKeysDialog} onOpenChange={setShowApiKeysDialog} />

      <main className="max-w-6xl mx-auto p-4">
        {editingWalk !== null ? (
          <WalkEditor
            walk={editingWalk}
            onSave={handleSave}
            onCancel={() => { setEditingWalk(null); setFocusWaypointIndex(null); }}
            userRole={userRole}
            focusWaypointIndex={focusWaypointIndex}
          />
        ) : view === 'users' ? (
          <UsersManager />
        ) : view === 'dashboard' ? (
          <WalksDashboard walks={walks} />
        ) : view === 'walks' ? (
          <WalkAdminList
            walks={walks}
            isLoading={walksLoading}
            userRole={userRole}
            onEdit={(walk) => setEditingWalk(walk)}
            onDelete={handleDelete}
            onMarkChecked={handleMarkChecked}
            onToggleFree={handleToggleFree}
            onRefresh={refreshWalks}
          />
        ) : (
          <AdminStartScreen
            userRole={userRole}
            walks={walks}
            onNewTour={(categoryCode) => setEditingWalk({ tour_category: categoryCode, route_type: getRouteTypeForCategory(categoryCode) })}
            onContinueTour={(walk, wpIndex) => { setEditingWalk(walk); setFocusWaypointIndex(wpIndex ?? null); }}
            onManageUsers={() => setView('users')}
            onDashboard={() => setView('dashboard')}
            onManageWalks={() => setView('walks')}
          />
        )}
      </main>
    </div>
  );
}