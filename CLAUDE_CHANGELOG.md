# Claude Changelog — Explore Crete

This file is kept in the project root so any new Claude chat can read it and
pick up where the last one left off. Newest entries at the top.

---

## 2026-08-07 — Full audit of WalkAbout + Driving Tours modules

**No prior changelog existed in this repo** (`Emacmul/ExploreCrete`, pulled
via the GitHub API/`git clone`). This is the first entry. If you were
expecting notes from earlier work, they weren't in this repo — either they
live somewhere else or this is genuinely the first pass on this codebase.

### Scope of this audit
Read every file in the WalkAbout and Driving Tours code paths end to end,
traced how data flows from GPX/FIT import → waypoint editing → narration/TTS
→ the simulator → export → the live customer-facing player, and checked the
admin side (roles, permissions, every button) against what the code actually
does. Confirmed the whole app still builds cleanly (`npm run build`) after
every fix below.

### Bugs found and fixed

1. **Finished ElevenLabs audio never actually reached the tour.**
   `SegmentScriptEditor.jsx` lets you upload the final ElevenLabs MP3 for a
   segment ("Step 2: Upload Finished Audio") and describes it as *"the audio
   users will hear during the tour"* — but it only wrote that URL onto
   `segment_scripts[].finished_audio_url`. Neither the live tour player
   (`DrivingTourPlayer.jsx`) nor the simulator (`TourSimulator.jsx`) ever
   read that field — both only ever look at each **waypoint's**
   `audio_clip_url` / `trigger_audio`. So the entire segment-script →
   ElevenLabs → "accept & upload" workflow had no effect on what customers
   actually heard. **Fixed** in `TourSimulator.jsx`: whenever a segment's
   `finished_audio_url` changes, it's now propagated onto that segment's
   Primary-Start waypoint (`audio_clip_url` + `trigger_audio: true`), which
   is the field the player and simulator both actually use.
   ⚠️ **Action needed on your end:** any tours where you already went
   through this upload step will have finished audio sitting unused on
   `segment_scripts` with nothing on the waypoint. Re-open those segments in
   the Simulator's Segment Script Editor and re-save (or just re-select and
   confirm) so the fix can sync them across — I can write a one-off script
   to backfill existing data if you want, rather than doing it by hand per
   tour.

2. **GPX import never created a Primary-Stop waypoint.** Both import paths
   (Details tab in `WalkEditor.jsx`, and the Waypoints tab's own importer in
   `DrivingTourWaypointEditor.jsx`) only recognised the `-PS` / letter-`a`
   naming convention for Primary-Start. Every other imported point — including
   the very last one, which is always the tour's actual end — came in as
   plain "Secondary," so it had to be manually reclassified to Primary-Stop
   after every single import. **Fixed:** both importers now default the last
   imported waypoint to Primary-Stop automatically (unless one is already
   present in the file, or the tour only has one point). You can still
   change it by hand afterward if a different point should be the stop.

3. **Trigger-radius default mismatch between testing and the real tour
   (four separate spots).** Several places fell back to different default
   geofence radii when a waypoint had no explicit `trigger_radius_m`:
   the Simulator and the map's drag-handles used **30m**, the live
   `DrivingTourPlayer` used **150m** (matching the entity schema's own
   default). A waypoint imported or created without an explicit radius would
   therefore test fine in the Simulator at 30m and then behave completely
   differently — a much wider 150m trigger zone — on a real tour. Fixed all
   four spots (`TourSimulator.jsx`, `TourSimulatorMap.jsx`,
   `AudioTriggerFields.jsx`, and the admin's own radius field in
   `DrivingTourWaypointEditor.jsx`) to consistently default to 150m.

4. **Map drag-handles could edit the wrong waypoint.** In the Simulator map,
   dragging the bearing arrow or radius handle called `onWaypointUpdate(i, …)`
   using the index from a locally *filtered* waypoint list (waypoints missing
   lat/lng dropped), but the parent's update handler expects an index into the
   full, unfiltered waypoint array. Any tour with even one waypoint missing
   coordinates would have silently updated the wrong waypoint's bearing or
   radius. Fixed by resolving the real index by object identity before calling
   `onWaypointUpdate`.

5. **Export panel claimed "Route validated — ready to export" before any
   validation had run.** `DrivingTourExportPanel.jsx` initialised its error
   list to empty and used that to show a green "ready to export" checkmark
   immediately on load — before the Export button had ever been clicked, so
   it was misleadingly showing "valid" for tours that hadn't been checked
   yet (and might not be valid). Fixed to run validation automatically
   whenever the route data changes, and to only show the green state once a
   real check has actually happened.

6. **Missing narrator dropdown used an invalid value.** The "Use default
   rate" option in the Script Timing panel's narrator picker was
   `<SelectItem value={null}>`, which isn't a valid value for that control.
   Replaced with a proper sentinel value so the option reliably works.

