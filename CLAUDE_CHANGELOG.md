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

## 2026-08-03 — PWA install icon swapped, splash screen checked
Scope: `public/manifest.json`, `public/icon-192.png` and
`public/icon-512.png` (new files).

- The PWA install icon (what shows on someone's home screen after
  they install the app) was pointing at an old generic image hosted
  on Base44's media server. Generated proper square versions of the
  real logo (192×192 and 512×512, logo centred on a transparent
  square canvas so it isn't stretched — the source logo isn't square)
  and pointed `manifest.json` at those local files instead.
- Checked the splash screen (`SplashScreen.jsx`) — it turned out not
  to contain the small logo icon at all. It's a full-screen background
  photo (a different, unrelated image), so there was nothing there to
  swap. Left as-is.

**Verified:** `npx vite build` completes with no errors. Confirmed
`manifest.json` is still valid JSON after the edit.

---

## 2026-08-03 — Real logo in the header
Scope: `src/pages/Home.jsx`, `public/explore-crete-logo.png` (new file).

The small icon next to "Explore Crete" was a generic map-pin icon, not
the actual logo. Added the real logo image to `public/` and swapped
it in.

**Not done:** the same generic icon/logo may still appear elsewhere
(splash screen, PWA home-screen icon in `manifest.json`) — only the
main header was reported and fixed this time.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Walks list heading, Free/Paid toggle
Scope: `src/components/walks/WalkList.jsx` (front end),
`src/pages/Admin.jsx` + `src/components/admin/WalkAdminList.jsx`
(admin).

- Front end: "Crete Walks" renamed to "Walks list", small subtitle
  "Purchase to add to your library" added underneath the trail count.
- Scrolling: the list already had a proper scrolling panel
  (`ScrollArea`) — no change needed, it will kick in on its own once
  the list is taller than the panel (already true once there are more
  than ~4-5 walks). Did not add pagination — scrolling was already
  built and working, just not yet visible with only 2 walks on screen.
- Admin Tours list: added a **Free / Paid** toggle button on each row
  (admin only). Flips the walk's `is_sample_walk` flag directly via
  `Walk.update`, no need to open the full editor. "Free" makes the
  walk free to every user (not just members) — matches the "free
  Christmas walk" use case Enda described. `is_member_included` (free
  only to paying annual members) is a separate flag, unchanged, still
  only editable inside the full editor's General tab if ever needed.

**Verified:** `npx vite build` completes with no errors.

**Not done — flagged, not fixed:**
- Enda spotted "Plakias Koules Walk" showing 46.6 km when it's
  actually about 5 km. Checked the display code — it just shows
  `walk.distance_km` exactly as stored, no conversion or calculation
  bug in the display. This means the wrong number is sitting in that
  walk's own data, not a code bug. 46.6 vs the real ~5 km looks a lot
  like a decimal point in the wrong place (4.66 vs 46.6) — worth
  checking whether that's what happened. Fix: open that walk in the
  Admin Panel → Edit → General tab → correct the Distance field →
  Save. No code change involved; I don't have direct access to the
  live database to fix the value myself.

---

## 2026-08-03 — Front end: Refresh button, renamed heading
Scope: `src/pages/Home.jsx`, `src/components/walks/WalkList.jsx`.

- Renamed the front-end header from "Crete Walking Trails" to
  "Explore Crete".
- Added a bright blue "Refresh" button next to "Filters" in the
  "Crete Walks" panel — reloads the walk list from the server on
  demand, same purpose as the Admin Panel Refresh button added
  earlier today. Wired to react-query's `refetch`, which this page
  already had available (`useQuery` on `['walks']`) — no new fetching
  logic needed, just exposed the existing refetch/isFetching to the
  UI.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Bright blue styling for three buttons
Scope: `src/components/admin/WaypointEditor.jsx`,
`src/components/admin/WalkAdminList.jsx`.

Enda said the three buttons added earlier today were too hard to spot.
Changed all three to solid bright blue (`bg-blue-600`, white text):
- "Add waypoint before..." (waypoint editor)
- "Save and Download GPX" (waypoint editor)
- "Refresh" (Tours list)

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Tours list: stop trusting the browser's guess, add Refresh
Scope: Admin Panel → Tours list (`src/pages/Admin.jsx`,
`src/components/admin/WalkAdminList.jsx`).

**The problem Enda hit:** he deleted a walk, the list updated to show
one fewer. He then imported a new tour. The old page reappeared with
3 tours — including the one he'd just deleted. Going back showed 2
again.

**Cause:** the walk list was only ever fetched from the server once,
right when the Admin page first loads. After that, every action
(delete, save) just edited what was already sitting in the browser —
it never checked back with the server to confirm. If the server took
even a moment to actually finish a delete, the browser's local guess
and the server's real state could disagree, and reloading the page
would show whichever one happened to be true at that instant.

**What changed:**
- `handleDelete` in `Admin.jsx` now re-fetches the real list from the
  server straight after a delete, instead of just removing that one
  item from the browser's copy.
- Added a `refreshWalks()` function and wired a **Refresh** button
  onto the Tours list (top right, next to "Tours"). Clicking it
  re-fetches the list from the server on demand, so at any point Enda
  can check what's actually saved rather than relying on the state of
  a tab that's been open a while.

**Why:** gives an honest, checkable answer to "is this actually saved"
instead of the app silently trusting its own memory of what it did.

**Verified:** `npx vite build` completes with no errors.

**Not done / worth knowing for next time:**
- Not tested live — same caveat as prior entries, needs a real check
  in the Base44 app. Worth deleting a tour, immediately hitting
  Refresh, and confirming it's actually gone.
- This doesn't fix any underlying delay on Base44's side (if there is
  one) — it just makes sure the app always shows the truth instead of
  a guess, and gives Enda a way to check on demand.
- Same pattern (local-only state, no re-fetch) exists for `handleSave`
  and `handleMarkChecked` in `Admin.jsx` — not touched this session
  since they weren't reported as a problem, but worth keeping in mind
  if similar confusion turns up around saving or marking tours checked.

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
