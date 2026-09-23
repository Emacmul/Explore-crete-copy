// Single source of truth for "is this Walk record publicly served?" (audit N2, 2026-09-23).
//
// The catalog read path and the save-side audio gate used to decide this independently —
// the catalog served anything with approved !== false (treating a legacy missing/null
// value as public), while saveWalkForBackend's gate only ran for approved === true. A
// record with a missing/null `approved` was therefore served to customers but exempt
// from the audio-readiness check on every edit. Both paths now use this one predicate,
// and saveWalkForBackend rejects any non-boolean `approved` at the boundary, so that
// third state can no longer be created through it.
//
// Strict by design: only an explicit approved === true is public. Anything else — false,
// null, or missing — is a draft. (Verified 2026-09-23: no existing Walk record carries a
// null/missing approved value, so no data migration was needed.)
export function isWalkPublic(record: any): boolean {
  return record?.approved === true;
}