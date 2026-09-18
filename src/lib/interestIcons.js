// Single source of truth for the "Main Interests" tag list and their icons.
//
// Per Enda: every interest tag (Buggy Friendly, Route of Faith, Archaeology,
// Photography, ...) gets an icon from mapicons.mapsmarker.com, recoloured to the
// site's own blue/white/navy, wrapped in the same white-circle-with-navy-border
// template (see InterestIcon.jsx). As each icon is produced, it drops in here —
// one new line, no other code changes needed anywhere else in the app.
//
// To add a new icon once Enda sends the file:
//   1. Save it under src/assets/interest-icons/<name>.png (trim any empty
//      transparent margin around the glyph first — see CLAUDE_CHANGELOG.md's
//      "Interest icons" entry for why: an untrimmed source shrinks visibly
//      inside the circle instead of filling it).
//   2. Import it below and add an entry to INTEREST_ICON_MAP keyed by the exact
//      interest label used in DEFAULT_INTERESTS / main_interest.
// An interest with no entry here simply renders without an icon (WalkCard.jsx
// falls back to text, or its existing lucide icon for Route of Faith) — nothing
// breaks while icons are still being produced.

import buggyFriendlyIcon from '@/assets/interest-icons/buggy-friendly.png';
import wildFlowersIcon from '@/assets/interest-icons/wild-flowers.png';
import historyIcon from '@/assets/interest-icons/history.png';
import routesOfFaithIcon from '@/assets/interest-icons/routes-of-faith.png';
import archaeologyIcon from '@/assets/interest-icons/archaeology.png';
import mountainBikingIcon from '@/assets/interest-icons/mountain-biking.png';
import birdsOfPreyIcon from '@/assets/interest-icons/birds-of-prey.png';
import photographyIcon from '@/assets/interest-icons/photography.png';
import mythologyIcon from '@/assets/interest-icons/mythology.png';

// Per Enda's follow-up (icons project): Buggy Friendly moved from its own
// dedicated yes/no field into this one shared tag list, same as Route of Faith
// already worked — one single dropdown to manage instead of a separate toggle
// elsewhere on the page. The OLD `buggy_friendly` boolean field on Walk is still
// read (see isBuggyFriendly() below) purely for backward compatibility with
// tours saved before this change — new/edited tours are tagged here instead,
// and nothing needs to be migrated for that to keep working.
//
// Per Enda (2026-09-18): "Mountain Biking" is not on this list yet — he said he
// may add it as a real walk/tour category "at a later stage". Its icon is ready
// (see INTEREST_ICON_MAP below) so it's a one-line move into this array whenever
// he says go — nothing else needs to change.
export const DEFAULT_INTERESTS = [
  'Wild Flowers',
  'History',
  'Mythology',
  'Archaeology',
  'Photography',
  'Routes of Faith',
  'Buggy Friendly',
  'Birds of Prey',
];

export const INTEREST_ICON_MAP = {
  'Buggy Friendly': buggyFriendlyIcon,
  'Wild Flowers': wildFlowersIcon,
  'History': historyIcon,
  'Routes of Faith': routesOfFaithIcon,
  'Archaeology': archaeologyIcon,
  'Mountain Biking': mountainBikingIcon,
  'Birds of Prey': birdsOfPreyIcon,
  'Photography': photographyIcon,
  'Mythology': mythologyIcon,
};

export function getSelectedInterests(walk) {
  return (walk?.main_interest || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Backward-compatible check: true if EITHER the new tag is present, or the old
// dedicated field was set on a tour saved before this change existed.
export function isBuggyFriendly(walk) {
  return walk?.buggy_friendly === true || getSelectedInterests(walk).includes('Buggy Friendly');
}
