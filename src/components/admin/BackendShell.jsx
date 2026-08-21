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
import { useNarratorApiKeys } from '@/lib/useNarratorApiKeys';
import DisputesManager from './DisputesManager';
import TranslationsManager from './TranslationsManager';
import UpdateAudioTool from './UpdateAudioTool';
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

  // Narr Studio sessions (real narrators, and admins wearing the Narr hat) carry
  // no real Base44 identity of their own — every Walk-related call below has to
  // prove who's asking by sending this along, the same way
  // TranslationsManager.jsx already does for saveTranslation. A real Admin
  // (authMode === 'base44') needs none of this — their Base44 session already
  // speaks for itself server-side.
  const narrAuth = authMode === 'narr' ? { email: user?.email, narrToken: user?.token } : {};

  // Every admin/narrator has their OWN Google TTS AND Groq keys (manageApiKeys is scoped
  // to the caller's own AppUser row — see that function and useNarratorApiKeys.js), never
  // a shared or fallback key, so nobody accidentally burns Enda's quota or a Base44 key.
  // This is a genuine hard lock, not a dismissable reminder: every narrator works across
  // all three tour types (walk/hike, WalkAbout, driving), so there's no "doesn't need a
  // key" case here — both keys are mandatory before anyone can use anything else in the
  // backend. `needsApiKeySetup` stays true until BOTH fields are actually saved; the
  // dialog itself (see ApiKeysDialog's `required` prop) can't be closed by the X button,
  // clicking outside, or Escape while it's true, and its own Save button won't submit
  // unless both fields have something in them. `reloadMyApiKeys` is threaded into the
  // dialog as `onSaved` so a successful save here unlocks the app immediately, with no
  // reload needed — the dialog itself uses a separate hook instance, so without this it
  // wouldn't know a save just happened.
  const { keys: myApiKeys, loadedOk: apiKeysLoadedOk, reload: reloadMyApiKeys } = useNarratorApiKeys();
  const needsApiKeySetup = apiKeysLoadedOk && (!myApiKeys.google_tts_api_key || !myApiKeys.groq_api_key);

  // All Walk reads/writes go through backend functions now, never the direct
  // client SDK — see base44/shared/backendActor.ts for why: a Narr Studio
  // session has no real Base44 auth to check, and some Admins are "promoted"
  // (native Base44 role 'user', app-level AppUser.role 'admin'), so a plain
  // entity-level permission rule can't correctly gate either case. The
  // function is the actual boundary; it decides what this caller is allowed
  // to see/change and does the filtering itself.
  const callWalkFn = async (fnName, payload) => {
    const res = await base44.functions.invoke(fnName, { ...payload, ...narrAuth });
    const data = res?.data || {};
    if (data.error) throw new Error(data.error);
    return data;
  };

  useEffect(() => {
    let cancelled = false;
    callWalkFn('getWalksForBackend', {}).then((data) => {
      if (!cancelled) { setWalks(data.walks || []); setWalksLoading(false); }
    }).catch((err) => {
      console.error('Failed to load walks:', err);
      if (!cancelled) setWalksLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshWalks = async () => {
    setWalksLoading(true);
    try {
      const data = await callWalkFn('getWalksForBackend', {});
      setWalks(data.walks || []);
      toast({ title: 'Tours reloaded', description: `${(data.walks || []).length} tours fetched fresh from the server.` });
    } catch (err) {
      console.error('Failed to refresh walks:', err);
      toast({ variant: 'destructive', title: 'Refresh failed', description: err?.message || 'Could not reload the tour list.' });
    }
    setWalksLoading(false);
  };

  // For a Narrator this only ever succeeds on their own clone, and only for a
  // whitelisted set of fields (narration, audio triggers, segment scripts,
  // finished) — enforced server-side in saveWalkForBackend, not here. For an
  // Admin it's an unrestricted write, same as the old direct entities.Walk
  // call. Either way, whatever `walkData` this screen builds is sent as-is;
  // the function decides what actually gets kept.
  const handleSave = async (walkData) => {
    const { id, ...patch } = walkData;
    const data = await callWalkFn('saveWalkForBackend', { id, patch });
    const saved = data.walk;
    if (id) {
      setWalks((prev) => prev.map(w => w.id === id ? { ...w, ...walkData, ...saved } : w));
    } else {
      setWalks((prev) => [{ ...walkData, ...saved }, ...prev]);
    }
    return saved;
  };

  const handleDelete = async (walkId) => {
    await callWalkFn('deleteWalkForBackend', { id: walkId });
    const data = await callWalkFn('getWalksForBackend', {});
    setWalks(data.walks || []);
  };

  // Admin-only action (WalkAdminList only ever renders this button for
  // isAdmin, and that whole screen is now admin-gated below) — routed through
  // the same save function, which happily does an unrestricted write for an
  // admin actor.
  const handleToggleFree = async (walkId, nextValue) => {
    await callWalkFn('saveWalkForBackend', { id: walkId, patch: { is_sample_walk: nextValue } });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, is_sample_walk: nextValue } : w));
  };

  const handleMarkChecked = async (walkId) => {
    const checkedAt = new Date().toISOString();
    await callWalkFn('saveWalkForBackend', { id: walkId, patch: { announced_at: checkedAt } });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, announced_at: checkedAt } : w));
  };

  // Clone a tour into a private translation copy owned by this Narr. The checks
  // below (one active clone per narrator, target language not already
  // published) are kept here too so the UI can react instantly — but they are
  // no longer the actual gate. cloneWalkForBackend re-derives clone_of /
  // assigned_narrator_email / finished / approved server-side and re-runs both
  // checks itself; a hand-crafted call that skips this client logic still gets
  // rejected there.
  const handleCloneTour = async (original, targetLanguage) => {
    const lang = (targetLanguage || '').trim();
    if (!lang || !original) return null;
    if (!unrestricted && hasActiveClone) {
      toast({ variant: 'destructive', title: 'Finish your current translation first', description: 'You already have a clone in progress. It needs to be finished before you can start another.' });
      return null;
    }
    const alreadyPublished = walks.some(w => w.clone_of === original.id && w.finished && w.approved && (w.target_language || '').toLowerCase() === lang.toLowerCase());
    if (alreadyPublished) {
      toast({ variant: 'destructive', title: 'Already published in this language', description: `“${original.name}” already has a finished, published ${lang} version — cloning it again would duplicate existing work.` });
      return null;
    }
    try {
      const data = await callWalkFn('cloneWalkForBackend', { originalId: original.id, targetLanguage: lang });
      const saved = data.walk;
      setWalks((prev) => [saved, ...prev]);
      toast({ title: 'Clone created', description: `Translating “${original.name}” into ${lang}.` });
      return saved;
    } catch (err) {
      toast({ variant: 'destructive', title: 'Clone failed', description: err?.message || 'Could not create the clone. A tour with this code may already exist.' });
      return null;
    }
  };

  // Ticking "finished" on a clone sends it to admins for review (and back, if unticked).
  // Per Enda: the one-clone-in-progress lock now stays held through this whole step —
  // it only releases once an Admin has actually published the clone (myClones below
  // already excludes approved rows, so it naturally empties out at that point, not
  // this one).
  const handleToggleFinished = async (walkId, finished) => {
    await callWalkFn('saveWalkForBackend', { id: walkId, patch: { finished } });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, finished } : w));
    toast({
      title: finished ? 'Published' : 'Reopened',
      description: finished ? 'Sent to the Admin for final review and the final audio update.' : 'This clone is back in your hands.',
    });
  };

  // The "Publish" button on a clone's row in the Narr Studio list (Clone in
  // Progress) — same underlying action as the "Translation finished" checkbox
  // inside the editor, just a second, more visible entry point for it. This is
  // NOT the Admin's real approve/go-live action (handlePublishClone) — a
  // Narrator hands off to the Admin here, nothing more; going live still needs
  // the Admin's own review and the Update Audio step.
  const handleHandOffClone = (walkId) => handleToggleFinished(walkId, true);

  // Shared by every "about to publish" action below. Per Enda: a tour — a
  // Narrator's clone OR a master tour an Admin builds directly — must NEVER go
  // live while its audio-triggered waypoints still carry the AI-drafted
  // narration; each one has to have gone through the Update Audio tool
  // (final_audio_applied: true) first. This is purely a fail-fast client-side
  // check with a clear message; the real, unbypassable gate is the same check
  // in saveWalkForBackend, which rejects any approved:true save that doesn't
  // satisfy it, no matter where the request comes from.
  const getAudioNotReadyWaypoints = (walkId) => {
    const walk = walks.find(w => w.id === walkId);
    return (walk?.waypoints || []).filter(wp => wp.trigger_audio && !wp.final_audio_applied);
  };

  // Admin publishes a finished translation as its own standalone public tour. Also
  // clears any pushback reason — re-publishing confirms the correction was accepted.
  const handlePublishClone = async (walkId) => {
    const notReady = getAudioNotReadyWaypoints(walkId);
    if (notReady.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Final audio not applied yet',
        description: `${notReady.length} waypoint${notReady.length === 1 ? '' : 's'} still ${notReady.length === 1 ? 'has' : 'have'} the AI draft narration. Use "Update Audio" to replace ${notReady.length === 1 ? 'it' : 'them'} with the final PCV narration before publishing.`,
      });
      return;
    }
    try {
      await callWalkFn('saveWalkForBackend', { id: walkId, patch: { approved: true, finished: true, pushback_reason: '' } });
      setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, approved: true, finished: true, pushback_reason: '' } : w));
      toast({ title: 'Published', description: 'The translation is now a standalone public tour.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Publish failed', description: err?.message || 'Could not publish this tour.' });
    }
  };

  // Publish/Unpublish for a master (non-clone) tour, from WalkEditor's top bar.
  // Unpublishing is always allowed (no audio check needed to hide a tour);
  // publishing runs the same check as handlePublishClone. Returns true only once
  // the save has actually gone through, so WalkEditor doesn't flip its local
  // badge until it's confirmed. Kept as a single toggle (rather than mirroring
  // handlePublishClone's clone-only finished/pushback_reason fields, which have
  // no meaning for a master tour).
  const handleTogglePublish = async (walkId, nextApproved) => {
    if (nextApproved) {
      const notReady = getAudioNotReadyWaypoints(walkId);
      if (notReady.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Final audio not applied yet',
          description: `${notReady.length} waypoint${notReady.length === 1 ? '' : 's'} still ${notReady.length === 1 ? 'has' : 'have'} the AI draft narration. Use "Update Audio" to replace ${notReady.length === 1 ? 'it' : 'them'} with the final PCV narration before publishing.`,
        });
        return false;
      }
    }
    try {
      await callWalkFn('saveWalkForBackend', { id: walkId, patch: { approved: nextApproved } });
      setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, approved: nextApproved } : w));
      toast({
        title: nextApproved ? 'Published' : 'Unpublished',
        description: nextApproved ? 'This tour is now visible to customers.' : 'This tour is now hidden from customers.',
      });
      return true;
    } catch (err) {
      toast({ variant: 'destructive', title: nextApproved ? 'Publish failed' : 'Unpublish failed', description: err?.message || 'Could not update this tour.' });
      return false;
    }
  };

  // Persists a single waypoint's replacement audio (Update Audio tool). Marking
  // final_audio_applied true here is the only place in the whole app allowed to
  // do that — see the reset in DrivingTourWaypointEditor.updateWaypoint, which
  // flips it back to false the moment audio_clip_url changes any other way.
  const handleUpdateWaypointAudio = async (walkId, waypointIndex, newAudioUrl) => {
    const walk = walks.find(w => w.id === walkId);
    if (!walk) throw new Error('Tour not found — try reloading.');
    const updatedWaypoints = (walk.waypoints || []).map((wp, i) =>
      i === waypointIndex ? { ...wp, audio_clip_url: newAudioUrl, final_audio_applied: true } : wp
    );
    await callWalkFn('saveWalkForBackend', { id: walkId, patch: { waypoints: updatedWaypoints } });
    setWalks((prev) => prev.map(w => w.id === walkId ? { ...w, waypoints: updatedWaypoints } : w));
  };

  // Admin sends an already-published translation clone back to its narrator for
  // correction. Unpublishing and un-finishing it here is what naturally re-triggers the
  // existing "one clone in progress" limit — the narrator can't start anything new until
  // this one is fixed, with no separate blocking logic needed for that.
  const handlePushBackClone = async (walkId, reason) => {
    await callWalkFn('saveWalkForBackend', { id: walkId, patch: { approved: false, finished: false, pushback_reason: reason } });
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
  //
  // Per Enda: "Clone in Progress" means exactly that — a clone stays listed here (and
  // keeps blocking a new clone, see hasActiveClone below) for its entire life, right up
  // until an Admin has actually published it. Handing off to the Admin (finished:true,
  // via handleHandOffClone) does NOT clear it — only real approval does, which is
  // exactly what filtering on `!w.approved` gives for free: a clone drops off this list
  // the moment (and only the moment) it goes live.
  const myClones = (unrestricted
    ? walks.filter(w => w.clone_of)
    : walks.filter(w => w.clone_of && (w.assigned_narrator_email || '').toLowerCase() === (user.email || '').toLowerCase())
  ).filter(w => !w.approved);
  // NB: for a real (non-unrestricted) narrator session, `walks` only carries redacted
  // metadata for clones that aren't their own (see getWalksForBackend) — this list is
  // only ever displayed on the Admin side of AdminStartScreen, never the narrator side,
  // so that's fine; don't start rendering it for narrators without revisiting the data
  // this depends on (name/code/assigned_narrator_email aren't present on those rows).
  const reviewClones = walks.filter(w => w.clone_of && w.finished && !w.approved);
  // Same "not yet published" pool the Update Audio tool draws from, but widened
  // to also include a master tour an Admin is building directly (no clone_of, no
  // Narrator involved at all) — those never show up in reviewClones since that
  // list is clone-specific, but they need the exact same audio check before they
  // can go live. isAdmin-gated at the render site below, same as the tool itself.
  const audioUpdateTours = [...reviewClones, ...walks.filter(w => !w.clone_of && w.approved === false)];
  // Only one translation clone may be in progress at a time per narrator — myClones
  // is already scoped to "not yet approved" above, so this now naturally covers the
  // whole lifecycle: still narrating, handed off and awaiting the Admin's review, or
  // handed back with a pushback to fix. The lock only releases once the Admin has
  // actually published it.
  const hasActiveClone = !unrestricted && myClones.length > 0;
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
  const pendingPushback = !unrestricted ? myClones.find(w => w.pushback_reason && !w.finished) : null;

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
            {/* Every admin AND narrator has their own keys to manage — this was previously
                admin-only, which meant a real narrator had no way at all to open this
                dialog, even though the backend (manageApiKeys) always supported them and
                the TTS/Translate panels explicitly tell narrators to "Add your own key
                under API Keys" when one's missing. */}
            <Button variant="ghost" size="sm" onClick={() => setShowApiKeysDialog(true)} className="text-slate-300 hover:text-white gap-2">
              <KeyRound className="w-4 h-4" /> API Keys
            </Button>
            <Link to={createPageUrl('Home')}>
              <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white gap-2">Front End</Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-300 hover:text-white gap-2">
              <LogOut className="w-4 h-4" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <ApiKeysDialog
        open={needsApiKeySetup || showApiKeysDialog}
        onOpenChange={setShowApiKeysDialog}
        required={needsApiKeySetup}
        onSaved={reloadMyApiKeys}
      />

      {!apiKeysLoadedOk ? (
        // Don't know yet whether this person has both keys saved — avoid flashing the
        // real tour list/editor for a moment before potentially locking it right back up.
        <main className="max-w-6xl mx-auto p-4 flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
        </main>
      ) : needsApiKeySetup ? (
        // The dialog above is doing the actual locking (can't be closed while required) —
        // this is just what sits behind it, so there's nothing real to interact with even
        // if the modal's overlay were somehow bypassed.
        <main className="max-w-6xl mx-auto p-4 flex flex-col items-center justify-center py-24 text-center gap-2">
          <KeyRound className="w-8 h-8 text-amber-400" />
          <p className="text-white font-medium">Add your API keys to continue</p>
          <p className="text-slate-400 text-sm max-w-sm">
            Every admin and narrator needs their own Google TTS and Groq keys before using
            any tour tools. Enter both in the dialog above to unlock the rest of this panel.
          </p>
        </main>
      ) : (
      <main className="max-w-6xl mx-auto p-4">
        {editingWalk !== null ? (
          <WalkEditor
            walk={editingWalk}
            onSave={handleSave}
            onCancel={() => { setEditingWalk(null); setFocusWaypointIndex(null); }}
            userRole={userRole}
            focusWaypointIndex={focusWaypointIndex}
            onToggleFinished={handleToggleFinished}
            onTogglePublish={handleTogglePublish}
          />
        ) : view === 'users' ? (
          <UsersManager />
        ) : view === 'dashboard' ? (
          <WalksDashboard walks={walks} />
        ) : view === 'disputes' ? (
          <DisputesManager />
        ) : view === 'translations' ? (
          <TranslationsManager authMode={authMode} user={user} />
        ) : view === 'updateAudio' && isAdmin ? (
          // Admin-only, same defense-in-depth pattern as the 'walks' guard just below —
          // the real boundary is final_audio_applied never being a narrator-settable
          // field in saveWalkForBackend, not this render check.
          <UpdateAudioTool
            tours={audioUpdateTours}
            onReplaceAudio={handleUpdateWaypointAudio}
          />
        ) : view === 'walks' && isAdmin ? (
          // Admin-only, both in the nav (AdminStartScreen never offers this button to a
          // narrator) and here — this guard is the actual UI-level backstop for that;
          // the real boundary is still deleteWalkForBackend/saveWalkForBackend rejecting
          // a narrator actor outright, not this render check.
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
            onUpdateAudio={() => setView('updateAudio')}
            onManageWalks={() => setView('walks')}
            onCloneTour={handleCloneTour}
            onPublishClone={handlePublishClone}
            onHandOffClone={handleHandOffClone}
            cloneableTours={hasActiveClone ? [] : cloneableTours}
            publishedLanguagesByMaster={publishedLanguagesByMaster}
            hasActiveClone={hasActiveClone}
            pendingPushbackId={pendingPushback?.id || null}
            myClones={myClones}
            reviewClones={reviewClones}
          />
        )}
      </main>
      )}
    </div>
  );
}