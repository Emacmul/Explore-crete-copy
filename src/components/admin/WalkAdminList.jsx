import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Trash2, Mountain, Loader2, MapPin, Pencil, CalendarCheck, AlertTriangle } from 'lucide-react';
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

export default function WalkAdminList({ walks, isLoading, onEdit, onDelete, onMarkChecked, userRole = 'admin' }) {
  const [confirmDelete, setConfirmDelete] = React.useState(null); // holds the walk object
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [markingChecked, setMarkingChecked] = React.useState(null); // walk id currently being marked
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

  return (
    <div>
      <div className="mb-6 mt-2">
        <h2 className="text-xl font-bold text-white">Tours</h2>
        <p className="text-slate-400 text-sm">{walks.length} tours in database</p>
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
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {(walk.waypoints || []).length} key points
                    </span>
                    {importDate && <span className="text-xs text-slate-500">Imported {importDate}</span>}
                    {walk.announced_at && <span className="text-xs text-slate-500">· Checked {formatDate(walk.announced_at)}</span>}
                  </div>
                </div>
              </button>

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
    </div>
  );
}
