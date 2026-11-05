// Per Enda (2026-11-05): the pronunciation dictionary does two jobs for a script — it tells
// TRANSLATION which words must survive untranslated (see
// base44/shared/pronunciationProtect.ts), and it is what the ElevenLabs PCV narrator reads
// the names from when recording. So the admin authoring a master script needs to see, on the
// script itself, exactly which words the dictionary already knows — and which ones it is
// still missing. This is the client-side twin of the server matcher, trimmed to those two
// questions.
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

  // Entries for the narration's OWN language are skipped: ordinary English words like "the"
  // are in the dictionary too, and listing them here would bury the names that actually
  // need checking. Foreign names — Anacamptis, Ahmed, a Greek place name — always show.
  const spoken = String(languageName || '').trim().toLowerCase();

  const candidates = entries
    .map((e) => ({
      id: e?.id || '',
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

// Words in the script written in a script OTHER than Latin — Greek, Cyrillic, Hebrew,
// Arabic — that the dictionary does not have yet. These are the ones an admin can spot
// mechanically: a name like "Ἀνάκαμψις" or "Ρέθυμνο" sitting in English text is exactly the
// kind of word the dictionary must carry so it is never translated and the narrator hears
// the right pronunciation. Latin-script names (Italian, French, German) can't be told apart
// from ordinary English words automatically, so those are added by hand from this same panel.
const FOREIGN_SCRIPT_WORD_RE = /[\u0370-\u03FF\u1F00-\u1FFF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF]{2,}/gu;

export function findUnlistedScriptWords(text, entries) {
  if (!text) return [];
  const known = new Set(
    (Array.isArray(entries) ? entries : [])
      .map((e) => String(e?.original_word || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const missing = [];
  for (const m of String(text).matchAll(FOREIGN_SCRIPT_WORD_RE)) {
    const word = m[0];
    if (known.has(word.toLowerCase())) continue;
    if (!missing.includes(word)) missing.push(word);
  }
  return missing;
}