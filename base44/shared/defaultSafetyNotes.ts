// Server-side twin of src/lib/defaultSafetyNotes.js — the shared "Before You Set Off"
// safety text shown on every tour that has no tour-specific Safety Notes of its own
// (WalkDetail.jsx falls back to it on the rare record with a blank field; WalkEditor
// pre-fills it into every NEW tour, so it's mostly legacy records that still hit it).
// Kept byte-identical to the client copy so a safety-confirmation snapshot of the
// default text matches exactly what the customer's screen displayed when they tapped
// Confirm (2026-09-25 review, "the log records an empty string while the screen showed
// the default safety text").
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