import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, ShieldCheck, ArrowLeft, Mic } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';
import WalkEditor from '../components/admin/WalkEditor';
import WalkAdminList from '../components/admin/WalkAdminList';
import WalksDashboard from '../components/admin/WalksDashboard';
import AdminStartScreen from '../components/admin/AdminStartScreen';
import UsersManager from '../components/admin/UsersManager';
import { getRouteTypeForCategory } from '@/lib/tourCategories';

export default function Admin() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingWalk, setEditingWalk] = useState(null);
  const [view, setView] = useState('start');
  const [focusWaypointIndex, setFocusWaypointIndex] = useState(null);
  const [walks, setWalks] = useState([]);
  const [walksLoading, setWalksLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isAuth = await base44.auth.isAuthenticated();
        if (!isAuth) { base44.auth.redirectToLogin(window.location.href); return; }

        const userData = await base44.auth.me();

        let role = null;
        if (userData.role === 'admin') {
          role = 'admin';
        } else {
          const appUsers = await base44.entities.AppUser.filter({ user_id: userData.id });
          if (appUsers.length > 0 && (appUsers[0].role === 'narrator' || appUsers[0].role === 'admin')) {
            role = appUsers[0].role;
          }
        }

        if (!role) {
          window.location.href = createPageUrl('Home');
          return;
        }

        setUser(userData);
        setUserRole(role);
      } catch (error) {
        console.error('Auth check error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  // The walks list is driven entirely by the server: one initial fetch to populate it, then a
  // live subscription that applies every create/update/delete the moment the server confirms it
  // actually happened. Nothing here is guessed or assumed locally — if it's on screen, the server
  // said so.
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

    const unsubscribe = base44.entities.Walk.subscribe((event) => {
      setWalks((prev) => {
        if (event.type === 'delete') {
          return prev.filter(w => w.id !== event.id);
        }
        if (event.type === 'create') {
          if (prev.some(w => w.id === event.id)) return prev; // already have it, avoid a duplicate
          return [event.data, ...prev];
        }
        if (event.type === 'update') {
          return prev.map(w => w.id === event.id ? { ...w, ...event.data } : w);
        }
        return prev;
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  const handleSave = async (walkData) => {
    let saved;
    if (walkData.id) {
      saved = await base44.entities.Walk.update(walkData.id, walkData);
    } else {
      saved = await base44.entities.Walk.create(walkData);
    }
    // No manual list update here — the subscription above applies it the moment the server
    // confirms the write, so what's on screen always matches what the server actually did.
    // Deliberately does NOT close the editor or reset focus here — Save persists changes and keeps
    // the admin/narrator working; only clicking Back actually leaves the editing screen.
    return saved;
  };

  const handleDelete = async (walkId) => {
    const result = await base44.entities.Walk.delete(walkId);
    if (result && result.success === false) {
      throw new Error('The server did not confirm this delete.');
    }
    // No manual list update here either — same reasoning as handleSave.
  };

  const handleMarkChecked = async (walkId) => {
    const checkedAt = new Date().toISOString();
    await base44.entities.Walk.update(walkId, { announced_at: checkedAt });
  };

  if (isLoading) {
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
            <Link to={createPageUrl('Home')}>
              <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white gap-2">
                Front End
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => base44.auth.logout()} className="text-slate-300 hover:text-white gap-2">
              <LogOut className="w-4 h-4" /> Logout
            </Button>
          </div>
        </div>
      </header>

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