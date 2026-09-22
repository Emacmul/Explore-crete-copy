import { base44 } from '@/api/base44Client';
import { LANGUAGE_CODE_BY_NAME, getGoogleTranslateCode } from '@/lib/i18n';

// Shared helper for the "Translate" button pattern used across a tour's Description,
// Safety Notes, and — per Enda (follow-up 245) — each individual stop's own name and
// short description. Every one of these calls the SAME backend function
// (translateScript, `field` mode) the same way; only which field (and, for a stop,
// which waypointIndex) differs. Centralised here so the auto-translate-on-clone logic
// (BackendShell.jsx), the auto-translate-on-first-view logic (TourSimulator.jsx), and
// the manual "Translate" buttons (WalkEditor.jsx, TourSimulator.jsx) can't drift out of
// sync with each other — one place that builds the call, one place to fix if the shape
// of that call ever needs to change.
//
// Always reads the TRUE MASTER tour's current text for the field server-side (never
// trusts whatever the clone's own box currently holds) — see translateScript/entry.ts.
// Throws a plain Error with a human-readable message on any failure; callers decide for
// themselves whether that should surface to the narrator or fail silently (best-effort).
export async function translateWalkField({ field, walkId, waypointIndex, targetLanguage, apiKeys, authPayload }) {
  const response = await base44.functions.invoke('translateScript', {
    field,
    ...(Number.isInteger(waypointIndex) ? { waypointIndex } : {}),
    walkId,
    target_language: targetLanguage,
    apiKey: apiKeys?.groq_api_key,
    apiKey2: apiKeys?.groq_api_key_2,
    googleApiKey: apiKeys?.google_tts_api_key || undefined,
    target_lang_code: getGoogleTranslateCode(LANGUAGE_CODE_BY_NAME[targetLanguage] || ''),
    ...authPayload,
  });
  if (response?.data?.error) throw new Error(response.data.error);
  const text = response?.data?.translated_text;
  if (!text) throw new Error('Translation returned no text.');
  return text;
}

// True when a clone's own text for a field is STILL exactly the master's original —
// i.e. never translated (auto or by hand) and never even touched. Used both to decide
// whether to auto-fire a translation and to show a plain "not yet translated" warning
// if that auto-translation silently failed (a rate limit, a missing API key, etc.) —
// same check, two uses, so they can never disagree with each other. Empty-on-both-sides
// counts as "nothing to translate", not "untranslated".
export function stillMatchesMaster(cloneText, masterText) {
  const a = (cloneText || '').trim();
  const b = (masterText || '').trim();
  if (!b) return false; // nothing on the master to translate from — not a warning case
  return a === b;
}
