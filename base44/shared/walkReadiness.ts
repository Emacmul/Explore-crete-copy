import { SYSTEM_MESSAGE_AUDIO_FIELDS } from './narratorWalkFields.ts';

// Audio-readiness of ONE record (the existing one, the incoming patch, or both merged):
// which audio-triggered waypoints still carry the AI draft narration, and which spoken
// system messages (off-route / GPS / speed alerts) still lack their PCV audio. System
// messages only apply to a driving_audio_tour — a plain walk/hike tour has none of those
// alerts, so it is never blocked by that half of the check.
// A URL the customer's phone could actually fetch and play (2026-09-25 review,
// "publication readiness gap"): a real https URL, not an empty string or arbitrary
// text. The editor resets final_audio_applied whenever a clip changes, which reduces
// accidental cases — but the backend gate itself must not count a waypoint or system
// message as ready on the strength of a flag (or a non-URL string field) alone.
//
// This used to live privately inside saveWalkForBackend; it is shared now so the new
// publishTourVersion function (published-versions plan) enforces the EXACT same
// "could a customer actually play this tour" rule a live save does — one definition,
// so a publish and a live-save can never disagree.
export function isUsableAudioUrl(value: any): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function collectAudioReadinessIssues(record: any) {
  const waypoints = (record && Array.isArray(record.waypoints)) ? record.waypoints : [];
  const notReady = waypoints.filter((wp: any) => wp && wp.trigger_audio && (!wp.final_audio_applied || !isUsableAudioUrl(wp.audio_clip_url)));
  const missingSystemAudio = (record && record.route_type === 'driving_audio_tour')
    ? SYSTEM_MESSAGE_AUDIO_FIELDS.filter((f: string) => !isUsableAudioUrl(record[f]))
    : [];
  return { notReady, missingSystemAudio };
}