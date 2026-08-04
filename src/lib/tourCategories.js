/**
 * Tour category definitions for Magical Crete
 *
 * WHT = Walking/Hiking Tour   → opens walking tour editor (route_type: walk)
 * WBT = Walkabout Tour        → opens driving tour editor (route_type: driving_audio_tour)
 *                               Walking experience in a village/town, 3-4 hrs max, no driving
 * DDV = Driving Tour          → opens driving tour editor (route_type: driving_audio_tour)
 *                               Full-day driving route with audio narration, up to 8 hrs
 */

export const TOUR_CATEGORIES = [
  {
    code: 'WHT',
    label: 'Walking/Hiking Tour',
    shortLabel: 'Walking Tour',
    pluralLabel: 'Walks',
    route_type: 'walk',
    description: 'Hiking and walking routes through nature, gorges, and villages',
    icon: 'Footprints',
    color: 'emerald',
  },
  {
    code: 'WBT',
    label: 'Walkabout Tour',
    shortLabel: 'Walkabout',
    pluralLabel: 'WalkAbouts',
    route_type: 'driving_audio_tour',
    description: 'Guided walking experience in a village or town, 3-4 hours max',
    icon: 'MapPin',
    color: 'amber',
  },
  {
    code: 'DDV',
    label: 'Driving Tour',
    shortLabel: 'Driving',
    pluralLabel: 'Tours',
    route_type: 'driving_audio_tour',
    description: 'Full-day driving route with audio narration, up to 8 hours',
    icon: 'Car',
    color: 'blue',
  },
];

export const TOUR_CATEGORY_MAP = TOUR_CATEGORIES.reduce((acc, c) => {
  acc[c.code] = c;
  return acc;
}, {});

export function getTourCategory(code) {
  return TOUR_CATEGORY_MAP[code] || TOUR_CATEGORY_MAP['WHT'];
}

export function getRouteTypeForCategory(categoryCode) {
  const cat = getTourCategory(categoryCode);
  return cat ? cat.route_type : 'walk';
}