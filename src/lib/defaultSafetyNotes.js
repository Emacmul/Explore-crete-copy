// The general "Before You Set Off" safety list shown on every Walk, WalkAbout and
// DriveAbout, per Enda's follow-up 190 request. Tour-specific safety measures are added
// on top of this, by hand, when a particular tour needs them (e.g. exposed cliff edges,
// unmarked terrain) — this text is only ever the shared starting point.
//
// Used in two places, both frontend-only:
//   - WalkEditor.jsx's EMPTY_WALK: pre-fills the Safety Notes box for every brand-new
//     tour, so it's real, visible, editable content from the moment a tour is created —
//     not an invisible fallback nobody ever sees or edits.
//   - i18n/index.js's 'detail.defaultSafetyNotes': the last-resort text WalkDetail.jsx
//     shows a customer on the rare tour that somehow still has a blank Safety Notes
//     field (e.g. a record from before this existed, never resaved since).
//
// Per Enda: downloading the tour isn't just good advice, it's compulsory — the Start
// button is disabled until it's done (see WalkDetail.jsx/DrivingTourPlayer.jsx's
// canStart) — so this says so plainly, not just "recommended".
export const DEFAULT_SAFETY_NOTES = `Wear sturdy, closed shoes with good grip — even on WalkAbouts in town.

Carry a minimum of 2 litres of water per person, especially between May and September.

Check the weather before you set off, and turn back if it worsens.

You must download the tour before you go. Mobile signal is unreliable in many parts of Crete, and the tour will not start without it.

GPS signal can also be weak in Crete's mountains — this is separate from your phone signal, and downloading the tour doesn't fix it. If GPS drops out, narration may be delayed until it returns; once you've started, you can use the manual "Play" button on each stop to keep going in the meantime. If you're ever unsure of the route, stop safely and wait.

Tell someone your planned route and when you expect to be back.

Take extra care on uneven ground, near cliffs, and on wet or loose stone.

On DriveAbouts, never check your phone while driving — pull over safely first. Cretan roads are often narrow and winding, so drive to the conditions, not the speed limit.

In an emergency, call 112 — the EU-wide number, works from any phone, even off your own network.

Under Greek law, the cost of any search and rescue operation is charged to the individual. Do not set off unprepared.`;
