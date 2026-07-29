import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Trash2, Mountain, Loader2, MapPin, Pencil } from 'lucide-react';

const difficultyColors = {
  easy: 'bg-green-900 text-green-300',
  moderate: 'bg-amber-900 text-amber-300',
  challenging: 'bg-orange-900 text-orange-300',
  difficult: 'bg-red-900 text-red-300',
};

export default function WalkAdminList({ walks, isLoading, onNew, onEdit, onDelete, userRole = 'admin' }) {
  const [confirmDelete, setConfirmDelete] = React.useState(null); // holds the walk object
  const [isDeleting, setIsDeleting] = React.useState(false);
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
    } catch (e) {
      console.error('Delete failed:', e);
    }
    setIsDeleting(false);
    setConfirmDelete(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 mt-2">
        <div>
          <h2 className="text-xl font-bold text-white">Tours</h2>
          <p className="text-slate-400 text-sm">{walks.length} tours in database</p>
        </div>
        {isAdmin && (
          <Button onClick={onNew} className="bg-amber-500 hover:bg-amber-600 text-white gap-2">
            <Plus className="w-4 h-4" /> Add New Tour
          </Button>
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
          <p className="text-sm">Click "Add New Walk" to create the first trail</p>
        </div>
      ) : (
        <div className="space-y-3">
          {walks.map(walk => (
            <div key={walk.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex items-center">
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
                  </div>
                </div>
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
          ))}
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
