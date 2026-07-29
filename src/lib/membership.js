/**
 * Simplified walk access utilities for Magical Crete
 *
 * Current access model:
 *
 * - Everyone sees all approved walks.
 * - The app includes 5 free sample walks for everyone.
 * - Community walks are free for everyone.
 * - Official Magical Crete walks may be:
 *      - Free to logged-in annual members at checkout/download
 *      - Purchased individually by non-members for €15 per walk
 * - Annual membership costs €75 per year.
 * - Members are entitled to at least 6 new member-available walks per year at €0 cost.
 * - Member-available walks are not automatically added to the app; members must log in
 *   on the website and download each walk at €0 cost.
 *
 * Access checking for purchases/downloads is handled elsewhere.
 */

export const FREE_SAMPLE_WALK_COUNT = 5;
export const INDIVIDUAL_WALK_PRICE_EUR = 15;
export const ANNUAL_MEMBERSHIP_PRICE_EUR = 75;
export const MEMBER_FREE_WALKS_PER_YEAR_MINIMUM = 6;

/**
 * Return all approved walks.
 */
export function getAccessibleWalks(walks) {
  return walks.filter(w => w.approved !== false);
}

/**
 * Community walk?
 */
export function isCommunityWalk(walk) {
  return walk.walk_category === 'community';
}

/**
 * Official Magical Crete walk?
 */
export function isOfficialWalk(walk) {
  return walk.walk_category === 'official';
}

/**
 * Free sample walk?
 */
export function isSampleWalk(walk) {
  return walk.is_sample_walk === true;
}

/**
 * Free to logged-in annual members?
 *
 * This means the walk can be downloaded from the website by a logged-in member
 * at €0 cost. It does not mean the walk is automatically added to the app.
 */
export function isMemberIncludedWalk(walk) {
  return walk.is_member_included === true;
}

/**
 * Walk requires admin approval?
 */
export function requiresReview(walk) {
  return walk.requires_review === true;
}

/**
 * Walk approved and visible?
 */
export function isApproved(walk) {
  return walk.approved !== false;
}