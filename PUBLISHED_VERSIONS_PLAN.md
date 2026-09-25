# Separation of Source Work and Published Products — Design & Migration Plan

**Status: PROPOSAL — not implemented. Nothing in the app has been changed.**

## 1. Current state (verified in code)

Today one `Walk` record plays all three roles:

| Role | Today held by | Publication mechanism |
|---|---|---|
| Master Tour (English source) | The original `Walk` (no `clone_of`) | Admin sets `approved: true` → the master **itself is served** as the English product |
| Narrator clone (editable translation) | `Walk` with `clone_of` + `assigned_narrator_email` | Admin sets `approved: true` on the clone → **the clone becomes the live product** for its language |
| Published product | Same record as its source | No separate snapshot exists |

Readers that treat an approved clone/original as the live tour (all must be handled in the cutover):

1. `getWalkCatalog` — serves families built from `approved === true` originals and `finished && approved` clones; admin draft preview also serves unpublished clones.
2. `syncLibrary` — `isPublished(w) = approved === true && (!clone_of || finished === true)`.
3. `saveWalkForBackend` — the publish/audio-readiness gates fire on `approved` transitions of the **live** Walk record.
4. `cloneWalkForBackend` — blocks a new clone when a finished+approved version exists in that language.
5. `logSafetyConfirmation` — resolves the finished+published clone as the text snapshot source (just fixed).
6. Front-end + offline: the catalogue record shape (family-stable `id`, `_active_id`, `_active_lang`, `_available_langs`, `_accessible`, `updated_date` driving offline refresh, and the withdrawal cleanup keyed on catalogue membership).
7. Admin UI: `WalkEditor` Publish/Unpublish (master), `WalkAdminList`/`BackendShell` clone publish/pushback/mark-checked actions — all write `approved` on Walk records.

**Unaffected by design (and to be left untouched):** purchase entitlement (`Purchase.creem_product_id` → master's `creem_product_id`, family-keyed), memberships, devices/sessions, the Creem webhook, `grantWalk`, narrator free-tour grants, the Tour Simulator + test logs, `UpdateAudioTool` (ElevenLabs .wav import), offline storage mechanics, language preference records (already family-keyed).

## 2. Proposed record structure

### New entity: `PublishedTour` (one row per published version)

```
family_id            Master Walk record id — the stable tour identity.
                     Entitlement, purchases, offline slots, language prefs stay keyed here.
language             'English', 'German', ... exactly one ACTIVE version per (family, language).
source_id /          The Walk record this version was snapshotted FROM (the master for English,
source_kind          the narrator's clone otherwise). The source keeps existing, untouched.
version              1, 2, 3 … per (family, language), in publish order.
status               'active' (served to customers) | 'retired' (kept for rollback).
published_at / by   Audit fields. retired_at / by set when superseded or rolled back.
migration_note       Set only on the v1 records created by the one-time migration (see §4).
content              Customer-facing snapshot copied at publish time: name, code, description,
                     safety_notes, image, region, difficulty, distances/durations/elevation,
                     start point, tour category/route type, buggy-friendly/manual-only flags,
                     trail_path + trail_breaks, waypoints (script, audio_clip_url, trigger
                     settings), system-alert texts (off-route/GPS/speed) + their PCV audio.
                     Commerce NOT copied: price, checkout_url, creem_product_id,
                     is_sample_walk are always read live from the master — so a price change
                     or product-id swap needs no republish, exactly as today.
```

RLS: admin-only (all ops). The catalogue reads it via service role, same as Walk today.

### What the three records become

- **Master Tour (`Walk`, no clone_of)** — Admin/Super-Admin only, always English source, editable forever. `admin_completed` = ready for narrators. Publishing **never** touches it again. `approved` stays as-is on existing records (historical), but stops being the customer-facing signal.
- **Narrator clone (`Walk`, clone_of)** — one per narrator per master. **Retained and re-editable when authorised — never freely editable at any time:** once submitted for review (`finished: true`) it is **read-only to its narrator**, enforced on the backend for every save (see the lifecycle below). Only an Admin or Super Admin can push it back, which unlocks it for its assigned narrator; resubmitting locks it again. Its script and working/draft audio stay on the record for corrections, including after publication. Its `approved` flag becomes irrelevant to customers.
- **PublishedTour** — immutable snapshot; the only thing customers ever see. Corrections create v2, v3…; the previous version is retired, not deleted; rollback re-activates it. **No numeric language cap is implemented** — see "Language limit" below; publish instead validates that the version's language is one the app currently supports. Versions of the same language never count as additional languages (versions are rows; a language is present or not, with exactly one active row).

### Narrator clone lifecycle (submission lock — backend-enforced on every save)

```
editable (finished: false)  --narrator submits-->  submitted / LOCKED (finished: true)
     ^                                                       narrator: every save rejected (409)
     |                                                       admin/super admin: full access —
     +------ admin pushes back (finished: false) <----------  review, edit, publish, push back
```

- **Enforcement point:** `saveWalkForBackend`'s narrator branch rejects any save while the existing clone has `finished === true` ("clone is submitted and locked — an Admin must push it back first"). This is the backend boundary, not a UI convenience; the same rejection applies whatever field the payload touches.
- **Unlock = admin pushback only** (`finished: false`, with the existing pushback reason), re-opening the clone for **its assigned narrator**. Resubmitting (narrator sets `finished: true` again) locks it again.
- **Pushback never touches published versions:** the active `PublishedTour` for that language is a separate record and is not read, modified or re-served by a pushback — customers keep seeing the currently published version throughout.

### Language limit (clarified — nothing implemented until agreed)

Today the app's language machinery supports exactly **23 languages in total, English included** (the `Translation` entity's language enum and the UI language lists both define this set: English plus 22 others). So as things stand:

