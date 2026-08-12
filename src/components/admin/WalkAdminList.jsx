import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Trash2, Mountain, Loader2, MapPin, Pencil, CalendarCheck, AlertTriangle, RefreshCw, Undo2, Languages } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

const difficultyColors = {
  easy: 'bg-green-900 text-green-300',
  moderate: 'bg-amber-900 text-amber-300',
  challenging: 'bg-orange-900 text-orange-300',
  difficult: 'bg-red-900 text-red-300',
};

const CHECK_INTERVAL_DAYS = 365;

const formatDate = (isoString) => {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
};

const daysSince = (isoString) => {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
};

export default function WalkAdminList({ walks, isLoading, onEdit, onDelete, onMarkChecked, onToggleFree, onPushBack, onRefresh, userRole = 'admin' }) {
  const [confirmDelete, setConfirmDelete] = React.useState(null); // holds the walk object
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [markingChecked, setMarkingChecked] = React.useState(null); // walk id currently being marked
  const [togglingFree, setTogglingFree] = React.useState(null); // walk id currently being toggled
  const [pushBackTarget, setPushBackTarget] = React.useState(null); // holds the walk object
  const [pushBackReason, setPushBackReason] = React.useState('');
  const [pushingBack, setPushingBack] = React.useState(false);
  const isAdmin = userRole === 'admin';

  const handleDelete = (walk) => {
    setConfirmDelete(walk);
  };

  const confirmDeleteWalk = async () => {
    const id = confirmDelete?.id;
    if (!id) return;
    setIsDeleting(true);
    try {
      await onDelete(id);
      setConfirmDelete(null);
    } catch (e) {
      console.error('Delete failed:', e);
      toast({
        variant: 'destructive',
        title: 'Delete failed — nothing was removed',
        description: e?.message || 'An unexpected error occurred while deleting. Please try again.',
      });
    }
    setIsDeleting(false);
  };

  const handleToggleFree = async (e, walk) => {
    e.stopPropagation();
    setTogglingFree(walk.id);
    try {
      await onToggleFree(walk.id, !walk.is_sample_walk);
    } catch (err) {
      console.error('Toggle Free/Paid failed:', err);
      toast({
        variant: 'destructive',
        title: 'Could not change Free/Paid',
        description: err?.message || 'An unexpected error occurred. Please try again.',
      });
    }
    setTogglingFree(null);
  };

  const handleMarkChecked = async (e, walkId) => {
    e.stopPropagation();
    setMarkingChecked(walkId);
    try {
      await onMarkChecked(walkId);
    } catch (err) {
      console.error('Mark checked failed:', err);
      toast({
        variant: 'destructive',
        title: 'Could not save the check',
        description: err?.message || 'An unexpected error occurred. Please try again.',
      });
    }
    setMarkingChecked(null);
  };

  const handlePushBack = async () => {
    if (!pushBackTarget || !pushBackReason.trim()) return;
    setPushingBack(true);
    try {
      await onPushBack(pushBackTarget.id, pushBackReason.trim());
      setPushBackTarget(null);
      setPushBackReason('');
    } catch (err) {
      console.error('Push back failed:', err);
      toast({
        variant: 'destructive',
        title: 'Could not push back this translation',
        description: err?.message || 'An unexpected error occurred. Please try again.',
      });
    }
    setPushingBack(false);
  };

  return (
    <div>
      <div className="mb-6 mt-2 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Tours</h2>
          <p className="text-slate-400 text-sm">{walks.length} tours in database</p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            title="Reload the list from the server, to check what's actually saved"
            className="flex items-center gap-2 text-sm text-white font-semibold bg-blue-600 hover:bg-blue-500 border border-blue-400 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
        </div>
      ) : walks.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Mountain className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No walks yet</p>
          <p className="text-sm">Go to Start → New Tour to create the first one</p>
        </div>
      ) : (
        <div className="space-y-3">
          {walks.map(walk => {
            const importDate = formatDate(walk.created_date);
            const lastCheckedDate = walk.announced_at || walk.created_date;
            const daysOverdue = daysSince(lastCheckedDate);
            const needsCheck = daysOverdue !== null && daysOverdue > CHECK_INTERVAL_DAYS;
            return (
            <div key={walk.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              {needsCheck && (
                <div className="flex items-center gap-2 bg-red-900/30 border-b border-red-700/50 px-4 py-1.5 text-xs text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Not checked for accuracy in over a year{walk.announced_at ? ` (last checked ${formatDate(walk.announced_at)})` : ' (never checked since import)'} — please verify on the ground
                </div>
              )}
              <div className="flex items-center">
              {/* Main content — click anywhere here to edit */}
              <button
                onClick={() => onEdit(walk)}
                className="flex-1 min-w-0 text-left px-4 py-4 flex items-center gap-4 hover:bg-slate-700/60 transition-colors group"
              >
                <span className="font-mono text-sm bg-slate-700 text-amber-300 px-3 py-1 rounded font-bold shrink-0">
                  {walk.code}
                </span>
                <span className="font-mono text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded font-bold shrink-0">
                  {walk.tour_category || 'WHT'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-white truncate">{walk.name}</p>
                    <span className="text-xs text-amber-400 flex items-center gap-1 shrink-0">
                      <Pencil className="w-3 h-3" /> Edit
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {walk.region && <span className="text-xs text-slate-400">{walk.region}</span>}
                    {walk.difficulty && (
                      <Badge className={`text-xs ${difficultyColors[walk.difficulty]}`}>
                        {walk.difficulty}
                      </Badge>
                    )}
                    {walk.distance_km && <span className="text-xs text-slate-500">{walk.distance_km} km</span>}
                    <Badge className={`text-xs ${walk.approved === false ? 'bg-red-900 text-red-300' : 'bg-slate-600 text-slate-200'}`}>
                      {walk.approved === false ? 'Draft — not visible to customers' : 'Published'}
                    </Badge>
                    {walk.clone_of && walk.target_language && (
                      <Badge className="text-xs bg-purple-900 text-purple-300 border border-purple-700">
                        <Languages className="w-3 h-3 mr-1" /> {walk.target_language}
                      </Badge>
                    )}
                    {walk.pushback_reason && (
                      <Badge className="text-xs bg-red-900 text-red-300 border border-red-700">
                        Needs correction
                      </Badge>
                    )}
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {(walk.waypoints || []).length} key points
                    </span>
                    {importDate && <span className="text-xs text-slate-500">Imported {importDate}</span>}
                    {walk.announced_at && <span className="text-xs text-slate-500">· Checked {formatDate(walk.announced_at)}</span>}
                  </div>
                </div>
              </button>

              {/* Free/Paid — admin only. Marks the walk as a free sample available to everyone
                  (e.g. a free walk given away over Christmas) vs. its normal paid status. */}
              {isAdmin && (
                <button
                  onClick={(e) => handleToggleFree(e, walk)}
                  disabled={togglingFree === walk.id}
                  title={walk.is_sample_walk ? 'Free for everyone — click to make it Paid again' : 'Paid — click to make it Free for everyone'}
                  className={`shrink-0 px-2.5 py-1.5 mr-1 rounded-full text-xs font-semibold transition-colors ${
                    walk.is_sample_walk ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {togglingFree === walk.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (walk.is_sample_walk ? 'Free' : 'Paid')}
                </button>
              )}

              {/* Push back for correction — admin only, only for a published translation
                  clone (spelling error, wrong translation, etc.). Unpublishes it, reopens
                  it for the narrator, and blocks them from starting anything new until
                  they fix and re-submit it — the same "one clone in progress" limit that
                  already governs new translations naturally covers this too, since a
                  pushed-back clone becomes unfinished + unapproved again. */}
              {isAdmin && walk.clone_of && walk.approved !== false && (
                <button
                  onClick={(e) => { e.stopPropagation(); setPushBackTarget(walk); setPushBackReason(''); }}
                  title="Push back to the narrator for correction"
                  className="shrink-0 p-4 text-slate-500 hover:text-amber-400 transition-colors"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
              )}

              {/* Was Checked — confirms the route is still accurate on the ground, resets the 1-year clock */}
              <button
                onClick={(e) => handleMarkChecked(e, walk.id)}
                disabled={markingChecked === walk.id}
                title="Mark as checked for accuracy today"
                className={`shrink-0 p-4 transition-colors ${needsCheck ? 'text-red-400 hover:text-green-400' : 'text-slate-500 hover:text-green-400'}`}
              >
                {markingChecked === walk.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
              </button>

              {/* Delete — admin only, replaces the old edit-pencil spot */}
              {isAdmin && (
                <button
                  onClick={() => handleDelete(walk)}
                  title="Delete tour"
                  className="shrink-0 p-4 text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this tour?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is irreversible and all tour details for <strong>{confirmDelete?.name}</strong> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDeleteWalk(); }}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Yes, delete tour
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!pushBackTarget} onOpenChange={open => !open && setPushBackTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push back for correction</DialogTitle>
            <DialogDescription>
              <strong>{pushBackTarget?.name}</strong> will be unpublished and sent back to{' '}
              <strong>{pushBackTarget?.assigned_narrator_email || 'the narrator'}</strong> to fix.
              They won't be able to start any new translation until this one is corrected
              and re-published.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pushBackReason}
            onChange={e => setPushBackReason(e.target.value)}
            placeholder="What needs fixing? e.g. 'The word for church on waypoint 3 is misspelled' or 'The safety notes paragraph reads awkwardly'"
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPushBackTarget(null)}>Cancel</Button>
            <Button
              onClick={handlePushBack}
              disabled={!pushBackReason.trim() || pushingBack}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
            >
              {pushingBack ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
              Send back for correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
