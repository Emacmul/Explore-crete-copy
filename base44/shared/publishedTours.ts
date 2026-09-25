import { isWalkPublic } from './walkPublish.ts';

// Shared machinery for PublishedTour versions (the published-versions plan) — the
// customer-facing immutable snapshots of Walk records.
//
// CORE SCOPING RULE (per tour AND per language): every rule in this module operates on
// a (family_id, language) PAIR — one active version per pair, version numbers per pair,
// normalization per pair, rollback per pair. Never per family (one language's publish
// must never touch another language's active version) and never per app.

// The app's supported tour languages — 23 total, English included, mirroring
// src/lib/languages.js. Publish validates a version's language against this list
// instead of enforcing a numeric cap: extend the app's language set and the ceiling
// rises automatically. Versions of the same language never count as additional
// languages (they're just more version rows for the same pair).
export const SUPPORTED_TOUR_LANGUAGES = [
  'English', 'Dutch', 'Czech', 'French', 'German', 'Spanish', 'Portuguese',
  'Italian', 'Greek', 'Polish', 'Romanian', 'Hungarian', 'Russian', 'Turkish',
  'Serbo-Croatian', 'Hebrew', 'Arabic', 'Norwegian', 'Danish', 'Swedish',
  'Finnish', 'Bulgarian', 'Slovenian',
];

export function isLanguageSupported(language: any): boolean {
  return SUPPORTED_TOUR_LANGUAGES.includes(String(language || '').trim());
}

// Stable canonical JSON (recursively key-sorted) — two snapshots of the same record
// content hash identically regardless of field order, which is what the backup's
// before/after comparison relies on.
export function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashRecord(record: any): Promise<string> {
  return sha256Hex(canonicalJson(record));
}

// The immutable snapshot stored in PublishedTour.content: the full source Walk record
// minus platform bookkeeping and the internal-only fields a customer must never be
// served (the .odt narration-source depository and the assigned narrator's email —
// the same fields getWalkCatalog's allowlist already withholds from the public).
// Everything customer-serving is kept, so the post-cutover readers serve snapshots
// with full fidelity.
export function buildVersionContent(walk: any): any {
  const content = { ...walk };
  delete content.id;
  delete content.created_date;
  delete content.updated_date;
  delete content.created_by_id;
  delete content.import_files;
  delete content.assigned_narrator_email;
  return content;
}

// ---- Interrupt safety protocol (the version-switch atomicity rules) ----
// Platform fact: entity writes are individually atomic but there is no cross-record
// transaction, so "activate the new version" and "retire the superseded one" can never
// be one database operation. The protocol every publish/rollback follows:
//   Rule 1 — activate before retire, always: a crash can only ever leave TOO MANY
//            actives, never zero.
//   Rule 2 — deterministic read-side tie-break: with >1 active for a pair, every reader
//            serves the latest status_changed_at (logged to DebugCatalogLog).
//   Rule 3 — worst case equals the intended outcome: a publish that dies before its
//            retire step leaves the NEW version as the latest — exactly what it wanted.
//   Rule 4 — self-healing: the normalization below retires every active except the
//            intended one (one bulk write), and it opens every publish/rollback call,
//            so any past crash is repaired by the next admin action.

export async function listActiveVersions(svc: any, familyId: string, language: string) {
  const rows = await svc.entities.PublishedTour.filter({
    family_id: String(familyId),
    language: String(language),
    status: 'active',
  });
  return Array.isArray(rows) ? rows : [];
}

// The ONE deterministic serving resolution for a pair. Multiple actives (a mid-crash
// state, or two overlapping admin actions) never flicker: latest status_changed_at
// wins, then latest published_at, then id — a total order, so every reader that calls
// this serves the same version.
export async function resolveActiveVersion(svc: any, familyId: string, language: string) {
  const actives = await listActiveVersions(svc, familyId, language);
  if (actives.length === 0) return { version: null, anomaly: false, active_count: 0 };
  const sorted = [...actives].sort((a: any, b: any) =>
    (new Date(b.status_changed_at || 0).getTime() - new Date(a.status_changed_at || 0).getTime()) ||
    (new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()) ||
    String(b.id).localeCompare(String(a.id)));
  const version = sorted[0];
  const anomaly = actives.length > 1;
  if (anomaly) {
    try {
      await svc.entities.DebugCatalogLog.create({
        note: `PublishedTour anomaly: ${actives.length} active versions for family ${familyId} / ${language} — serving version ${version.version_number} (id ${version.id}, latest status_changed_at)`,
      });
    } catch { /* logging must never break serving */ }
  }
  return { version, anomaly, active_count: actives.length };
}

// Rule 4 — retire every active row for the pair except the intended one, in a SINGLE
// bulk write (not a loop of single updates). Called AFTER the new/target row has been
// written active (Rule 1).
export async function normalizeActiveVersion(svc: any, familyId: string, language: string, keepId: string) {
  const actives = await listActiveVersions(svc, familyId, language);
  const toRetire = actives.filter((v: any) => v.id !== keepId);
  if (toRetire.length === 0) return 0;
  const now = new Date().toISOString();
  await svc.entities.PublishedTour.bulkUpdate(
    toRetire.map((v: any) => ({ id: v.id, status: 'retired', status_changed_at: now })),
  );
  return toRetire.length;
}

export async function nextVersionNumber(svc: any, familyId: string, language: string) {
  const rows = await svc.entities.PublishedTour.filter({
    family_id: String(familyId),
    language: String(language),
  });
  return (Array.isArray(rows) ? rows.length : 0) + 1;
}

// ---- The per-(tour, language) fallback, shared by backfill and (later) readers ----

// The legacy Walk record that would be served TODAY for this exact (family, language)
// pair — the same eligibility and priority getWalkCatalog uses for customers:
//   - a published clone (finished + approved) in this language, newest first; else
//   - the approved original, for the English pair only.
// Per PAIR, never per family: a pair with no legacy record falls back to nothing, and
// another language's published record never leaks into it.
export function legacyServingRecord(family: { original: any | null, clones: any[] }, language: any) {
  const lang = String(language || '').trim();
  const eligibleClones = (family.clones || []).filter((c: any) => c && c.finished === true && isWalkPublic(c));
  const matching = eligibleClones.filter((c: any) => String(c.target_language || '').trim() === lang);
  if (matching.length > 0) {
    return [...matching].sort((a: any, b: any) =>
      new Date(b.updated_date || 0).getTime() - new Date(a.updated_date || 0).getTime())[0];
  }
  if (lang === 'English' && family.original && isWalkPublic(family.original)) {
    return family.original;
  }
  return null;
}

// The full serving resolution for one (family, language) pair — what the post-cutover
// readers will call, per pair:
//   1. the pair's ACTIVE PublishedTour version (deterministic tie-break inside);
//   2. fallback: the legacy published Walk record for THIS SAME pair;
//   3. nothing — no other language's data ever stands in for the pair.
export async function resolveServingVersion(svc: any, familyId: string, family: { original: any | null, clones: any[] }, language: any) {
  const { version, anomaly, active_count } = await resolveActiveVersion(svc, familyId, language);
  if (version) return { kind: 'published', version, anomaly, active_count };
  const legacy = legacyServingRecord(family, language);
  if (legacy) return { kind: 'legacy', walk: legacy, anomaly: false, active_count: 0 };
  return { kind: 'none', anomaly: false, active_count: 0 };
}