- "23 languages" means **23 published languages in total** — the English version plus up to 22 narrator languages.
- "English plus 23 others" (24 languages) is **not possible today for a reason unrelated to this change**: the app itself cannot narrate or offer a 24th language until its language set is extended (`Translation` enum, UI language pickers, translation tooling) — a separate change, independent of publishing.

Therefore the proposal is: **no numeric cap in the publish function.** Publish validates only that the version's language is one the app currently supports; if you later extend the language set to N languages, the ceiling becomes N automatically, with no code change here. If you'd prefer a hard count anyway, tell me what it should count and I'll add it — but per your instruction nothing is implemented yet.

### Confirmed invariants (explicit answers to your three confirmations)

1. **Migration only snapshots.** The backfill creates new `PublishedTour` records and performs **no write of any kind to any existing Walk record** — no field changes, no flag resets, no deletes. Verified during the migration by exporting all Walk records before and after and diffing them (empty diff = pass), reported to you with the migration table.
2. **A replacement version goes live only after checks pass.** `publishTourVersion` runs the server-side audio-readiness gate on the candidate (final PCV audio usable and applied on every triggered waypoint, plus the system-alert audio for driving tours) — nothing reaches customers failing it. The one part that is human is the real-app preview: it stays the Admin's manual step on the candidate, and the publish dialog will require an explicit "tested in preview" confirmation (recorded with the publish audit trail) rather than pretending a server verified a human looked.
3. **Rollback is scoped to one language.** It flips `active ↔ retired` **only within the affected (family, language)** — every other language's active version, all source records, entitlements and offline slots are untouched, and the rolled-back-from version is retained as retired, not deleted.

### New backend functions

- `publishTourVersion` (admin/super admin) — `{ source_walk_id, preview_confirmed }`. Validates the candidate (clone must be `finished`/submitted and assigned — publishing a locked, submitted clone is the normal flow — or English master `admin_completed`); runs the existing audio-readiness gate (final PCV audio on every triggered waypoint + system alerts, reused from `saveWalkForBackend`, moved to a shared module); validates the version's language is one the app supports; creates the next `PublishedTour` version; retires the previous active one for that language. **Writes nothing to any Walk record.**
- `rollbackTourVersion` (admin/super admin) — `{ published_tour_id }` — swaps active↔retired within the same (family, language) only. No content changes, no other language touched.
- `listTourVersionsAdmin` — versions per family for the admin panel.

Admin testing before publication is unchanged: the candidate IS the clone (UpdateAudioTool import → listen → Simulator → real-app draft preview via `_is_draft_preview`). No new "staged" record kind is needed — which keeps this change smaller.

### Admin UI changes

- New `PublishedVersionsPanel` (per tour: language/version list, active badge, Publish-from-clone button, Rollback button).
- `WalkEditor`'s master Publish/Unpublish and the clone publish/pushback actions in `WalkAdminList`/`BackendShell` switch from writing `approved` to calling `publishTourVersion` / `rollbackTourVersion`.

## 3. Cutover of readers (all with a legacy safety net)

1. `getWalkCatalog` — content comes from ACTIVE `PublishedTour`s (preferred language → English → alphabetical), families keyed by `family_id`; commerce still from the master. `updated_date` is the version's, so a new version auto-refreshes offline downloads, and the withdrawal cleanup already added covers removals. **Legacy fallback:** a family with no PublishedTour but an approved original / finished+approved clone is served exactly as today and logged to `DebugCatalogLog`, so nothing goes dark if the migration misses a record — and we can see it.
2. Admin draft preview — unchanged: admins still see unpublished masters/clones via the clone path, badged as drafts.
3. `syncLibrary`, `logSafetyConfirmation`, `cloneWalkForBackend`'s already-published check — switch to "active version exists" with the same legacy fallback.
4. `saveWalkForBackend` — two changes on the source side: (a) the narrator branch gains the submission lock above (reject every save while `finished === true`); (b) its live-tour gates become inert once the catalogue serves snapshots (edits to sources no longer reach customers). Kept in place as defence-in-depth; removal is a later cleanup.

