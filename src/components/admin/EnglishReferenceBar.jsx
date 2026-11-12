import React from 'react';
import { Button } from '@/components/ui/button';
import { EyeOff, Eye, FileText } from 'lucide-react';
import { useEnglishReferenceHidden } from '@/lib/englishReference';

// The one control that removes the English original from a translation clone — and puts
// it back. Sits directly under the editor's tabs (see WalkEditor), so it is on screen in
// every tab of a walk, walkabout or driveabout clone, for the whole translation.
//
// Per the Hebrew narrator's request (2026-11-12): the English stays visible until the
// COMPLETE translation is done, then a single button removes it from the clone. The
// per-panel "Remove original" buttons (script and waypoint references) do the same
// thing, so whichever one she reaches first settles it for the whole tour.
export default function EnglishReferenceBar({ walkId }) {
  const [hidden, setHidden] = useEnglishReferenceHidden(walkId);
  if (!walkId) return null;

  if (hidden) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 mb-4">
        <Eye className="w-4 h-4 text-slate-400 shrink-0" />
        <p className="text-xs text-slate-400 flex-1">
          The English original is removed from this tour — only your translation is on screen, on every tab.
        </p>
        <Button
          type="button" size="sm" variant="ghost"
          onClick={() => setHidden(false)}
          className="h-7 px-2 text-xs gap-1.5 text-slate-300 hover:text-white shrink-0"
        >
          <Eye className="w-3.5 h-3.5" /> Show it again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-600/70 bg-slate-900/60 px-4 py-2 mb-4">
      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
      <p className="text-xs text-slate-400 flex-1">
        The original English stays beside your translation on every tab and at every stop, until you remove it.
        Remove it only once the whole tour is translated.
      </p>
      <Button
        type="button" size="sm"
        onClick={() => setHidden(true)}
        className="h-7 px-3 text-xs gap-1.5 bg-red-700 hover:bg-red-600 text-white shrink-0"
        title="Removes the English original from this whole clone (you can bring it back at any time)"
      >
        <EyeOff className="w-3.5 h-3.5" /> Done — remove the English original
      </Button>
    </div>
  );
}