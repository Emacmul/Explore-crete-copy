// Per Enda (2026-11-05): the pronunciation dictionary only ever steered TRANSLATION
// (see base44/shared/pronunciationProtect.ts) — a master tour, which is never translated,
// got no benefit from it at all, and the admin authoring that script had no way of knowing
// which of its names the PCV narrator will find in the dictionary. This is the client-side
// twin of that server matcher, trimmed to just the question the editor asks: which
// dictionary entries actually occur in this script.
//
// Same rules as the server side, deliberately:
//  - whole word only, never a substring ("Reth" must not match inside "Rethymno");
//  - case-insensitive;
//  - Latin entries need 3+ characters, other scripts 2+;
//  - longest entry first, so a multi-word entry ("Agia Roumeli") is reported as itself
//    rather than as its two separate words.
const LATIN_ONLY_RE = /^[A-Za-z\u00C0-\u024F' .-]+$/;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findDictionaryMatches(text, entries, languageName) {
  if (!text || !Array.isArray(entries) || entries.length === 0) return [];

  // Entries for the narration's OWN language are skipped, matching what the audio
  // generator does with them (see base44/shared/dictionaryPronunciation.ts): ordinary
  // English words like "the" are in the dictionary too, and listing them here would bury
  // the names that actually need checking.
  const spoken = String(languageName || '').trim().toLowerCase();

  const candidates = entries
    .map((e) => ({
      word: String(e?.original_word || '').trim(),
      ipa: String(e?.ipa_notation || '').trim(),
      language: String(e?.language_origin || '').trim(),
    }))
    .filter((e) => e.word && (LATIN_ONLY_RE.test(e.word) ? e.word.length >= 3 : e.word.length >= 2))
    .filter((e) => !(spoken && e.language && e.language.toLowerCase() === spoken))
    .sort((a, b) => b.word.length - a.word.length);

  const found = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = c.word.toLowerCase();
    if (seen.has(key)) continue;
    let regex;
    try {
      regex = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(c.word)}(?![\\p{L}\\p{N}])`, 'iu');
    } catch {
      continue; // an entry this browser's regex engine can't express — skip it
    }
    if (!regex.test(text)) continue;
    seen.add(key);
    found.push(c);
  }
  return found;
}