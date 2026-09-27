import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

// Full-screen photo viewer for a waypoint's photos, used from the Tour Stops /
// Key Points list in WalkDetail.jsx.
//
// Deliberately a plain fixed overlay on top of the CURRENT screen. It never
// navigates anywhere, never touches the narration audio element, and never
// touches the GPS watch — narration and tracking simply keep running underneath.
// That is the whole requirement (Enda, 2026-09-27): a customer tapping a photo
// mid-tour must not lose the app, the narration or their GPS. Tapping the
// backdrop, the X, or (on desktop) pressing Escape closes it and the customer is
// exactly where they were.
export default function WaypointPhotoLightbox({ images, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const count = (images || []).length;

  useEffect(() => {
    if (count === 0) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(count - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, onClose]);

  if (count === 0) return null;
  const safeIndex = Math.min(Math.max(0, index), count - 1);

  const step = (delta) => setIndex((i) => Math.min(count - 1, Math.max(0, i + delta)));

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Close */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
      >
        <X className="w-5 h-5" />
      </button>

      {/* The photo itself — tapping the photo does NOT close (stopPropagation),
          so a customer tapping around to zoom/inspect doesn't lose their place. */}
      <img
        src={images[safeIndex]}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg select-none"
      />

      {count > 1 && (
        <>
          {safeIndex > 0 && (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); step(-1); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {safeIndex < count - 1 && (
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); step(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          <span
            className="absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/15 text-white text-sm font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            {safeIndex + 1} / {count}
          </span>
        </>
      )}
    </div>
  );
}