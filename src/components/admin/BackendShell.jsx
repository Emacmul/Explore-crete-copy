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
import DisputesManager from './DisputesManager';
import TranslationsManager from './TranslationsManager';
import { getRouteTypeForCategory, defaultPriceForCategory } from '@/lib/tourCategories';
import { toast } from '@/components/ui/use-toast';

/**
 * Shared back-end shell used by both the Admin route (Base44 sign-in) and the
 * Narr route (custom Narr password). The only differences are the role and the
 * logout handler — passed in as props. Everything below (tour list, editor,
 * save/delete, clone workflow) is identical so narrators get the full editing
 * toolset; the role just gates which start-screen sections and tools appear.
 */
export default function BackendShell({ user, userRole, authMode, unrestricted, onLogout }) {
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
      toast({ title: 'Tours reloaded', description: `${(fresh || []).length} tours fetched fresh from the server.` });
    } catch (err) {
      console.error('Failed to refresh walks:', err);
      toast({ variant: 'destructive', title: 'Refresh failed', description: err?.message || 'Could not reload the tour list.' });
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

  // Clone a tour into a private translation copy owned by this Narr. Masters are offered
  // for cloning regardless of their own publish status (a narrator can translate a tour
  // that isn't live yet) — what's actually restricted is the TARGET LANGUAGE: never clone
  // into a language that already has a finished, published version of this same tour.
  const handleCloneTour = async (original, targetLanguage) => {
    const lang = (targetLanguage || '').trim();
    if (!lang || !original) return null;
    // Enforced here too, not just by hiding the "Clone a tour" section in the UI — a
    // narrator (not an unrestricted admin) may only have one translation in progress at
    // a time. This must block the actual clone action, not just the button that starts it.
    if (!unrestricted && hasActiveClone) {
      toast({ variant: 'destructive', title: 'Finish your current translation first', description: 'You already have a clone in progress. It needs to be finished and published before you can start another.' });
      return null;
    }
    // Never allow cloning into a language this tour already has a published version in —
    // checked here too, not just filtered out of the language picker, so this can't be
    // bypassed even if the dialog's own filtering is ever stale or skipped.
    const alreadyPublished = walks.some(w => w.clone_of === original.id && w.finished && w.approved && (w.target_language || '').toLowerCase() === lang.toLowerCase());
    if (alreadyPublished) {
      toast({ variant: 'destructive', title: 'Already published in this language', description: `“${original.name}” already has a finished, published ${lang} version — cloning it again would duplicate existing work.` });
      return null;
    }
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

  // Admin publishes a finished translation as its own standalone public tour. Also
  // clears any pushback reason — re-publishing confirms the correction was accepted.
  const handlePublishClone = async (walkId) => {
    await base44.entities.Walk.update(walkId, { approved: true, finished: true, pushback_reason: '' });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, approved: true, finished: true, pushback_reason: '' } : w));
    toast({ title: 'Published', description: 'The translation is now a standalone public tour.' });
  };

  // Admin sends an already-published translation clone back to its narrator for
  // correction. Unpublishing and un-finishing it here is what naturally re-triggers the
  // existing "one clone in progress" limit — the narrator can't start anything new until
  // this one is fixed and re-published, with no separate blocking logic needed for that.
  const handlePushBackClone = async (walkId, reason) => {
    await base44.entities.Walk.update(walkId, { approved: false, finished: false, pushback_reason: reason });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, approved: false, finished: false, pushback_reason: reason } : w));
    toast({ title: 'Sent back for correction', description: 'The narrator will see this the next time they open the Narr Studio.' });
  };

  // Every master is offered for cloning regardless of its OWN publish status — a
  // narrator can translate a tour that isn't published yet. Nothing here restricts by
  // whether the English master is approved; the restriction lives entirely on the
  // target-language side, handled in handleCloneTour and passed to CloneTourDialog.
  const cloneableTours = walks.filter(w => !w.clone_of);
  // For each master, the set of languages that already have a finished, published clone
  // — passed to the clone dialog so it can't even be selected there, not just blocked
  // after the fact.
  const publishedLanguagesByMaster = {};
  for (const w of walks) {
    if (w.clone_of && w.finished && w.approved && w.target_language) {
      (publishedLanguagesByMaster[w.clone_of] ||= new Set()).add(w.target_language.toLowerCase());
    }
  }
  // An unrestricted (admin-wearing-Narr-hat) user sees every translation clone, not just
  // their own — and can publish any of them directly (see AdminStartScreen).
  const myClones = unrestricted
    ? walks.filter(w => w.clone_of)
    : walks.filter(w => w.clone_of && (w.assigned_narrator_email || '').toLowerCase() === (user.email || '').toLowerCase());
  // A narrator's own view of "my clones" only shows active, unpublished work — once a
  // clone is finished AND published, it's no longer theirs to manage; it's a live tour.
  // (An unrestricted admin-as-narrator still sees everything, published or not, since
  // they're the one doing the reviewing/publishing.)
  const myActiveClones = unrestricted ? myClones : myClones.filter(w => !(w.finished && w.approved));
  const reviewClones = walks.filter(w => w.clone_of && w.finished && !w.approved);
  // Only one translation clone may be in progress at a time per narrator — once their
  // current clone is finished AND published, they can start another, not before.
  const hasActiveClone = !unrestricted && myActiveClones.length > 0;
  // A pushback jumps the queue: it's an already-published, already-live tour with a known
  // error in it, unlike an ordinary in-progress translation nobody's seen yet. If a
  // narrator has one pending, it must take priority over whatever else they were working
  // on — they get blocked from opening anything else until the pushback is fixed.
  // A pushback jumps the queue: it's an already-published, already-live tour with a known
  // error in it, unlike an ordinary in-progress translation nobody's seen yet. If a
  // narrator has one pending, it must take priority over whatever else they were working
  // on — they get blocked from opening anything else until the pushback is fixed.
  // Critically, "fixed" means the narrator's own part is done — once they've corrected it
  // and marked it finished (sent back for review), the lock releases immediately. It does
  // NOT wait for the admin to actually re-review and re-publish; `pushback_reason` itself
  // stays set until then (so the row still shows what was wrong), but that's an admin-side
  // detail — the narrator shouldn't be stuck unable to touch anything else just because
  // the admin hasn't reviewed their fix yet.
  const pendingPushback = !unrestricted ? myActiveClones.find(w => w.pushback_reason && !w.finished) : null;

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
              <p className="text-xs text-slate-400">{user?.full_name || user?.email} · {isAdmin ? 'admin' : 'Narr'}{unrestricted ? ' · Admin access' : ''}</p>
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
        ) : view === 'disputes' ? (
          <DisputesManager />
        ) : view === 'translations' ? (
          <TranslationsManager authMode={authMode} user={user} />
        ) : view === 'walks' ? (
          <WalkAdminList
            walks={walks}
            isLoading={walksLoading}
            userRole={userRole}
            onEdit={(walk) => setEditingWalk(walk)}
            onDelete={handleDelete}
            onMarkChecked={handleMarkChecked}
            onToggleFree={handleToggleFree}
            onPushBack={handlePushBackClone}
            onRefresh={refreshWalks}
          />
        ) : (
          <AdminStartScreen
            userRole={userRole}
            unrestricted={unrestricted}
            user={user}
            works={walks}
            onNewTour={(categoryCode) => setEditingWalk({
              tour_category: categoryCode,
              route_type: getRouteTypeForCategory(categoryCode),
              // The category is already chosen here, before the editor opens — so the
              // editor's dropdown change-handler never fires. Seed the category default
              // price now (€12.50 WHT / €24.99 WBT & DDV, VAT included) so a brand-new
              // Walkabout or Driving Tour doesn't silently fall back to the €12.50
              // Walk/Hike baseline and launch at half price.
              price_eur: defaultPriceForCategory(categoryCode),
            })}
            onContinueTour={(walk, wpIndex) => {
              // Defense in depth: narrators must only ever open a clone, never the master
              // copy — enforced here even though the current UI never actually offers a
              // narrator a button that would call this with a master walk, since that
              // absence isn't the same as a real guard against it.
              if (userRole === 'narrator' && !unrestricted && !walk.clone_of) {
                toast({ variant: 'destructive', title: 'Not allowed', description: 'Narrators can only work on a cloned translation, never the master tour directly.' });
                return;
              }
              // A pending pushback takes priority over anything else — it's a live,
              // already-published tour with a known error, so it can't wait behind
              // whatever else the narrator happens to be mid-way through.
              if (pendingPushback && walk.id !== pendingPushback.id) {
                toast({ variant: 'destructive', title: 'Fix your pushed-back translation first', description: `“${pendingPushback.name}” was already published and needs an urgent correction — it takes priority over everything else until it's fixed and re-published.` });
                return;
              }
              setEditingWalk(walk);
              setFocusWaypointIndex(wpIndex ?? null);
            }}
            onManageUsers={() => setView('users')}
            onDashboard={() => setView('dashboard')}
            onManageDisputes={() => setView('disputes')}
            onManageTranslations={() => setView('translations')}
            onManageWalks={() => setView('walks')}
            onCloneTour={handleCloneTour}
            onPublishClone={handlePublishClone}
            cloneableTours={hasActiveClone ? [] : cloneableTours}
            publishedLanguagesByMaster={publishedLanguagesByMaster}
            hasActiveClone={hasActiveClone}
            pendingPushbackId={pendingPushback?.id || null}
            myClones={unrestricted ? myClones : myActiveClones}
            reviewClones={reviewClones}
          />
        )}
      </main>
    </div>
  );
}