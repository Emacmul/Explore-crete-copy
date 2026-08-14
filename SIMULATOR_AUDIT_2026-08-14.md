# Simulator Function — Full Code Audit
Date: 2026-08-14 · Audit only, no code changed.

Files read in full: `TourSimulator.jsx`, `TourSimulatorMap.jsx`, `SegmentScriptEditor.jsx`,
`SegmentScriptManager.jsx`, `ScriptTimingPanel.jsx`, `NarrationTtsEditor.jsx`,
`AudioTriggerFields.jsx`, `DrivingTourWaypointEditor.jsx`, `WalkEditor.jsx`,
`WalkAdminList.jsx`, `BackendShell.jsx`, `AdminStartScreen.jsx`, `Admin.jsx`, `Narr.jsx`,
`AuthContext.jsx`, `base44Client.js`, `app-params.js`, `narrationUtils.js`, `ttsParser.js`,
plus the `Walk`, `User`, `AppUser`, `Narrator` entity schemas and the `narrLogin` /
`getUserRole` backend functions.

Requirements audited against (as you stated them):
1. Simulator accessible to Admins and Narrators only.
2. Simulator for a segment available only once that segment is completely edited.
3. A Narrator can only run the simulator for a WalkAbout/Driving tour they're working on —
   never another one.
4. Admin can run the simulator for any WalkAbout/Driving tour once a segment in it is available.
5. WalkAbout walking speed fixed and non-editable at 3.5 km/h.
6. Driving speed is set by Admin per segment at tour creation; a Narrator cannot edit it.
7. While the simulator runs, the editing Narrator/Admin sees the map and the walker/car
   moving across the segment's route at the set speed.
8. The Narrator/Admin can add/remove/change `<break Xs/>` durations so the audio finishes
   exactly when the simulator reaches the end of the segment.

---

## 0. Headline finding — none of this can be enforced by adding checks to the Simulator alone

Before the specific gaps below: every role/ownership rule in this app today — not just in
the Simulator — is enforced **only in the React UI**, and for Narrators specifically there
is no real backend identity behind that UI at all.

- `base44Client.js` creates the SDK client with `requiresAuth: false`. Admins get a genuine
  Base44 session token via `base44.auth.redirectToLogin()` (Admin.jsx), so their
  `entities.Walk.*` calls carry real identity. **Narrators do not.** `Narr.jsx` /
  `narrLogin` only check a password stored on the `AppUser` row and hand back a bespoke
  `narr_session_token`, kept in `sessionStorage` — it is never attached to the `base44`
  SDK client. So once a Narrator is "logged in," every `base44.entities.Walk.create /
  update / delete / list` call `BackendShell.jsx` makes on their behalf goes out as an
  **anonymous, unauthenticated** Base44 request.
- `base44/entities/Walk.jsonc` has no `rls` (row-level security) block at all. Compare
  `AppUser.jsonc`, which does define one (`update`/`delete` restricted to
  `user_condition: { role: "admin" }`). Nothing equivalent exists for `Walk`, so there is
  currently no server-side rule that could even distinguish "Admin" from "Narrator" from
  "anonymous visitor" for this entity — and because Narrator sessions carry no Base44
  identity anyway, an RLS rule keyed on `user.role` wouldn't see them as narrators even if
  one were added.
