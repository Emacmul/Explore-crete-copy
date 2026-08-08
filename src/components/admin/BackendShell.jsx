import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, ShieldCheck, ArrowLeft, Mic, KeyRound } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';
import WalkEditor from './WalkEditor';
import WalkAdminList from './WalkAdminList';
import WalksDashboard from './WalksDashboard';
import AdminStartScreen from './AdminStartScreen';
import UsersManager from './UsersManager';
import ApiKeysDialog from './ApiKeysDialog';
import { getRouteTypeForCategory } from '@/lib/tourCategories';
import { toast } from '@/components/ui/use-toast';

/**
 * Shared back-end shell used by both the Admin route (Base44 sign-in) and the
 * Narr route (custom Narr password). The only differences are the role and the
 * logout handler — passed in as props. Everything below (tour list, editor,
 * save/delete, clone workflow) is identical so narrators get the full editing
 * toolset; the role just gates which start-screen sections and tools appear.
 */
export default function BackendShell({ user, userRole, authMode, onLogout }) {
  const [editingWalk, setEditingWalk] = useState(null);
  const [view, setView] = useState('start');
  const [focusWaypointIndex, setFocusWaypointIndex] = useState(null);
  const [showApiKeysDialog, setShowApiKeysDialog] = useState(false);
  const [walks, setWalks] = useState([]);
  const [walksLoading, setWalksLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    base44.entities.Walk.list('-created_date').then((initial) => {
      if (!cancelled) { setWalks(initial || []); setWalksLoading(false); }
    }).catch((err) => {
      console.error('Failed to load walks:', err);
      if (!cancelled) setWalksLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const refreshWalks = async () => {
    setWalksLoading(true);
    try {
      const fresh = await base44.entities.Walk.list('-created_date');
      setWalks(fresh || []);
    } catch (err) { console.error('Failed to refresh walks:', err); }
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
    return saved;
  };

  const handleDelete = async (walkId) => {
    const result = await base44.entities.Walk.delete(walkId);
    if (result && result.success === false) throw new Error('The server did not confirm this delete.');
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

  // Clone an approved tour into a private translation copy owned by this Narr.
  const handleCloneTour = async (original, targetLanguage) => {
    const lang = (targetLanguage || '').trim();
    if (!lang || !original) return null;
    const clone = {
      ...original,
      id: undefined,
      created_date: undefined,
      updated_date: undefined,
      created_by_id: undefined,
      code: `${original.code}-${lang}`,
      name: `${original.name} (${lang})`,
      clone_of: original.id,
      target_language: lang,
      assigned_narrator_email: (user.email || '').toLowerCase(),
      finished: false,
      approved: false,
      requires_review: false,
      is_sample_walk: false,
      creem_product_id: undefined,
      trail_path: (original.trail_path || []).map(p => ({ ...p })),
      waypoints: (original.waypoints || []).map(w => ({ ...w })),
      segment_scripts: (original.segment_scripts || []).map(s => ({ ...s })),
    };
    try {
      const saved = await base44.entities.Walk.create(clone);
      setWalks((prev) => [saved, ...prev]);
      toast({ title: 'Clone created', description: `Translating “${original.name}” into ${lang}.` });
      return saved;
    } catch (err) {
      toast({ variant: 'destructive', title: 'Clone failed', description: err?.message || 'Could not create the clone. A tour with this code may already exist.' });
      return null;
    }
  };

  // Ticking "finished" on a clone sends it to admins for review (and back, if unticked).
  const handleToggleFinished = async (walkId, finished) => {
    await base44.entities.Walk.update(walkId, { finished });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, finished } : w));
    toast({
      title: finished ? 'Sent for review' : 'Reopened',
      description: finished ? 'Admins can now see this translation.' : 'This clone is back in your hands.',
    });
  };

  // Admin publishes a finished translation as its own standalone public tour.
  const handlePublishClone = async (walkId) => {
    await base44.entities.Walk.update(walkId, { approved: true, finished: true });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, approved: true, finished: true } : w));
    toast({ title: 'Published', description: 'The translation is now a standalone public tour.' });
  };

  const cloneableTours = walks.filter(w => w.approved && !w.clone_of);
  const myClones = walks.filter(w => w.clone_of && (w.assigned_narrator_email || '').toLowerCase() === (user.email || '').toLowerCase());
  const reviewClones = walks.filter(w => w.clone_of && w.finished && !w.approved);

  const isAdmin = userRole === 'admin';
  const showBackToStart = editingWalk !== null || view !== 'start';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="bg-slate-900 border-b border-slate-700 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isAdmin ? 'bg-amber-500' : 'bg-purple-500'}`}>
              {isAdmin ? <ShieldCheck className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
            </div>
            <div>
              <h1 className="font-bold text-white">{isAdmin ? 'Admin Panel' : 'Narr Studio'}</h1>
              <p className="text-xs text-slate-400">{user?.full_name || user?.email} · {isAdmin ? 'admin' : 'Narr'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showBackToStart && (
              <Button variant="ghost" size="sm" onClick={() => { setEditingWalk(null); setView('start'); }} className="text-slate-300 hover:text-white gap-2">
                <ArrowLeft className="w-4 h-4" /> Start
              </Button>
            )}
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => setShowApiKeysDialog(true)} className="text-slate-300 hover:text-white gap-2">
                <KeyRound className="w-4 h-4" /> API Keys
              </Button>
            )}
            <Link to={createPageUrl('Home')}>
              <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white gap-2">Front End</Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-300 hover:text-white gap-2">
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
            onToggleFinished={handleToggleFinished}
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
            user={user}
            works={walks}
            onNewTour={(categoryCode) => setEditingWalk({ tour_category: categoryCode, route_type: getRouteTypeForCategory(categoryCode) })}
            onContinueTour={(walk, wpIndex) => { setEditingWalk(walk); setFocusWaypointIndex(wpIndex ?? null); }}
            onManageUsers={() => setView('users')}
            onDashboard={() => setView('dashboard')}
            onManageWalks={() => setView('walks')}
            onCloneTour={handleCloneTour}
            onPublishClone={handlePublishClone}
            cloneableTours={cloneableTours}
            myClones={myClones}
            reviewClones={reviewClones}
          />
        )}
      </main>
    </div>
  );
}