// Per-(master tour, language) mutual exclusion for publishTourVersion and
// rollbackTourVersion — the concurrency fix of 2026-09-25.
//
// WHY THIS EXISTS. The activate-before-retire protocol in publishedTours.ts was
// designed against interruptions and holds there: a crashed publish can only leave
// TOO MANY actives, never zero, and the deterministic tie-break serves the intended
// version. It did NOT hold against two actions genuinely running at the same time:
// two concurrent publishes on one pair both computed the same version number
// (nextVersionNumber read the same row count before either create landed) and each
// one's normalization retired the OTHER's freshly-created active row — the pair
// ended with duplicate version numbers and ZERO active versions, so customers were
// served nothing for that pair. A "check at the end and reactivate if zero" patch
// cannot fix this (the check itself races), so the state changes are now SERIALIZED
// per pair instead.
//
// DESIGN. One PublishLock row per `${family_id}||${language}` pair. A grant is a
// (holder token, expires_at) stamp. Acquisition is a compare-and-swap:
//   1. read the row;
//   2. if free, conditionally updateMany({id, holder: ''}, {$set: {holder: token,
//      expires_at: now+TTL}}) — the filter matches only while the row is still free;
//   3. re-read and confirm OUR OWN token came back — of two racing acquirers, at
//      most one can ever see its own token, whatever the write interleaving was.
// A waiter retries until its budget runs out, then the caller returns 409 (the
// admin simply tries again). A stale grant (request died mid-action) is reclaimed
// once expires_at passes, by a CAS on the EXACT stale (holder, expires_at) values —
// a live grant held by someone else never matches and is never clobbered. The
// normal path releases in the caller's finally block; the TTL is the crash net.
//
// WHAT THE CALLER GETS. While a pair's lock is held, no other publish or rollback
// for THAT pair makes any state change: no duplicate version numbers, no
// mutual-retire to zero actives. Other pairs (other tours, other languages) have
// their own lock rows and proceed in parallel. An action interrupted mid-way still
// leaves the same crash-safe state the protocol always allowed — at worst one
// extra active row, resolved deterministically by the tie-break and retired by the
// normalization that opens the next action — and its grant expires so the next
// action is never blocked forever.

const LOCK_TTL_MS = 30000;
const ACQUIRE_BUDGET_MS = 20000;
const RETRY_INTERVAL_MS = 500;
const LOCK_FREE = '';
const LOCK_EPOCH = '1970-01-01T00:00:00.000Z';

export function pairKeyOf(familyId: string, language: string): string {
  return `${String(familyId)}||${String(language || '').trim()}`;
}

// The deterministic lock row for a pair — the LOWEST id among any rows with that
// pair_key, so every concurrent participant converges on the same row even if a
// first-ever create race ever produced a duplicate (extras are deleted best-effort;
// if that delete fails the row choice is still unambiguous for everyone).
async function ensureLockRow(svc: any, pairKey: string) {
  let rows = await svc.entities.PublishLock.filter({ pair_key: pairKey });
  if (!Array.isArray(rows) || rows.length === 0) {
    try {
      await svc.entities.PublishLock.create({
        pair_key: pairKey,
        holder: LOCK_FREE,
        expires_at: LOCK_EPOCH,
      });
    } catch (e) { /* a racing creator made the row first — refetch below */ }
    rows = await svc.entities.PublishLock.filter({ pair_key: pairKey });
  }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sorted = [...rows].sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  if (sorted.length > 1) {
    try {
      const keepId = sorted[0].id;
      await svc.entities.PublishLock.deleteMany({ pair_key: pairKey, id: { $ne: keepId } });
    } catch (e) { /* cosmetic cleanup only; row selection is already deterministic */ }
  }
  return sorted[0];
}

// Returns the grant token on success, null when the lock could not be taken within
// the budget (caller returns 409 — a transient, human-retryable state).
export async function acquirePairLock(svc: any, familyId: string, language: string): Promise<string | null> {
  const pairKey = pairKeyOf(familyId, language);
  const row = await ensureLockRow(svc, pairKey);
  if (!row) return null;
  const token = `lock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + ACQUIRE_BUDGET_MS;
  while (Date.now() < deadline) {
    const current: any = await svc.entities.PublishLock.get(row.id).catch(() => null);
    if (!current) return null;
    const isFree = current.holder === LOCK_FREE || current.holder == null;
    if (isFree) {
      const grantUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();
      // CAS — matches only while still free; confirmed by the re-read below, so two
      // racing acquirers can never both believe they hold the lock.
      await svc.entities.PublishLock.updateMany(
        { id: row.id, holder: LOCK_FREE },
        { $set: { holder: token, expires_at: grantUntil } },
      ).catch(() => null);
      const after: any = await svc.entities.PublishLock.get(row.id).catch(() => null);
      if (after && after.holder === token) return token;
    } else if (new Date(current.expires_at || 0).getTime() < Date.now()) {
      // Stale grant (its action died mid-way): reclaim by CAS on the EXACT stale
      // values — a grant that was already reclaimed or re-taken matches nothing.
      await svc.entities.PublishLock.updateMany(
        { id: row.id, holder: current.holder, expires_at: current.expires_at },
        { $set: { holder: LOCK_FREE, expires_at: LOCK_EPOCH } },
      ).catch(() => null);
    }
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }
  return null;
}

// Clears OUR OWN grant only. If the TTL already handed the pair to a later action,
// this matches nothing and their grant stands untouched.
export async function releasePairLock(svc: any, familyId: string, language: string, token: string) {
  if (!token) return;
  try {
    const pairKey = pairKeyOf(familyId, language);
    const row = await ensureLockRow(svc, pairKey);
    if (!row) return;
    await svc.entities.PublishLock.updateMany(
      { id: row.id, holder: token },
      { $set: { holder: LOCK_FREE, expires_at: LOCK_EPOCH } },
    );
  } catch (e) { /* best-effort: the TTL reclaims a stuck grant regardless */ }
}