- Practical consequence: anyone who opens devtools, points the public `@base44/sdk` at the
  same public `appId` (shipped in the built JS bundle), and calls
  `entities.Walk.update(anyId, {...})` directly can already do everything a Narrator or
  even an Admin can do — change `avg_segment_speed_kmh`, rewrite `segment_scripts`,
  publish/delete tours — with no login at all. This is a pre-existing gap that affects the
  *other* narrator restrictions already in the code too (trail-path lock, one-clone-limit,
  master-vs-clone lock in `BackendShell`'s `onContinueTour`) — it isn't new, but it means
  adding `userRole === 'narrator'` checks inside `TourSimulator.jsx` would only hide
  buttons from a well-behaved browser session. It would not actually stop a narrator (or
  anyone) from calling the SDK directly to start a simulation on someone else's tour,
  change a locked speed, or write to `segment_scripts` on a tour they don't own.
- **Real enforcement needs either:** (a) an `rls` block on `Walk` plus giving Narrators a
  genuine authenticated Base44 identity (not just a client-side flag), or (b) routing all
  Walk writes through a backend function (same pattern as `narrLogin`, `saveAppUserAdmin`,
  etc.) that validates `narr_session_token` server-side and writes via `asServiceRole`
  after checking ownership/role itself. Client-side gating in `TourSimulator.jsx` is still
  worth doing for UX, but should not be treated as the actual security boundary.

---

## 1. Access control: Admin/Narrator-only, and Narrator-owns-their-tour

- `TourSimulator` (and `TourSimulatorMap`) receive **no `userRole` prop at all** today —
  `WalkEditor.jsx` renders `<TourSimulator form={form} .../>` with nothing about who's
  looking at it. There is no code path inside the Simulator that could currently
  distinguish Admin from Narrator, or check ownership, even if you wanted it to.
- That said, reachability is already narrowed upstream: only `admin`/`narrator` roles ever
  reach `BackendShell`/`WalkEditor` in the first place (`Admin.jsx` and `Narr.jsx` both
  gate on role before rendering it), and the Simulator only renders inside the "Preview"
  tab when `isDrivingAudioTour` (WBT or DDV) — so a plain customer, and WHT (Walk/Hike)
  tours, never see it. Requirement 1 is *mostly* satisfied as a side effect of the outer
  flow, modulo the enforcement caveat in section 0.
- Ownership (requirement 3) is *also* mostly inherited for free, but only because of how
  Narrators currently reach a tour at all: in this codebase a Narrator **never opens an
  original/master WalkAbout or Driving tour** — they only ever work inside a *translation
  clone* they created (`clone_of` + `assigned_narrator_email`, one active clone at a time,
  enforced in `BackendShell.handleCloneTour`/`hasActiveClone`). `AdminStartScreen`'s
  Narrator view only ever offers `myClones`/`myActiveClones` to continue. So "the tour
  they're working on" today effectively *means* "their own clone," and that's already
  scoped per-narrator.
  - **Gap:** the check that stops a narrator from opening someone else's tour
    (`userRole === 'narrator' && !unrestricted && !walk.clone_of` in `BackendShell`'s
    `onContinueTour`) exists on exactly **one** of the two paths into `WalkEditor`. The
    other path, `WalkAdminList.jsx`'s `onEdit={(walk) => setEditingWalk(walk)}`
    (wired through `view === 'walks'` in `BackendShell.jsx`), has **no such check** — it
    will open *any* walk in the full list. Today this is harmless only because
    `AdminStartScreen` never renders the "Manage Tours" button in the Narrator branch, so
    `view` can't reach `'walks'` for a narrator through the UI. It's a single point of
    failure, not a real second layer of defense — the code's own comment on the other
    check ("this absence isn't the same as a real guard against it") applies here too, and
    this path currently has no guard of either kind.
  - **Open question for you:** does "a WalkAbout/Driving tour they are working on" mean
    *only* their translation clone (today's only model), or do you also want Narrators to
    be assignable to an **original** WBT/DDV tour (e.g. to record the first-language
    narration before any translation exists)? Nothing in the current schema supports the
    latter — `assigned_narrator_email` is explicitly documented as "owner of *this
    translation clone*," and there's no equivalent field for a master tour. If you want
    Narrators recording original-language segment audio (not just translations), that's a
    new assignment concept that doesn't exist yet, not just a Simulator gate.
- Requirement 4 (Admin sees all WBT/DDV tours once a segment is available) is naturally
  true today since Admin has no ownership filter anywhere — but see requirement 2 below:
  there's currently no "segment available" gate for *anyone*, Admin included.

---

## 2. "Simulator for a segment available only once that segment is completely edited" — not implemented

There is no code anywhere that ties simulator availability to segment completeness.
Concretely:

- `TourSimulator` gates on exactly one thing: `trailPath.length < 2` (shows "No trail path
  available" otherwise). That's it — the moment a trail line with 2+ points exists, the
  full simulator (map, mover, speed controls, and the `SegmentScriptEditor` beneath it) is
  available for **every** segment, including ones with zero waypoints, zero narration
  scripts, and zero combined/finalized/accepted status.
- `segment_scripts[].status` (`draft` / `finalized` / `accepted`) exists and is tracked,
  but it's only used inside `SegmentScriptEditor` to decide which *buttons* to show (Save
  vs Accept vs Upload). It never gates whether the segment can be simulated, nor whether
  its entry even appears — `SegmentScriptEditor`'s dropdown lists every segment with a
  `combined_script`, draft or not.
- There's also no agreed definition of "completely edited" in the data model to gate on —
  candidates would be: every waypoint in the segment has a `narration_script`; the segment
  has been combined (`combined_script` set); it's been through TTS and saved
  (`status === 'finalized'`); or a human has tested and approved it
  (`status === 'accepted'`). Worth deciding explicitly, since the UI and data already
  distinguish these four states but nothing currently reads them for this purpose.

---

## 3. Speed lock-down — not implemented, and the current UI actively works against it

- `TourSimulator` has its own **independent** speed control, wired to nobody's role:
  a toggle to turn "Auto-Speed" off, then preset buttons (`[3, 3.5, 4]` for WBT,
  `[30, 50, 80]` for DDV) *and* a free-text number input with no upper bound
  (`onChange={e => setSpeed(Math.max(0.1, Number(e.target.value) || 0))}` — you can type
  9999). Today, anyone who can open the Simulator — Admin or Narrator — can override the
  speed to anything, for either tour type.
  - For WBT specifically, this contradicts "fixed, non-editable at 3.5" outright: even the
    preset buttons offer 3 and 4, not just 3.5, and the free-text field allows anything.
  - For DDV, `avg_segment_speed_kmh` (the actual per-segment value) **is** correctly
    locked to Admin-only in `DrivingTourWaypointEditor.jsx` (Narrators only ever see
    `NarrationTtsEditor` + `AudioTriggerFields` there, never the speed field) — that part
    already matches your spec. But the Simulator's own manual override sits *on top of*
    that correctly-locked value and lets either role ignore it during a simulation run.
- There's a second, smaller loophole on the Details tab: `default_driving_speed_kmh`
  ("Default Average Driving Speed," described in-app as "used only as a helper value
  until each segment has its own speed") is shown whenever `isDrivingAudioTour` is true,
  with **no `isNarrator` check** — unlike the trail tab, the Details tab isn't hidden from
  Narrators, so they can currently edit this field too.
  - It's also dead: `DrivingTourWaypointEditor.jsx` computes the default speed for new
    waypoints as a hardcoded `tourCategory === 'WBT' ? 3.5 : 50` (line 194) — it never
    reads `form.default_driving_speed_kmh` at all. So this field is captured, saved, and
    (per the finding above) narrator-editable, but not actually consulted anywhere in the
    app. Worth either wiring it up for real or removing it — right now it's a red herring
    for anyone reading the UI copy ("used ... until each segment has its own speed") that
    accurately describes intent but doesn't match what the code does.

---

## 4. Break-tag ↔ simulator-speed sync ("audio must finish when the simulator reaches the end of the segment") — essentially not built

This is the biggest functional gap relative to what you described, and it's a structural
one, not a small bug:

- **Two separate, disconnected audio models exist in this codebase:**
  1. **Per-waypoint** (`wp.narration_script`, `wp.audio_clip_url`, `wp.trigger_radius_m`,
     etc.) — edited by Narrators in `DrivingTourWaypointEditor`, and this is the model
     that's **actually played live**: `DrivingTourPlayer.jsx` (used for both WBT and DDV,
     since both share `route_type: 'driving_audio_tour'`) plays `wp.audio_clip_url`
     directly, triggered by GPS geofence entry per waypoint.
  2. **Per-segment** (`segment_scripts[]`: `combined_script` → edited with break tags in
     `NarrationTtsEditor` inside `SegmentScriptEditor` → `final_script` /
     `final_audio_url` (Google TTS draft) → tested/"accepted" in the Simulator → downloaded
     as .docx for ElevenLabs → `finished_audio_url` uploaded back in. This is the model the
     Simulator's `SegmentScriptEditor` panel is built around.
- **These two never reconnect.** I grepped the whole `src/` tree: `segment_scripts` and
  `finished_audio_url`/`final_audio_url`/`combined_audio_url` are referenced in exactly one
  place outside the admin editor components — `offlineStorage.jsx`, which bundles those
  URLs for offline caching. Neither `DrivingTourPlayer.jsx` nor `WalkDetail.jsx` ever reads
  `segment_scripts` or plays a segment's `finished_audio_url`. So today, the entire
  "combine → edit breaks → draft TTS → simulator-test → accept → download for ElevenLabs →
  upload finished MP3" workflow produces a file that gets downloaded for offline storage
  but is **never actually played to a customer** — the live app keeps playing each
  waypoint's own independently-uploaded `audio_clip_url` regardless. Confirm this is
  intentional (maybe someone manually re-splits the finished segment audio back into
  per-waypoint clips by some process outside this repo?) — as it stands in the code, it's a
  dead end for the finished output, not just a permissions gap.
- **Live sync during playback doesn't exist either.** `TourSimulator`'s own `<audio>`
  element only ever plays `wp.audio_clip_url` when the moving marker enters that waypoint's
  geofence — it has no awareness of `segment_scripts` at all. So even setting the
  disconnect above aside, there's no code today where, as the simulated marker crosses a
  segment, the segment's combined/final/finished audio plays *alongside* the marker's
  movement so you can watch-and-listen for drift. `SegmentScriptEditor` and the map/mover
  are stacked in the same tab, which visually suggests they're linked — they aren't.
- **The break-tag duration editor that does exist is a static estimate, not a live check.**
  `NarrationTtsEditor` (used both per-waypoint and inside `SegmentScriptEditor`) does let
  you insert/adjust `<break time="Xs"/>` tags and, after "Parse & Generate," edit each
  parsed break segment's duration via `TtsSegmentCard` (`ttsParser.js`) — but that's a
  local, ephemeral preview (`segments` state), separate from `ScriptTimingPanel`'s
  travel-vs-narration comparison. `ScriptTimingPanel` estimates narration duration from
  **word count ÷ WPM + sum of `<break>` durations** (`narrationUtils.js`), a formula
  estimate — it does not measure the actual generated/uploaded audio file's real duration,
  and it runs as a static per-segment table, not tied to an actual simulator run. There's
  no feature anywhere that starts the simulator, plays a segment's real audio, and reports
  "audio ended 4s before/after the marker reached the segment end" — which is what
  requirement 8 describes.
- **`trailPath.length`) is the summary of what's needed:** to build requirement 7+8 as
  described, you'd need to (a) decide which audio a "segment" actually means for playback
  purposes — one continuous per-segment track, or the existing sequence of per-waypoint
  clips — since the current live app only supports the latter; (b) wire whichever one is
  chosen into the Simulator's own `<audio>` playback, keyed to segment start/end distance
  rather than individual waypoint geofences; and (c) compare real audio `duration` (from
  the `<audio>` element's `loadedmetadata`, not a WPM estimate) against the simulated
  segment's real travel time, live, while the marker moves.

---

## 5. Smaller issues found along the way

- **"Jump to location" has no concept of segment end.** `locationTargets` in
  `TourSimulator.jsx` is built only from `primary_start` waypoints — there's no equivalent
  for `primary_stop` (segment end), so you can jump to the start of a segment but not
  directly to "the point the audio needs to have finished by."
- **Auto-Speed toggle state isn't persisted.** It's local `useState(true)` — reopening the
  tour, or switching tabs and back (since `WalkEditor` remounts children per tab), resets
  it. Minor, but worth knowing if you're relying on it staying off/on between sessions.
- **`AudioTriggerFields` (radius, bearing, trigger-once) has no role restriction** — a
  Narrator can freely change a waypoint's geofence radius and bearing gating, which affects
  real playback behavior on a live tour. Outside what you asked about specifically, but
  adjacent enough to flag since it's audio-trigger behavior a Narrator can currently change
  without any admin sign-off, similar in spirit to the speed-lock issue.
- **Dead backend function:** `getUserRole/entry.ts` is never called from anywhere in the
  app (`grep` across `src/` and `base44/` returns nothing), and it also checks
  `role === 'narrator'` against the native Base44 `User` entity — whose own schema
  (`User.jsonc`) only allows `enum: ["admin", "user"]`, no `"narrator"`. Harmless (the app
  correctly uses `AppUser.role` for narrator identity everywhere it matters, e.g.
  `Admin.jsx`), but it's dead, internally-inconsistent code worth deleting or fixing so it
  doesn't mislead the next person who reads it.

---

## 6. Suggested priority order (for you to decide on)

1. **Decide the enforcement model** (section 0) before building anything else in the
   Simulator — otherwise every gate we add is UI-only decoration. Minimum viable fix:
   route Walk writes relevant to speed/segment-status/simulator-acceptance through a
   backend function that checks `narr_session_token` + ownership server-side, the same
   pattern `narrLogin` already uses.
2. **Wire a real `userRole` (and, for Narrators, the tour's ownership) into `TourSimulator`
   and `TourSimulatorMap`** so the component itself can gate rather than relying entirely
   on it never being reached by the wrong role.
3. **Lock the speed controls**: remove/disable the manual override for WBT entirely (fixed
   3.5), and for DDV make the Simulator strictly read `avg_segment_speed_kmh` per segment
   with no override UI at all (not even for Admin, per your spec — "cannot be edited" was
   stated without an Admin exception for the *simulator specifically*, only for who's
   allowed to set it in the first place).
4. **Define "segment completely edited"** (pick from: has narration on all its waypoints /
   combined / finalized / accepted) and gate the segment's entry in `SegmentScriptEditor` +
   its simulate-ability on that.
5. **Decide what "the audio" means for a segment during simulation** (continuous per-segment
   track vs. sequence of per-waypoint clips) — this determines whether requirement 8 is a
   Simulator feature or also requires changes to how live tours actually play audio, since
   right now those are two different things.
6. Close the `WalkAdminList` → `onEdit` ownership-check gap, fix or remove the dead
   `default_driving_speed_kmh` field, and delete the unused `getUserRole` function, as
   low-risk cleanup once the above is settled.
