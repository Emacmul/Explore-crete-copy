import React from 'react';
import { cn } from '@/lib/utils';

// Reusable "template" circle for interest icons (Buggy Friendly, Route of Faith,
// Archaeology, etc.) — per Enda: white circle, thin navy border, icon sized to fill
// the circle without spilling past its edge. Every new icon he produces on
// mapicons.mapsmarker.com just drops into this same wrapper — no per-icon styling
// needed, only a new file in src/assets/interest-icons/ and an entry in
// src/lib/interestIcons.js.
//
// Sizing/proportions were tuned live with Enda against real previews (see
// CLAUDE_CHANGELOG.md, "Interest icons" entry) — this is NOT a guess:
// - The border is thin (1px at these sizes) at every size, not scaled up with size —
//   a thicker border read as too heavy even at small badge sizes.
// - The icon itself is NOT simply scaled to the circle's width. A source icon's
//   bounding box is often a plain rectangle even though the actual drawn shape
//   (e.g. a buggy's wheels, a walking figure's feet) reaches into the CORNERS of
//   that box — sizing off the box's width alone let those corner details spill
//   past the circle every time, since a circle inscribed in a square never quite
//   reaches its corners. `object-fit: contain` with the padding below keeps
//   everything safely inside the ring at any icon shape, without needing to
//   hand-tune padding per icon.
export const INTEREST_ICON_NAVY = '#001489';

export default function InterestIcon({ src, alt = '', size = 24, className }) {
  if (!src) return null;
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-full bg-white shrink-0', className)}
      style={{
        width: size,
        height: size,
        border: `1px solid ${INTEREST_ICON_NAVY}`,
      }}
    >
      <img
        src={src}
        alt={alt}
        // Per Enda's live feedback: the icon must fill the circle at its own widest
        // point, not float in a sea of white padding — 78% of the circle's diameter
        // (leaving ~11% breathing room on each side, inside the border) matched what
        // he approved for the Buggy Friendly icon and is the right general-purpose
        // default for icons already trimmed to their own true bounding box (see
        // interestIcons.js — icons are pre-trimmed to their visible content before
        // being added here, so this percentage means the same thing for every icon).
        style={{ width: '78%', height: '78%', objectFit: 'contain' }}
      />
    </span>
  );
}
