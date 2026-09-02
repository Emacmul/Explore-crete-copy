import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import {
  Footprints, MapPin, Car, ChevronRight, ShieldCheck, Mic,
  LayoutDashboard, List, Users, Plus, AlertCircle, Volume2,
  Languages, CheckCircle2, Send, AlertTriangle, AudioLines, Trash2, Loader2,
} from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/use-toast';
import { TOUR_CATEGORIES } from '@/lib/tourCategories';
import CloneTourDialog from './CloneTourDialog';

const CATEGORY_ICONS = { Footprints, MapPin, Car };

function hasMissingAudio(walk) {
  if (walk.route_type !== 'driving_audio_tour') return false;
  return (walk.waypoints || []).some(wp => wp.trigger_audio && !wp.audio_clip_url);
}

function getMissingAudioWaypoints(walk) {
  return (walk.waypoints || [])
    .map((wp, index) => ({ wp, index }))
    .filter(({ wp }) => wp.trigger_audio && !wp.audio_clip_url);
}

function MissingAudioTourCard({ walk, onJumpToWaypoint }) {
  const missingWps = getMissingAudioWaypoints(walk);
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-700">
        <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
        <span className="font-mono text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded font-bold shrink-0">{walk.tour_category || 'WHT'}</span>
        <p className="font-medium text-white truncate flex-1">{walk.name}</p>
        <span className="text-xs text-amber-400 flex items-center gap-1 shrink-0"><Volume2 className="w-3 h-3" /> {missingWps.length} audio missing</span>
      </div>
      <div className="p-3 space-y-1">
        <p className="text-xs text-slate-500 mb-2">Audio for the following points is missing — click a point to upload its MP3:</p>
        {missingWps.map(({ wp, index }) => {
          const displayName = wp.segment_id || wp.name || `Point ${index + 1}`;
          const subtitle = wp.segment_title && wp.segment_title !== wp.name ? wp.segment_title : (wp.name && wp.name !== displayName ? wp.name : null);
          return (
            <button key={index} onClick={() => onJumpToWaypoint(walk, index)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/40 hover:bg-slate-700/80 transition-colors text-left group">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-300 group-hover:text-white truncate block">{displayName}</span>
                {subtitle && <span className="text-xs text-slate-500 truncate block">{subtitle}</span>}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-amber-400 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CloneableTourRow({ walk, onClone }) {
  return (
    <button onClick={() => onClone(walk)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-slate-700/60 transition-colors text-left group">
      <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
      <span className="font-mono text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded font-bold shrink-0">{walk.tour_category || 'WHT'}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate">{walk.name}</p>
        <p className="text-xs text-slate-500">{walk.region || ''}{walk.target_language ? ` · ${walk.target_language}` : ''}</p>
      </div>
      <span className="flex items-center gap-1 text-xs text-purple-300 bg-purple-900/40 border border-purple-700/50 px-2.5 py-1 rounded shrink-0 group-hover:bg-purple-800/60 transition-colors">
        <Languages className="w-3.5 h-3.5" /> Clone
      </span>
    </button>
  );
}

// "Completion" for a Narrator's own hand-off is the same per-waypoint "Done"
// tick box built for the Admin/Narrator Waypoints tab (DrivingTourWaypointEditor)
// — every waypoint on the tour marked done. Only driving-audio tours (DDV/WBT)
// have that concept at all; a plain Walk/Hike clone (WaypointEditor.jsx) has no
// per-waypoint narration to finish, so there's nothing to gate there.
function isReadyToHandOff(walk) {
  if (walk.route_type !== 'driving_audio_tour') return true;
  const wps = walk.waypoints || [];
  return wps.length > 0 && wps.every(wp => wp.waypoint_done);
}

function MyCloneRow({ walk, onContinue, onPublish, onHandOff, onRequestDelete, unrestricted, locked }) {
  const readyToHandOff = isReadyToHandOff(walk);
  return (
    <div className={`w-full bg-slate-800 border rounded-xl px-4 py-3 ${walk.pushback_reason ? 'border-red-600/60' : locked ? 'border-slate-800 opacity-50' : 'border-slate-700'}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => !locked && onContinue(walk)}
          disabled={locked}
          className={`flex items-center gap-3 flex-1 min-w-0 text-left group ${locked ? 'cursor-not-allowed' : ''}`}
        >
          <span className="font-mono text-xs bg-slate-700 text-purple-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
          <Badge className="text-xs bg-purple-900 text-purple-300 border-purple-700 shrink-0">{walk.target_language}</Badge>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-white truncate">{walk.name}</p>
            {unrestricted && walk.assigned_narrator_email && (
              <p className="text-xs text-slate-500 truncate">By {walk.assigned_narrator_email}</p>
            )}
          </div>
        </button>
        {/* Per Enda: if something goes badly wrong on a translation — a bad mistake, or
            anything else that means starting over is easier than fixing it in place —
            there needs to be a way to abandon this clone entirely, not just keep editing
            it. Deleting it also frees the master tour up to be cloned again (see the
            "clone once" limit elsewhere), since that limit only ever looks at clones that
            still exist. Available regardless of `locked` — abandoning a blocked clone is
            a valid way to deal with it, same as fixing it would be. */}
        {onRequestDelete && (
          <button
            onClick={() => onRequestDelete(walk)}
            title="Delete this clone and start over"
            className="shrink-0 p-1.5 text-slate-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        {/* A live "Publish" Button can't sit inside the <button> above (invalid nested
            buttons), so the whole status ladder lives here instead, as a sibling —
            still visually on the same row. */}
        {walk.pushback_reason && walk.finished ? (
          <span className="flex items-center gap-1 text-xs text-emerald-300 bg-emerald-900/40 border border-emerald-700/50 px-2 py-1 rounded shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" /> Correction sent for review
          </span>
        ) : walk.pushback_reason ? (
          <span className="flex items-center gap-1 text-xs text-red-300 bg-red-900/40 border border-red-700/50 px-2 py-1 rounded shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" /> Needs correction
          </span>
        ) : locked ? (
          <span className="text-xs text-slate-500 shrink-0">On hold — urgent fix pending</span>
        ) : walk.finished ? (
          <span className="flex items-center gap-1 text-xs text-emerald-300 bg-emerald-900/40 border border-emerald-700/50 px-2 py-1 rounded shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" /> Published
          </span>
        ) : readyToHandOff && onHandOff ? (
          <Button
            size="sm"
            onClick={() => onHandOff(walk.id)}
            className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 shrink-0"
            title="Send this tour to the Admin — every waypoint is marked done."
          >
            <Send className="w-3.5 h-3.5" /> Publish
          </Button>
        ) : (
          <span className="text-xs text-amber-300 shrink-0">In progress</span>
        )}
        {!locked && (
          <button onClick={() => onContinue(walk)} className="shrink-0 text-slate-500 hover:text-purple-400 transition-colors p-0.5" title="Open">
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
      {walk.pushback_reason && (
        <div className="mt-2 pt-2 border-t border-red-900/40 flex items-start gap-2 text-sm text-red-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
          <p><span className="font-medium">Admin feedback:</span> {walk.pushback_reason}</p>
        </div>
      )}
      {unrestricted && !walk.approved && onPublish && (
        <div className="mt-2 pt-2 border-t border-slate-700 flex justify-end">
          <Button size="sm" onClick={() => onPublish(walk.id)} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
            <Send className="w-4 h-4" /> Publish
          </Button>
        </div>
      )}
    </div>
  );
}

function ReviewCloneRow({ walk, onReview, onPublish }) {
  return (
    <div className="bg-slate-800 border border-amber-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="font-mono text-xs bg-slate-700 text-amber-300 px-2 py-1 rounded font-bold shrink-0">{walk.code}</span>
      <Badge className="text-xs bg-purple-900 text-purple-300 border-purple-700 shrink-0">{walk.target_language}</Badge>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate">{walk.name}</p>
        <p className="text-xs text-slate-500">By {walk.assigned_narrator_email}</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onReview(walk)} className="border-slate-600 text-slate-200 hover:bg-slate-700 gap-2">
        <ChevronRight className="w-4 h-4" /> Review
      </Button>
      <Button size="sm" onClick={() => onPublish(walk.id)} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
        <Send className="w-4 h-4" /> Publish
      </Button>
    </div>
  );
}

export default function AdminStartScreen({
  userRole, user, works, onNewTour, onContinueTour, onManageUsers, onDashboard, onManageWalks,
  onCloneTour, onPublishClone, onHandOffClone, onDeleteClone, cloneableTours = [], myClones = [], reviewClones = [],
  hasActiveClone = false,
  pendingPushbackId = null,
  publishedLanguagesByMaster = {},
  onManageDisputes,
  onManageTranslations,
  onUpdateAudio,
  unrestricted = false,
}) {
  const isNarrator = userRole === 'narrator';
  const [cloneTarget, setCloneTarget] = useState(null);
  // "Delete this clone" confirmation — holds the walk object being considered for
  // deletion, same pattern WalkAdminList.jsx already uses for deleting a whole tour.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeletingClone, setIsDeletingClone] = useState(false);

  const confirmDeleteClone = async () => {
    if (!deleteTarget) return;
    setIsDeletingClone(true);
    try {
      await onDeleteClone(deleteTarget.id);
      toast({ title: 'Clone deleted', description: `“${deleteTarget.name}” has been removed. You can clone that tour again whenever you're ready.` });
      setDeleteTarget(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Delete failed — nothing was removed', description: e?.message || 'An unexpected error occurred while deleting. Please try again.' });
    }
    setIsDeletingClone(false);
  };

  // ----- Narrator view: clone a tour + my clones -----
  if (isNarrator) {
    const sortedCloneable = [...cloneableTours].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return (
      <div className="space-y-8 max-w-3xl mx-auto">
        <CloneTourDialog
          open={!!cloneTarget}
          tour={cloneTarget}
          excludedLanguages={cloneTarget ? (publishedLanguagesByMaster[cloneTarget.id] || new Set()) : new Set()}
          onClose={() => setCloneTarget(null)}
          onConfirm={async (lang) => {
            const saved = await onCloneTour(cloneTarget, lang);
            setCloneTarget(null);
            if (saved) onContinueTour(saved);
          }}
        />

        <button onClick={onManageTranslations} className="w-full bg-purple-700 hover:bg-purple-800 text-white rounded-xl p-4 shadow-lg flex items-center gap-3 transition-all hover:scale-[1.01] active:scale-[0.99] text-left">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shrink-0"><Languages className="w-5 h-5" /></div>
          <div className="flex-1 min-w-0">
            <p className="font-bold">Correct UI translations</p>
            <p className="text-sm text-white/80 mt-0.5">Fix unnatural Dutch, Czech, etc. — overrides go live for everyone</p>
          </div>
        </button>

        <div>
          <h2 className="text-lg font-bold text-white mb-1">Clone a tour to translate</h2>
          <p className="text-sm text-slate-400 mb-3">Pick an existing tour, then choose the language you're translating into. The clone is private to you until you mark it finished.</p>
          {hasActiveClone ? (
            <div className="text-center py-8 text-amber-300 border border-dashed border-amber-700/50 rounded-xl bg-amber-900/10">
              <Languages className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="font-medium">You have a translation in progress</p>
              <p className="text-sm text-amber-400/80 mt-1">Mark every waypoint done and hand it off to the Admin before starting another clone.</p>
            </div>
          ) : sortedCloneable.length === 0 ? (
            <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
              <Languages className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No tours available to clone yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedCloneable.map(walk => <CloneableTourRow key={walk.id} walk={walk} onClone={setCloneTarget} />)}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-bold text-white mb-1">Clone in Progress</h2>
          <p className="text-sm text-slate-400 mb-3">Once every waypoint is marked done, Publish sends it to the Admin — and you're free to start a new clone right away. Each one stays listed here until the Admin has fully published it as a live tour.</p>
          {myClones.length === 0 ? (
            <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
              <Mic className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No clones yet</p>
              <p className="text-sm">Clone a tour above to start a translation.</p>
            </div>
          ) : (
            <div className="space-y-2">{myClones.map(walk => <MyCloneRow key={walk.id} walk={walk} onContinue={onContinueTour} onPublish={onPublishClone} onHandOff={onHandOffClone} onRequestDelete={onDeleteClone ? setDeleteTarget : null} unrestricted={unrestricted} locked={!!pendingPushbackId && walk.id !== pendingPushbackId && !walk.finished} />)}</div>
          )}
        </div>

        <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && !isDeletingClone && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this clone?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete your <strong>{deleteTarget?.target_language}</strong> translation of
                “<strong>{deleteTarget?.name}</strong>” — every waypoint, script edit, and audio you've done on it
                so far. This can't be undone. Once it's deleted, that tour becomes available to clone again,
                so you can start over from scratch.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingClone}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); confirmDeleteClone(); }}
                disabled={isDeletingClone}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeletingClone ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Yes, delete this clone
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ----- Admin view -----
  const unfinishedWalks = works.filter(hasMissingAudio).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {/* New Tour */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3">New Tour</h2>
        <div className="space-y-2">
          {TOUR_CATEGORIES.map((cat, index) => {
            const Icon = CATEGORY_ICONS[cat.icon] || MapPin;
            const colourMap = {
              emerald: 'from-emerald-600 to-green-700 hover:from-emerald-700 hover:to-green-800',
              amber: 'from-amber-600 to-orange-700 hover:from-amber-700 hover:to-orange-800',
              blue: 'from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800',
            };
            return (
              <motion.button
                key={cat.code}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => onNewTour(cat.code)}
                className={`w-full bg-gradient-to-r ${colourMap[cat.color]} text-white rounded-xl p-4 shadow-lg flex items-center gap-3 transition-all hover:shadow-xl hover:scale-[1.01] active:scale-[0.99] text-left`}
              >
                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-white/25 px-1.5 py-0.5 rounded font-bold">{cat.code}</span>
                    <span className="font-bold">{cat.label}</span>
                  </div>
                  <p className="text-sm text-white/80 mt-0.5">{cat.description}</p>
                </div>
                <Plus className="w-5 h-5 opacity-70 shrink-0" />
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Translations awaiting review */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2"><Languages className="w-5 h-5 text-purple-400" /> Translations awaiting review</h2>
        {reviewClones.length === 0 ? (
          <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No finished translations waiting</p>
          </div>
        ) : (
          <div className="space-y-2">{reviewClones.map(walk => <ReviewCloneRow key={walk.id} walk={walk} onReview={onContinueTour} onPublish={onPublishClone} />)}</div>
        )}
      </div>

      {/* Continue Working */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3">Audio Still Needed</h2>
        {unfinishedWalks.length === 0 ? (
          <div className="text-center py-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">
            <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">All audio clips uploaded</p>
          </div>
        ) : (
          <div className="space-y-3">{unfinishedWalks.map(walk => <MissingAudioTourCard key={walk.id} walk={walk} onJumpToWaypoint={onContinueTour} />)}</div>
        )}
      </div>

      {/* Admin tools */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3">Admin Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Button variant="outline" onClick={onDashboard} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <LayoutDashboard className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-left min-w-0 whitespace-normal"><p className="font-medium">Dashboard</p><p className="text-xs text-slate-400">Overview & stats</p></div>
          </Button>
          <Button variant="outline" onClick={onManageWalks} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <List className="w-5 h-5 text-blue-400 shrink-0" />
            <div className="text-left min-w-0 whitespace-normal"><p className="font-medium">Manage Tours</p><p className="text-xs text-slate-400">All tours</p></div>
          </Button>
          <Button variant="outline" onClick={onManageUsers} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <Users className="w-5 h-5 text-purple-400 shrink-0" />
            <div className="text-left min-w-0 whitespace-normal"><p className="font-medium">Manage Users</p><p className="text-xs text-slate-400">Promote / set Narrator passwords</p></div>
          </Button>
          <Button variant="outline" onClick={onManageDisputes} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="text-left min-w-0 whitespace-normal"><p className="font-medium">Disputes</p><p className="text-xs text-slate-400">Restore access after a won chargeback</p></div>
          </Button>
          <Button variant="outline" onClick={onManageTranslations} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <Languages className="w-5 h-5 text-purple-400 shrink-0" />
            <div className="text-left min-w-0 whitespace-normal"><p className="font-medium">Translations</p><p className="text-xs text-slate-400">Correct UI strings</p></div>
          </Button>
          <Button variant="outline" onClick={onUpdateAudio} className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 gap-2 h-auto py-3 justify-start">
            <AudioLines className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-left min-w-0 whitespace-normal"><p className="font-medium">Update Audio</p><p className="text-xs text-slate-400">Swap in final PCV narration before publishing</p></div>
          </Button>
        </div>
      </div>
    </div>
  );
}