## 4. Migration (phased, additive, no bulk overwrite/delete)

1. **Backup first:** full export of every Walk record to a JSON file in the repo before any change.
2. Create the entity + functions (Phase 1) — customers see zero change.
3. **One-time backfill (Phase 2, idempotent, runs only after your approval):**
   - master with `approved === true` → English `PublishedTour` v1 (snapshot of the master, active).
   - clone with `finished && approved` → v1 for its language (snapshot of the clone, active).
   - No Walk record is modified, reset, or deleted. Idempotent: re-running skips families that already have an active version. A per-family result table is produced for your review.
4. Flip readers (Phase 3) — snapshots primary, legacy fallback behind it. Customers see byte-identical content (the snapshot is the same data they were served the day before).
5. Switch the admin publish UI to the new flow (Phase 4). From then on `approved` is history, and sources stay editable through publication.
6. Later (optional): remove the legacy fallback once `DebugCatalogLog` shows no family has used it for a period.

### Honest limits of the migration (not silently papered over)

- **English + language versions snapshot TODAY'S stored state.** In the current model, edits to a published clone/master went live immediately, so the stored record equals what customers get — the v1 snapshot is faithful to the live product. What is **not recoverable** from existing data is the version as it was at *first publication* (pre-later-edits script/audio). v1 therefore carries `migration_note: "snapshot of Walk <id> on <date> — first-publication text not recoverable"`. If you know of a published tour whose record has drifted from what you consider the released product, tell me before Phase 2 — otherwise v1 is defined as today's content.
- Original first-publish timestamps don't exist in the data; v1 `published_at` = migration time, noted in `migration_note`.
- If a family has both an approved master **and** an approved English-language clone, customers were served the **master** for English — the migration snapshots the master as English v1 (matching what customers actually get). The English clone stays as that narrator's editable clone.
- The narrator's editable clone needs no "recovery": it is the very record that exists today; it is simply no longer the served product.

## 5. End-to-end demonstration (run after implementation, before you deploy anything)

1. Admin marks a test master Admin Completed → appears in narrators' cloneable list.
2. Narrator A clones it to German; Narrator B clones it to French (separate test accounts).
3. Narrator A finishes (submits) the German clone.
4. Admin imports an ElevenLabs clip per triggered waypoint, listens, tests the candidate in the real admin preview.
5. `publishTourVersion` → German v1 active. **Assertion: master and clone records are byte-identical before vs. after publish.**
6. Correction prepared: admin pushes the submitted clone back (unlocked for its assigned narrator) → narrator edits the script → admin imports the replacement clip and tests. **Assertions: customer catalogue still serves v1 content throughout; and a narrator save is rejected (409) while the clone is submitted/locked.**
7. German v2 published → catalogue serves v2 **only for German**; English/French records and versions untouched.
8. A pre-existing Purchase on the family still grants access across v1→v2 (entitlement unchanged).
9. Rollback → v1 served again, v2 retained.
10. Negative: with a non-admin caller, no unpublished master/clone and no retired/candidate version ever appears in the catalogue, and no protected field is downloadable.

Test data will be clearly-named test records, cleaned up after; real tours are never used as test subjects. Customer-session-dependent steps (a real purchaser's catalogue view) need a real customer login — I'll cover what's automatable and flag precisely what needs a two-minute check on your side.

## 6. Decisions

1. ✅ **Separate `PublishedTour` entity** — approved in principle.
2. ✅ **English published as a snapshot** (master edits stop going live until republished) — approved.
3. ✅ **Publish and rollback restricted to Admins and Super Admins** — approved (the functions gate on AppUser role admin/super_admin).
4. ⏸ **Language cap — NOT implemented, awaiting your definition.** Current fact: the app supports 23 languages *in total* (English included). Publish will validate "a language the app supports" only. Tell me what a cap should count if you still want one.

### Revised implementation sequence (after your go-ahead)

0. Full Walk-record backup export (diffed empty after migration).
1. Entity + `publishTourVersion` / `rollbackTourVersion` / `listTourVersionsAdmin` + shared readiness module.
2. Narrator submission lock in `saveWalkForBackend` (backend-enforced on every save).
3. One-time idempotent migration → per-family table + Walk diff report for your review.
4. Reader cutover with legacy fallback (catalogue, library sync, safety log, clone guard).
5. Admin UI: versions panel, publish/rollback actions, pushback flow.
6. Ten-case end-to-end demonstration on test tours → changed files + results to you before any deploy.