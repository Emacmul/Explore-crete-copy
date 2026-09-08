import { recordPurchase } from './purchaseRecorder.ts';

// Per Enda (follow-up 146): every admin/narrator gets every published ENGLISH
// tour added to their own library for free, so they can experience a tour
// themselves before translating it. Reuses the exact same mechanism as the
// manual "gift a tour" action (grantWalk.ts / recordPurchase.ts) — a Purchase
// record with processor "manual" — so a gifted tour shows up in someone's
// library the same way a real purchase would, with no separate code path.
//
// "Published English tour" = a master (non-clone) Walk with approved !== false
// (matches getWalkCatalog's own definition of purchasable) and a creem_product_id
// set — a tour can't be gifted before it has a sellable product id, same rule
// grantWalk.ts already enforces for a manual one-off gift.
//
// Two directions feed into the one shared recordPurchase() call, so a person
// can never end up owning a tour through one path but not the other:
//   1. a tour is (re)approved -> grantTourToAllNarrators() gives it to every
//      CURRENT admin/narrator.
//   2. someone is promoted to narrator/admin/super_admin -> grantAllPublishedToursToNarrator()
//      gives them every tour already published up to that point, not just future
//      ones — per Enda, a new narrator needs the older tours too since they'll be
//      translating those as well.
//
// Both are best-effort: callers wrap these in try/catch so a problem here can
// never block the walk save or the AppUser save that triggered it.

const ELIGIBLE_ROLES = ['narrator', 'admin', 'super_admin'];

export async function grantTourToAllNarrators(base44, walk: any) {
  if (!walk || walk.clone_of || !walk.creem_product_id) return;

  const users = await base44.asServiceRole.entities.AppUser.filter({}, '-created_date', 5000);
  const recipients = (Array.isArray(users) ? users : [])
    .filter((u: any) => ELIGIBLE_ROLES.includes(u.role) && u.email);

  for (const u of recipients) {
    await recordPurchase(base44, {
      buyerEmail: u.email,
      productId: walk.creem_product_id,
      processor: 'manual',
      transactionId: null,
    });
  }
}

export async function grantAllPublishedToursToNarrator(base44, email: string) {
  const buyerEmail = (email || '').toLowerCase().trim();
  if (!buyerEmail) return;

  const allWalks = await base44.asServiceRole.entities.Walk.list('-created_date', 1000);
  const eligibleTours = (Array.isArray(allWalks) ? allWalks : [])
    .filter((w: any) => !w.clone_of && w.approved !== false && w.creem_product_id);

  for (const w of eligibleTours) {
    await recordPurchase(base44, {
      buyerEmail,
      productId: w.creem_product_id,
      processor: 'manual',
      transactionId: null,
    });
  }
}
