import React from 'react';
import { Loader2, Send } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * The explicit "tested in the real app" gate before any new customer-facing version is
 * published (published-versions plan §2, confirmed invariant 2): the server-side
 * audio-readiness gate proves a customer COULD play the tour, but the real-app preview
 * — actually opening it in the app and walking/driving it — stays a human step. This
 * dialog records that confirmation: publishTourVersion requires preview_confirmed, and
 * the version row stores that it was given.
 */
export default function PublishVersionDialog({ open, tourName, language, loading, onConfirm, onOpenChange }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <AlertDialogContent className="bg-slate-800 border-2 border-emerald-600 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white flex items-center gap-2">
            <Send className="w-4 h-4 text-emerald-400" />
            Publish a new customer-facing version
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300">
            This freezes the current state of <span className="text-white font-medium">{tourName || 'this tour'}</span>
            {language ? <> (<span className="text-white font-medium">{language}</span>)</> : null} as an immutable
            version that customers are served. The source tour stays editable — its changes reach customers only the
            next time you publish.
          </AlertDialogDescription>
          <AlertDialogDescription className="text-slate-400 text-xs">
            Confirm you have opened this tour in the real app and tested it (map, narration, player). This confirmation
            is recorded with the version.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600" disabled={loading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Send className="w-4 h-4 mr-1.5" />}
            Confirm tested — Publish
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}