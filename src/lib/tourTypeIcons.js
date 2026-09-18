// Custom icons for the 3 tour types (see tourCategories.js), same treatment as
// interestIcons.js: Enda's own icons from mapicons.mapsmarker.com, recoloured to
// the site's blue/navy, shown via the shared InterestIcon circle-badge template.
//
// Per Enda (2026-09-18): these replace the generic lucide icons (Footprints,
// MapPin, Car) everywhere the tour type is shown WITH its written title —
// see TourCategoryPicker.jsx, TourCategoryDialog.jsx, AdminStartScreen.jsx.
//
// To add/replace one: save the trimmed PNG under
// src/assets/tour-type-icons/<name>.png, import it below, and add/update the
// entry keyed by the tour category code (WHT / WBT / DDV — see
// TOUR_CATEGORIES in tourCategories.js). A code with no entry here falls back
// to its old lucide icon — nothing breaks while an icon is still pending.

import drivingTourIcon from '@/assets/tour-type-icons/driving-tour.png';
import walkingHikingIcon from '@/assets/tour-type-icons/walking-hiking.png';
import walkaboutIcon from '@/assets/tour-type-icons/walkabout.png';

export const TOUR_TYPE_ICON_MAP = {
  DDV: drivingTourIcon, // DriveAbout Tour
  WHT: walkingHikingIcon, // Walking/Hiking Tour
  WBT: walkaboutIcon, // Walkabout Tour
};
