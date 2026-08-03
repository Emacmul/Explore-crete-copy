# Explore Crete App — Change Log (for Claude)

This file tracks every change made to this codebase across chat sessions,
so a new Claude instance can read it and understand what's been done
without redoing work or guessing at context.

Repo source: https://github.com/Emacmul/Explore-crete-copy
Pulled: 2026-08-03

## How to use this file
- Before starting new work, read this whole file first.
- After making any change, add a new dated entry below (newest at top)
  describing what changed, why, and which files were touched.
- Keep entries short and factual — no need for prose, just the facts.

---

## 2026-08-03 — Walk/Hike waypoint editor: "Save and Download GPX" button
Scope: Walk/Hike tours only (route_type = 'walk'). Driving tours and
WalkAbout tours are untouched — they already have their own export panel.

**What changed:**
- `src/lib/routeExport.js` — added a new function `generateWalkGpx(walk)`.
  This is separate from the existing `generateGpx(walk)`, which is built
  for driving audio tours and writes driving-only fields (waypoint_role,
  segment_title, avg_segment_speed_kmh). `generateWalkGpx` writes the
  fields a plain walk/hike waypoint actually has: type, name,
  description, elevation, image_url. Waypoint `<name>` in the GPX is set
  to the waypoint's segment_id (e.g. "MXR3") so the file round-trips
  correctly with the app's existing GPX importer. The admin's free-text
  name/description/type/photo are also written into `<mc:...>` extension
  tags so nothing is lost, even though the importer doesn't read those
  back in yet.
- `src/components/admin/WalkEditor.jsx`:
  - Imported `generateWalkGpx`.
  - `handleSave` now returns `true`/`false` so callers can tell whether
    the save actually went through (previously returned nothing).
  - Added `handleSaveAndDownloadGpx`: calls `handleSave()`, and only if
    that succeeds, builds a GPX from the current form state and
    downloads it via the existing `downloadTextFile` helper. Filename:
    `[Route name]-updated-[YYYY-MM-DD].gpx` (route name is sanitised —
    slashes/colons etc. stripped — since those aren't valid in
    filenames).
  - Added `downloadingGpx` state for the button's loading spinner.
  - Passed `onSaveAndDownload={handleSaveAndDownloadGpx}` and
    `downloadingGpx` down into `<WaypointEditor>` (walk/hike branch
    only, not the driving tour branch).
- `src/components/admin/WaypointEditor.jsx`:
  - Renamed the yellow button from "Save Walk" to "Save Waypoint" — no
    behaviour change, it still saves the whole tour (all waypoints),
    the label was just misleading.
  - Added a new outlined "Save and Download GPX" button directly below
    it, wired to the new `onSaveAndDownload` prop, with its own
    loading spinner via `downloadingGpx`.

**Why:** Enda wanted a way to export a full backup GPX of the amended
route (all waypoint edits — names, descriptions, added/deleted points)
after working on a walk/hike in the waypoint editor, without it being
mixed up with the driving-tour GPX export which serves a different
purpose and data shape.

**Verified:** `npx vite build` completes with no errors after these
changes.

**Not done / worth knowing for next time:**
- The existing GPX importer doesn't read the new `<mc:label>` /
  `<mc:type>` / `<mc:imageUrl>` extension tags back in — only `<name>`
  (→ segment_id) and `<desc>` (→ description) round-trip today. If a
  future task wants full re-import of an exported GPX, the importer in
  `WalkEditor.jsx` (`handleGpxImport`) would need updating to read
  those extension tags too.
- Have not tested this in the actual Base44/browser environment (no
  Base44 dev server available here) — only confirmed it builds
  cleanly. Enda should test the button in the live app before relying
  on it.

---

## 2026-08-03 — Import now reads back name/type/label from an annotated GPX
Scope: Walk/Hike tours only, GPX import (`handleGpxImport` in
`WalkEditor.jsx`).

**What changed:**
- The walk/hike branch of the waypoint importer now reads three optional
  extension tags — `<mc:type>`, `<mc:label>`, `<mc:imageUrl>` — from each
  `<wpt>`, in addition to the `<name>` (→ segment_id) and `<desc>` (→
  description) it already read. If a tag is missing, the old default is
  used, so importing a plain Garmin Explore file (no extensions) behaves
  exactly as before — no regression.
- This closes the gap flagged in the previous entry: a GPX exported by
  "Save and Download GPX" (or hand-annotated using the new template, see
  below) now imports back in with type/name/description already filled
  in, instead of every waypoint defaulting to type "landmark" with a
  blank name.
- Added `waypoint-notes-template.gpx` at the project root — a template
  Enda fills in from his notes before importing, so a route's waypoints
  arrive fully described in one import instead of being edited one by
  one afterwards in the app. Elevation is still left for the app to fill
  in automatically on import, same as today.

**Why:** Enda wants to write up waypoint notes/descriptions ahead of
time and import them in one go, rather than opening each waypoint in
the app and typing them in individually.

**Verified:** `npx vite build` completes with no errors. Confirmed the
template file itself is valid XML and its extension tags parse as
expected (checked with a standalone XML parser, not the live app).

**Not done / worth knowing for next time:**
- Still not tested inside the actual Base44/browser environment — only
  confirmed the build compiles and the template's XML is well-formed.
  Enda should test one real import before trusting it for a live tour.
- The driving-tour and WalkAbout importers are untouched — this only
  affects plain Walk/Hike tours.

---

## 2026-08-03 — Initial pull
- Cloned the repo fresh from GitHub (public repo, pulled via git clone).
- No code changes made yet. This changelog file was created as the
  first step of this session, per Enda's request to track all changes
  going forward.
