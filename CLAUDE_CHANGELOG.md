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

## 2026-08-04 — Primary/secondary waypoint visibility, audited end to end
Scope: `src/components/walks/DrivingTourPlayer.jsx` (one small fix);
everything else in this entry was checked and confirmed already
correct, not changed.

Traced the full chain for WalkAbout and Driving Tours (both share the
same waypoint role system: primary_start / primary_stop / secondary)
against Enda's rule: secondary and primary-end points must be visible
to narrators/admins, must still trigger their audio for real users,
but must never be visible to a real user.

**Confirmed already correct, no changes:**
- Admin/narrator waypoint editor (`DrivingTourWaypointEditor.jsx`)
  shows every waypoint regardless of role — correct, they need to see
  everything.
- User-facing "Key Points" list (`WalkDetail.jsx`) and the user-facing
  map markers (`WalkDetailMap.jsx`) both already filter to
  `primary_start` only — secondary and primary_stop points are already
  invisible to real users on both surfaces.
- The live, real-world audio-trigger engine
  (`DrivingTourPlayer.jsx`'s `evaluateTriggers`) checks every waypoint
  with `trigger_audio` enabled, with no role filter at all — so a
  secondary waypoint's audio already does fire correctly for a real
  user entering its geofence, exactly as required.
- `ScriptTimingPanel.jsx`'s per-location duration calculation already
  uses a `primary_stop` (or the next `primary_start`) as the segment's
  end boundary — matches "the primary end point is needed to determine
  the length of the audio."

**One small leak found and fixed:** the "triggered waypoints" progress
bar on the real user's live tour screen (`DrivingTourPlayer.jsx`) had
a hover tooltip (`title` attribute) showing each waypoint's internal
`segment_id`/name — including secondary and primary-stop ones that are
supposed to stay invisible. Removed the tooltip; the progress bar
itself (a row of small dots/bars showing how many of the tour's audio
points have fired) stays, just without exposing internal naming.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Confirmed already correct: car icon, per-tour jump, trigger radius
No code changes — checking these off the audit above after Enda asked
about them directly.

- **Red car icon for driving tours**: already correct.
  `TourSimulator.jsx`'s `isWalkingTour = form.tour_category !== 'DDV'`
  already distinguishes on `tour_category` (WBT vs DDV), not the
  shared backend `route_type` both use — so `TourSimulatorMap.jsx`'s
  `moverIcon` already renders `RED_CAR_SVG` (red) for DDV tours.
- **"Jump to location" for driving tours**: the feature added earlier
  today isn't restricted to WalkAbouts — `TourSimulator.jsx` is shared
  by both WBT and DDV, so it already works for driving tours too, no
  change needed.
- **Editable audio trigger radius**: already exists —
  `AudioTriggerFields.jsx` has a "Trigger Radius (m)" number input per
  waypoint (10–2000m, default 30m), and it's also drag-adjustable
  directly on the simulator map (`TourSimulatorMap.jsx`). Relevant to
  Enda's note about GPS trouble in Rethymno's old town — admins can
  already widen the radius on individual problem waypoints there.

---

## 2026-08-04 — WalkAbout module audit: fixed 5 real bugs, added the missing "jump to location" capability
Scope: `src/components/admin/DrivingTourWaypointEditor.jsx`,
`TourSimulator.jsx`, `ScriptTimingPanel.jsx`, `SegmentScriptManager.jsx`,
`NarrationTtsEditor.jsx`. Full audit against Enda's detailed
description of the intended WalkAbout narrator/admin workflow.

**What was already there and working correctly (confirmed, not
touched):**
- Build & Play button for iterative script/audio creation
  (`NarrationTtsEditor.jsx`) — already exists.
- The simulator already shows a walking-man icon (not a car) for
  WalkAbouts, only shows a car for Driving Tours
  (`TourSimulatorMap.jsx`'s `moverIcon`).
- Per-location timing comparison (travel time vs narration time,
  comfortable/close/overrun status, visual bar) already exists in
  `ScriptTimingPanel.jsx`.
- The finalize → accept → export script + audio to admin → admin
  uploads the ElevenLabs/FishAudio MP3 workflow already exists and
  matches what Enda described, in `SegmentScriptEditor.jsx`.

**Bugs found and fixed:**
1. **Walking speed defaulted to 3 km/h, not the specified 3.5 km/h** —
   found in three places that all needed the same fix:
   `DrivingTourWaypointEditor.jsx` (new waypoint / GPX import default),
   `TourSimulator.jsx` (simulator's starting speed), and
   `ScriptTimingPanel.jsx` (silently fell back to 50 km/h — a driving
   speed — for any WalkAbout waypoint without an explicit speed set,
   because it never even knew which tour category it was looking at;
   it now receives that and defaults to 3.5 km/h for WBT).
2. **Speed control always said "Driving Speed" with 30/50/80 presets**,
   even on a WalkAbout — meaningless for someone on foot. Now shows
   "Walking Speed (km/h)" with 3/3.5/4 presets for WBT, unchanged for
   driving tours.
3. **Simulator description text always said "Drive a virtual marker"**
   — now says "Walk" for WalkAbouts.
4. **Combined segment scripts inserted 1-second breaks between
   waypoints, not the specified 0.5s standard** (`SegmentScriptManager.jsx`).
5. **The audio-building tool's saved audio disappeared from view**
   once segments were parsed, and there were no on-screen instructions
   for how to go back and amend it — the exact confusion Enda reported.
   The "Current saved audio" player now stays visible at all times once
   something's been built, with plain instructions: edit the script,
   Parse & Generate, Build & Play again — no need to leave the screen.

**New capability added — not a bug fix, a real gap:** Enda was explicit
that testing one location's audio must not require playing through the
whole WalkAbout first. That capability didn't exist at all — the
simulator always started from the very beginning of the trail with no
way to skip ahead. Added a "Jump to location" control right above the
playback buttons: pick any location from a dropdown (built from the
same primary-start waypoints `ScriptTimingPanel` already uses), click
Jump, and the simulated walker starts right there — every waypoint
before it is marked as already-triggered so earlier audio doesn't
fire again, then Play tests just that location.

**Verified:** `npx vite build` completes with no errors after every
change. Logic for the jump feature was reasoned through carefully
(cumulative distance via nearest trail_path point, matching the same
approach `ScriptTimingPanel` already uses) but not tested against a
real WalkAbout's data — worth Enda trying it on his test walk.

**Flagged, not changed — needs Enda's judgement, not a default I
should silently pick:** every audio trigger's geofence radius
(`trigger_radius_m`) defaults to 30m regardless of tour type. Enda
specifically noted narrow streets and high buildings make Crete's GPS
worse for WalkAbouts. Whether 30m is too large (risk of an adjacent
street's audio triggering early) or too small (risk of GPS drift in
narrow streets missing the trigger entirely) is a real-world judgement
call I can't make from here — flagging it rather than guessing a
"fixed" number.

---

## 2026-08-04 — Walks panel heading now matches the selected tour type
Scope: `src/lib/tourCategories.js`, `src/components/walks/WalkList.jsx`,
`src/pages/Home.jsx`.

Heading always said "All Walks" / "X of Y trails" regardless of
which tour type was selected via "Change tour type" — showed the
same wording for WalkAbouts and Driving Tours too.

**Fix:** added a `pluralLabel` per category in `tourCategories.js`
("Walks" / "WalkAbouts" — capital A intentional, per Enda — /
"Tours"). `Home.jsx` now passes the selected category code down to
`WalkList`, which builds the heading and count from it: "All Walks" /
"X of Y Walks", "All WalkAbouts" / "X of Y WalkAbouts", "All Tours" /
"X of Y Tours" — the count itself already reflected the real number
in the system, only the wording was static.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Reached-waypoint ticks now clear themselves between separate walks
Scope: `src/components/walks/WalkDetail.jsx`. Follows on from the
reached-waypoint tracking feature above.

Anoushka's QA feedback: repeat walkers (flower enthusiasts especially,
who might do the same walk 3-4 times a month) need a clean slate each
time — the ticked/greyed waypoints from a previous walk shouldn't
carry over.

**Considered and rejected:** clearing on app close. Rejected because
a phone call or app-switch mid-hike also "closes" the app briefly, and
that would wipe a walker's progress while they're still mid-route —
the opposite of what this feature is for.

**What was built instead:** the saved progress now carries a
timestamp. If a walk is reopened more than 18 hours after the last
tick, it's treated as a new attempt and starts empty — old data is
discarded automatically. 18 hours is generous enough to cover even a
very long single day-hike without accidentally clearing mid-walk, but
guarantees anyone repeating the walk another day gets a genuinely
clean start. The manual "Reset progress" link from the original
feature is still there too, for anyone who wants to clear it
immediately rather than wait.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Admin button gating, re-applied correctly
Scope: `src/pages/Home.jsx`.

Re-applies the previous entry's intent, this time only using what's
actually confirmed to work:
- Enda found his `AppUser` record had no `role` set at all — that's
  why the first attempt failed for him too. He's since set it to
  `admin` himself in Base44's Data section, and confirmed the button
  now needs the `AppUser` lookup to work at all — verified indirectly:
  the front end already correctly skips his registration screen (which
  depends on that same `AppUser.filter({ user_id: user.id })` lookup
  succeeding), so the lookup mechanism itself is sound.
- The check now ONLY reads `appUsers[0].role` — the broken
  `user.role === 'admin'` check (which assumed Base44-native auth
  fields that don't exist under the WordPress login) has been dropped
  entirely, not just bypassed.

**⚠️ Before trusting this:** Anoushka and any narrator accounts also
need an `AppUser` record with `role` set to `admin` or `narrator` —
otherwise they'll lose the Admin button the same way Enda did. Worth
Enda checking each staff account's `AppUser.role` field is actually
set before this goes live to anyone but him.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — REVERTED: Admin button gating locked Enda out
Scope: `src/pages/Home.jsx`. Undoes the previous entry below.

**What happened:** the previous change (gating the Admin button behind
an admin/narrator check) broke immediately — Enda logged in as an
actual admin and the button was gone for him too, even after logging
out and back in.

**Root cause — my mistake:** I copied `Admin.jsx`'s role-check logic
into `Home.jsx` without checking that the two pages use **two
completely different login systems**:
- `Admin.jsx` checks `base44.auth.me()` — Base44's own native login.
- `Home.jsx` uses `useAuth()` from `AuthContext.jsx` — a WordPress-
  based JWT login (`wpLogin`), added as part of migrating away from
  Base44's native auth. The user object this produces is just
  `{ id, email, full_name, display_name, username }` — **it has no
  `role` field at all.**

So `user.role === 'admin'` was checking a field that doesn't exist on
this login path, and just silently evaluated false for everyone,
including real admins. It fell back to checking an `AppUser` record's
`role` field, which may not be set up the same way under the WordPress
login — not something I verified before shipping it. Classic case of
assuming two similar-looking pieces of code shared a data shape they
didn't.

**Fix applied:** reverted `Home.jsx` back to always showing the Admin
button, exactly as it was before that change — nobody is locked out.
The original problem (regular walkers seeing an Admin button they
have no use for) is back too, but that's a cosmetic annoyance, not a
lockout — far better to have that than risk this again.

**Properly fixing the original cosmetic issue needs answers first,
not another guess:**
1. Does Enda's account actually have an `AppUser` record, and does its
   `role` field say "admin"? (This can only be checked by looking at
   the actual Base44 data — not something visible from this repo.)
2. Is the WordPress JWT `user.id` used to look up that `AppUser`
   record (`user_id: user.id`) reliably the same value the `AppUser`
   record itself is keyed on? If the two authentication systems don't
   share user IDs consistently, this lookup could silently fail even
   with a correctly-configured `AppUser` record.

Do not re-attempt gating this button by guessing again — confirm both
of those with Enda (or by inspecting the live Base44 data) first.

**Verified:** `npx vite build` completes with no errors after the
revert.

---

## 2026-08-04 — "Admin" button hidden from regular users
Scope: `src/pages/Home.jsx`.

The Admin button in the front-end header was showing to every logged-
in user, not just staff — Enda pointed out it would confuse regular
walkers, none of whom have any reason to see it.

**Fix:** added the same admin/narrator check `Admin.jsx` itself
already uses to decide who's allowed in (Base44's own `role ===
'admin'`, or an `AppUser` record with `role` of `admin`/`narrator`).
The button now only renders for staff. Reused the `AppUser` lookup
Home.jsx was already doing for registration status, rather than adding
a second network call.

Enda, Anoushka, and any narrator accounts still see the button as
normal — this only hides it from ordinary walker accounts.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Route line was being destroyed on every waypoint edit
Scope: `src/components/admin/WalkEditor.jsx` (Walk/Hike only).

**Enda's report:** the preview map draws a straight line between two
points instead of following the actual track/road.

**Cause — real bug, not a display setting:** the route line on the
map comes from `trail_path`, a dense set of GPS points recorded on
the ground (from the eTrex), separate from the sparse named
`waypoints`. But every time waypoints were edited (add, delete, rename,
add a description — anything), the code was overwriting `trail_path`
with just straight lines between the current waypoints, throwing away
the real recorded curve. This wasn't something I introduced this
session — it was already in the code, just never surfaced until a
walk with waypoints far enough apart to make the straight-line cutting
visible.

**Fix:** waypoint edits now only update the waypoint markers.
`trail_path` (the line itself) is left alone — it's only ever set at
GPX import, or by the dedicated trail-path map editor tool elsewhere
in the same screen. Editing the waypoint list can no longer touch it.

**⚠️ Already-affected walks — need Enda's attention, not something I
can fix in code:** this bug has been live the whole time, so **any
walk that's already had a waypoint added/deleted/edited may have
already lost its real track line**, replaced with straight segments.
The only way to restore it is to re-import that walk's GPX — but
re-importing replaces the whole waypoint list wholesale, which would
also wipe out any descriptions typed in since the last import, unless
the file being re-imported already has those descriptions baked in via
the `<mc:type>`/`<mc:label>`/`<desc>` tags (i.e. a file from "Save and
Download GPX", or one built with `waypoint-gpx-builder.html` — not a
plain fresh Garmin export). Enda needs to check each walk himself and
decide the safest source file to re-import per walk; this isn't
something to fix by re-running an import blindly.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Reached-waypoint tracking, for getting lost on long routes
Scope: `src/components/walks/WalkDetail.jsx` (Walk/Hike only, not
driving tours).

Anoushka's QA feedback: some routes have 50-60 waypoints, and a walker
who loses the trail in unfamiliar mountain terrain has no way to tell
which point they last recognised. Enda suggested two options —
auto-highlight the last point reached, or a tick-box that greys out
passed points. Implemented both together, since Crete's mountain GPS
is known to be unreliable (per Enda's own earlier notes on why this
app is Crete-specific) — manual ticking works with zero signal,
automatic detection is a convenience layered on top when GPS does
work.

**What changed:**
- Each waypoint in the "Key Points" list now has a tappable circle.
  Tapping it marks that point "reached" — greys it out, strikes
  through its name, shows a checkmark.
- Whichever reached waypoint is furthest along the route gets a
  distinct blue highlight and a "You were last here" badge — this is
  the point a lost walker should be able to find their way back to.
- If the device has GPS, any waypoint the walker's actual location
  comes within ~60m of gets ticked automatically. This only ever adds
  ticks, never removes one — a manual tap always wins over GPS, so an
  inaccurate GPS reading can't undo a walker's own correction.
- Progress is saved to the device (not the server) per walk, so it
  survives closing and reopening the app mid-walk. A small "Reset
  progress" link appears once anything's been ticked.
- Driving tours are untouched — they navigate by audio, this feature
  only applies to Walk/Hike.

**Bug caught and fixed before shipping:** my first pass put the new
`useState`/`useEffect` hooks after the existing `if (!walk) return
null;` early-return line. That breaks React's rule that hooks must run
in the same order on every render — moved the early return to after
all hooks are declared instead.

**Verified:** `npx vite build` completes with no errors.

**Not done:** not tested on an actual phone with real GPS movement —
only confirmed it builds and the logic reads correctly. Worth Enda
walking a short real route with it once live to confirm the ~60m
proximity feels right (too tight and it won't trigger on a winding
mountain path; too loose and adjacent waypoints could tick together).

---

## 2026-08-04 — "WHT Change" renamed to "Change tour type"
Scope: `src/pages/Home.jsx`.

The 3-letter tour category code (e.g. "WHT") plus "Change" was too
cryptic — Enda said even he had to click it to remember what it did.
Replaced with a plain "Change tour type" label (shortened to "Change"
on small phone screens, full text on larger ones). Code no longer
shown on the button at all.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-04 — Payment/purchase gating: architecture clarified, on hold
No code changed this entry — flagging a decision for future sessions.

Following on from the "My Library has no purchase check" finding above:
Enda clarified the intended architecture. He's choosing between Paddle
and Creamie as Merchant of Record this week (meetings with both). Key
point either way: **the app itself should not build its own purchase/
entitlement system.** The MoR handles sales and pricing entirely on
their end — the app's job is just to link out to whichever MoR's
checkout for that product. No internal "purchases" table/flag to
maintain, no in-app pricing logic to keep in sync.

This also fits what's already in `/areas/payment-processor.md`
(persistent memory, not this repo): 15-minute expiring download links,
no persistent "owns this" state, voucher system being scrapped.
Suggests the eventual flow is closer to: user clicks Buy → sent to
Paddle/Creamie checkout → on success, some kind of redirect or webhook
back → app hands over a short-lived download link — rather than a
login-gated permanent library entry.

**Do not build a purchase/entitlement system in this codebase** until
Enda has picked Paddle or Creamie — the exact mechanics (checkout
links, webhook format, how success gets communicated back to the app)
are provider-specific and unknown until then. `membership.js`'s
current pricing rules (€15/walk, €75/year, 5 free samples, 6
free/year for members) are also known to be **outdated** — he'd
already decided on a different pricing model in an earlier session
(app free with 5 included, €24.99/product except €12.50 for plain
walking tours, €75/year membership with 25% discount, no voucher
codes) which was never implemented in code. Don't treat
`membership.js` as current truth for pricing without checking with
him first.

---

## 2026-08-03 — "My Library" was empty because the real Download button was never placed anywhere
Scope: `src/components/walks/WalkDetail.jsx`,
`src/components/walks/DownloadButton.jsx`, `src/pages/MyWalks.jsx`.

**Enda's report:** "My Library" shows "No walks downloaded yet — tap
Download on any walk" but no such button exists anywhere he can find.

**Cause:** two entirely separate components both dealt with
"downloading" a walk:
- `DownloadWalkButton` (in `offline/`) — downloads the raw GPX file
  to the visitor's computer. This one WAS on screen (in `WalkDetail`),
  and has nothing to do with "My Library".
- `DownloadButton` (in `walks/`) — the one that actually calls
  `useOfflineWalks().downloadWalk()` to save a walk into "My Library"
  for offline use. Fully built and working, but never imported or
  rendered anywhere in the app — dead code with no way for any user,
  not just Enda, to ever reach it. This is why "My Library" could
  never contain anything.

**Fix:**
- `WalkDetail.jsx` now renders both buttons side by side — save to
  My Library, and separately download the raw GPX file.
- Renamed the My-Library button's label from the ambiguous "Download"
  to "Save for Offline" (and its saved-state label from "Downloaded"
  to "Saved Offline"), so it reads clearly next to "Download GPX".
- Updated the "My Library" empty-state text to match the real button
  wording ("tap 'Save for Offline'...").

**Verified:** `npx vite build` completes with no errors.

**Not done:** haven't tested the actual save/remove/offline-viewing
flow live — only confirmed the button is now present and wired to the
existing `downloadWalk`/`removeWalk`/`isDownloaded` functions, which
were already implemented and presumably already tested when they were
first written (just never reachable). Worth Enda trying a full
save → close app → reopen offline cycle once live.

---

## 2026-08-03 — GPX Builder: fixed wrong route name auto-fill
Scope: `waypoint-gpx-builder.html`.

**Bug:** loading a plain Garmin Explore export auto-filled the Route
Name box with "MRX25" — a waypoint's own code, not a route name.
Cause: the "pick up an existing route name" check searched the whole
document for any `<name>` tag and grabbed the first one it found,
which on a plain export is just whichever waypoint happens to come
first in the file — not a real route name at all.

**Fix:** now only looks for a route name inside a proper `<metadata>`
block, which is where this tool (and the app's own GPX export) always
puts it. A plain Garmin export has no `<metadata>` block, so the
Route Name box now correctly starts blank, ready for Enda to type the
real name — only auto-fills when re-loading a file that was already
named by this tool or the app.

**Verified:** tested both cases directly in Node — a plain export
(no metadata) → blank; a re-loaded file with a real `<metadata><name>`
→ correctly picked up.

---

## 2026-08-03 — Standalone Waypoint GPX Builder tool
New file: `waypoint-gpx-builder.html` (project root). Not part of the
app itself — a separate, self-contained tool Enda runs on his own
computer by just double-clicking it (opens in any browser, no
install, no internet needed, works completely offline).

**Why:** replaces the manual `waypoint-notes-template.gpx` approach
from earlier (hand-editing raw XML tags) — Enda wanted something that
does the merging for him instead of him having to get the tags right
by hand every time, since that's slow and easy to get wrong at volume
(he mentioned ~8 walks already waiting to be imported).

**How it works:**
1. Enda loads the plain GPX he already exports from Garmin Explore
   (just raw points, no descriptions).
2. The tool shows one card per waypoint, in the same order the app
   itself would sort them into, with plain form fields: Description,
   Type (dropdown — same fixed list as `WAYPOINT_TYPES` in
   `WaypointEditor.jsx`, kept in sync by hand, noted in a comment),
   and an optional Label.
3. "Download finished GPX" produces a file in exactly the format the
   app's importer expects — same `<name>`/`<desc>`/`<mc:type>`/
   `<mc:label>` tags as `generateWalkGpx` in `routeExport.js` and the
   updated `handleGpxImport`. That file imports straight into Explore
   Crete, fully described, elevation still auto-filled by the app on
   import as always.
- Progress autosaves in the browser as he types (keyed by the route
  name he enters), so closing the tab mid-way doesn't lose work. Also
  supports re-loading a file it made earlier (or one exported by the
  app itself) to keep editing it.
- Warns before closing the tab if there are still blank descriptions.

**Verified:** extracted the core parse/build logic and round-trip
tested it in Node against a sample matching Enda's real Garmin export
(including the "MRX25" vs "MXR..." naming inconsistency already
present in his data) — parses, sorts, fills in notes, generates GPX,
and re-parses correctly, matching what the app's own importer expects.
Not tested inside an actual browser or against the live app import —
worth Enda trying one small file through the full round trip first.

---

## 2026-08-03 — Elevation Gain also now recalculates on every Save
Scope: `src/components/admin/WalkEditor.jsx` (Walk/Hike tours only).
Follows directly from the Distance fix above.

Enda decided Elevation Gain needs the same automatic fix as Distance,
since walkers with health/physical conditions rely on it to judge
whether a route is safe for them — leaving it stale after an edit
isn't acceptable the way it might be for other fields.

**What changed:** `handleSave` now refetches real elevation heights
for the current trail line (same Open Topo Data service used at
import) and recalculates Elevation Gain fresh, every time Save is
clicked. Unlike Distance, this needs a network call — heights aren't
stored anywhere between saves. If that call fails, the save still goes
through with the previous figure (doesn't block the admin's work), but
they get a clear warning afterwards: "Saved, but Elevation Gain could
not be re-checked... please check it manually before this route goes
live." On-screen Elevation Gain field updates to match after a
successful recalculation, same as Distance.

**Trade-off, accepted deliberately:** Save is now slightly slower on
Walk/Hike tours (one extra network round-trip). Judged worth it given
the safety reasoning above.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — Distance now recalculates automatically on every Save
Scope: `src/components/admin/WalkEditor.jsx` (Walk/Hike tours only).

**The bug:** Plakias Koules Walk showed 46.6 km because of a rogue
waypoint in the GPX. Enda removed that waypoint — the GPX export and
the map preview both updated correctly, but the Distance number stayed
wrong. Root cause: Distance was only ever calculated once, at the
moment a GPX file gets imported. Any edit after that (adding/removing
a waypoint, fixing a bad point, re-routing) changes the route but
never re-runs that calculation, so whatever number was set at import
just sits there, right or wrong, forever.

**Fix:** `handleSave` now recalculates Distance fresh from the current
trail line every time Save is clicked (Walk/Hike tours only — driving
tours untouched). Pure distance math from the waypoints' coordinates,
no network call, so it's fast and can't fail. The on-screen Distance
field also updates to match right after a successful save, not just
what gets sent to the server.

**Verified:** `npx vite build` completes with no errors.

**Flagged, not fixed — needs a decision:**
Elevation Gain has the exact same staleness risk (also only ever
calculated once, at import) but I did **not** make it auto-recalculate
too, because doing so isn't free the way distance is: unlike distance,
Elevation Gain needs a height value for every point on the trail, and
those heights aren't stored anywhere in the route data — they only
ever existed briefly during import, fetched from an external elevation
service (Open Topo Data), then discarded. Recalculating it on every
save would mean firing that same network request to Open Topo Data
every single time Save is clicked, which would make Save noticeably
slower, and would leave the elevation figure blank or wrong if that
external service is ever briefly down. Wanted to flag that trade-off
rather than decide it for him. If Enda wants Elevation Gain kept in
sync the same way, this is the natural next step: /areas/explore-
crete-app.md and this changelog both need updating once decided.

---

## 2026-08-03 — Full sweep for old app name / generic logo
Enda asked that from now on, any text or logo change request means
checking for and fixing every occurrence, not just the one spot shown.
Did a full search of the codebase for the old name and the generic
icon-box pattern and found two more spots that hadn't been caught:

- `src/components/onboarding/RegistrationForm.jsx` — still said
  "Welcome to Crete Walking Trails" (old app name), and had the same
  generic MapPin-in-a-box brand icon. Both fixed: text now "Welcome to
  Explore Crete", icon now the real logo.
- `src/components/walks/TourCategoryPicker.jsx` — the "Choose Your
  Tour Type" screen had the same generic MapPin brand-icon box above
  its heading. Fixed to the real logo. Left the *other* MapPin/
  Footprints/Car icons on this screen alone — those are functional,
  one per tour category (Walk/Hike, WalkAbout, Driving), not branding.
- Confirmed `index.html` and `manifest.json`'s `name`/`short_name`
  already said "Explore Crete" — no change needed there.

**Verified:** `npx vite build` completes with no errors.

---

## 2026-08-03 — "All Walks" heading + real logo on the walks panel
Scope: `src/components/walks/WalkList.jsx`.

- Heading changed from "Walks list" to "All Walks" (Anoushka's
  feedback — "Walks list" read wrong).
- The amber mountain-icon box next to that heading was replaced with
  the real Explore Crete logo (same file already added to `public/`
  for the main header).

**Verified:** `npx vite build` completes with no errors.

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