7. **Adding a custom narrator language silently produced English audio.**
   The Script Timing panel invites you to type a new language name for a
   narrator ("it will appear in all dropdowns going forward") but the
   Narration/TTS tool's language list is a separate, fixed 14-language list —
   a newly typed language never appeared there, and if picked anyway, the
   TTS call silently fell back to English with no warning. Fixed: the TTS
   tool now blocks generation and shows a clear message instead of silently
   generating in the wrong language, and the help text in Script Timing no
   longer over-promises.

8. **Admin had no way to see or turn off a waypoint's audio trigger.** In
   the admin (non-narrator) waypoint editor, `trigger_audio` could only ever
   be turned *on*, automatically, as a side effect of generating/attaching
   audio — there was no visible toggle, and no way to turn it back off short
   of deleting the audio clip. Added an explicit Trigger Audio switch next
   to the radius/bearing fields, plus a warning if it's on with no audio
   attached yet.

9. **Wake-lock "release" didn't notify listeners, contradicting its own
   documented contract.** `wakeLockService.release()`'s doc comment says
   release listeners fire "either by the browser... or by release()" but the
   code only actually notified them on the *browser-initiated* path. Not
   currently causing a visible bug (the one consumer manages its own state
   independently), but it's a landmine for the next thing that uses this
   service. Fixed to match the documented contract.

### Confirmed correct / intentional (checked, not changed)

- End users seeing only Primary-Start waypoints (never Primary-Stop or
  Secondary) on the map and in "Tour Stops" for driving tours — this matches
  what you told me directly, so I left it alone. Worth knowing: the code in
  both `WalkDetail.jsx` and `WalkDetailMap.jsx` still has full styling
  defined for a "Stop" marker that can now never actually render, because
  waypoints get filtered down to Primary-Start only before that display
  code ever runs. If you ever want customers to see where a driving tour
  physically ends, that styling is already there and ready to use — just say
  the word.
- The "Test Location in Simulator" dialog (opened from a location's row in
  the Waypoints tab) intentionally doesn't wire up the Segment Script
  Editor — it's scoped for testing audio triggers on a location's own
  waypoints, not for the full segment-script/ElevenLabs workflow. Not a bug,
  just a narrower tool than the main Simulator.

### Worth a look, not changed (judgment calls, flagging for you)

- **"Email all members" has no confirmation step** in `WalkAdminList.jsx` —
  one misclick sends an email to every member immediately. Easy to add a
  confirm dialog (same pattern as the delete-tour dialog right next to it)
  if you'd like that safety net.
- **Pausing a live driving tour doesn't stop audio already playing** — it
  only stops *new* triggers from firing; a clip that's already started
  keeps playing to the end. Might be intentional (don't cut off mid-sentence)
  or might not be what you want — flagging rather than guessing.
- Dead/unreachable `walk.gpx_url` fallback in `WalksDashboard.jsx` and
  `DownloadWalkButton.jsx` — harmless (the real field, `gpx_file_uri`, is
  always checked first) but `gpx_url` doesn't exist on the Walk entity at
  all, only on `VoucherCode`. Left alone since it's inert, but worth
  deleting next time you're in either file.
- Left the console.log/console.warn/console.error statements sprinkled
  through `WalkEditor.jsx`'s FIT-import code as-is — they look like active
  debugging aids for a still-fragile import path (lots of alternate-location
  fallbacks for course points), not leftover cruft. Say the word if you'd
  like them stripped for the next release build.

### Files touched this pass
`src/components/admin/WalkEditor.jsx`,
`src/components/admin/DrivingTourWaypointEditor.jsx`,
`src/components/admin/TourSimulator.jsx`,
`src/components/admin/TourSimulatorMap.jsx`,
`src/components/admin/ScriptTimingPanel.jsx`,
`src/components/admin/DrivingTourExportPanel.jsx`,
`src/components/admin/NarrationTtsEditor.jsx`,
`src/components/admin/AudioTriggerFields.jsx`,
`src/lib/wakeLockService.js`

### Not yet audited this pass
End-user pages/flows I read and found clean but didn't need to touch:
`WalkList.jsx`, `WalkCard.jsx`, `WalkDetail.jsx`, `WalkDetailMap.jsx`,
`DrivingModeNotice.jsx`, `DrivingTourPlayer.jsx`, `TourDebugLog.jsx`,
`TourSimulatorMap.jsx` (map rendering), `gpsService.js`, `audioService.js`,
`tourLogService.js`, `WalkAdminList.jsx`, `WalksDashboard.jsx`,
`AdminStartScreen.jsx`, `Admin.jsx`, `routeExport.js`, `narrationUtils.js`.

Not yet opened at all: `VoucherManager.jsx`, `UsersManager.jsx`,
`MembershipCodeEntry.jsx`, `WandererUpsellSplash.jsx`, `RegistrationForm.jsx`,
`SplashScreen.jsx`, offline-sync code (`offlineStorageService.js`,
`useOfflineWalks.jsx`, `OfflineWalksBanner.jsx`), `Home.jsx`, `Login.jsx`,
`MyWalks.jsx`, `MyRecordedWalks.jsx`, and the backend `base44/functions/`
folder (GPX/FIT parsing on the server side, TTS/translation functions,
email, sync). If you want the audit to continue into those, next session
should start there.
