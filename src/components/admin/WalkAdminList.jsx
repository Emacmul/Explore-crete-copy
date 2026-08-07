import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Mountain, Loader2, Ticket, MapPin, Mail, CheckCircle2, ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { TOUR_CATEGORIES, getTourCategory } from '@/lib/tourCategories';

const difficultyColors = {
  easy: 'bg-green-900 text-green-300',
  moderate: 'bg-amber-900 text-amber-300',
  challenging: 'bg-orange-900 text-orange-300',
  difficult: 'bg-red-900 text-red-300',
};

export default function WalkAdminList({ walks, isLoading, onNew, onEdit, onDelete, onVouchers }) {
  const [confirmDelete, setConfirmDelete] = React.useState(null); // holds the walk object
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [sendingEmail, setSendingEmail] = React.useState(null);
  const [emailSent, setEmailSent] = React.useState({});

  const handleSendEmail = async (walk) => {
    setSendingEmail(walk.id);
    const res = await base44.functions.invoke('sendNewWalkEmail', { walkId: walk.id });
    setSendingEmail(null);
    setEmailSent(prev => ({ ...prev, [walk.id]: res.data?.sent || 0 }));
  };

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white gap-2">
              <Plus className="w-4 h-4" /> Add New Tour <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {TOUR_CATEGORIES.map(cat => (
              <DropdownMenuItem key={cat.code} onClick={() => onNew(cat.code)} className="gap-2">
                <span className="font-mono text-xs font-bold bg-slate-100 px-1.5 py-0.5 rounded">{cat.code}</span>
                {cat.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
            <div key={walk.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              {/* Main row — click anywhere to edit */}
              <button
                onClick={() => onEdit(walk)}
                className="w-full text-left px-4 py-4 flex items-center gap-4 hover:bg-slate-700/60 transition-colors group"
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
                    <span className="text-xs text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
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
                <Pencil className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-colors shrink-0" />
              </button>

              {/* Action strip */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-slate-700 bg-slate-900/30">
                <Button
                  size="sm"
                  onClick={() => onEdit(walk)}
                  className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5 text-xs h-7"
                >
                  <Pencil className="w-3 h-3" /> Edit Tour
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onVouchers(walk)}
                  className="text-amber-400 hover:text-amber-300 hover:bg-slate-700 gap-1.5 text-xs h-7"
                >
                  <Ticket className="w-3 h-3" /> Vouchers
                </Button>
                {emailSent[walk.id] != null ? (
                  <span className="flex items-center gap-1 text-xs text-green-400 px-2">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Sent to {emailSent[walk.id]} members
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSendEmail(walk)}
                    disabled={sendingEmail === walk.id}
                    className="text-blue-400 hover:text-blue-300 hover:bg-slate-700 gap-1.5 text-xs h-7"
                  >
                    {sendingEmail === walk.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                    {sendingEmail === walk.id ? 'Sending…' : 'Email all members'}
                  </Button>
                )}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(walk)}
                  className="h-7 text-xs gap-1.5 text-red-400 border border-red-700/50 hover:bg-red-900/40"
                >
                  <Trash2 className="w-3 h-3" /> Delete Tour
                </Button>
              </div>
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