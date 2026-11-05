// Per Enda (2026-11-05): the pronunciation dictionary does two jobs for a script — it tells
// TRANSLATION which words must survive untranslated (see
// base44/shared/pronunciationProtect.ts), and it is what the ElevenLabs PCV narrator reads
// the names from when recording. So the admin authoring a master script needs to see, on the
// script itself, exactly which words the dictionary already knows — and which ones it is
// still missing. This is the client-side twin of the server matcher, trimmed to those two
// questions.
//
// Matching rules:
//  - whole word only, never a substring ("Reth" must not match inside "Rethymno");
//  - case-insensitive, and diacritic-insensitive as a FALLBACK: an exact spelling always
//    wins, but "Sofia" also finds "Sofía" and "Cesme" finds "Çeşme". Turkish names were
//    being missed for exactly this reason — the dictionary may carry the proper Turkish
//    spelling (ş, ğ, ı, ç, ö, ü) while the script was typed without it, or the reverse
//    (İstanbul lowercases to "i̇stanbul" — a plain toLowerCase turns it into a different
//    string than "istanbul"). Folding both sides through foldWord() removes that trap.
//  - Latin entries need 3+ characters, other scripts 2+;
//  - longest entry first, so a multi-word entry ("Agia Roumeli") is reported as itself
//    rather than as its two separate words.
const ASCII_LETTER_RE = /[A-Za-z]/;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Splits a word into its bare letters: no accents, no Turkish dotless-i oddity, no case.
// Used only as a COMPARISON key — what gets reported is always the dictionary's real spelling.
const EXTRA_FOLDS = { 'ı': 'i', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe' };

export function foldWord(word) {
  return String(word || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ıøłđðþßæœ]/g, (c) => EXTRA_FOLDS[c] || c);
}

export function findDictionaryMatches(text, entries, languageName) {
  if (!text || !Array.isArray(entries) || entries.length === 0) return [];

  // Entries for the narration's OWN language are skipped: ordinary English words like "the"
  // are in the dictionary too, and listing them here would bury the names that actually
  // need checking. Foreign names — Anacamptis, Ahmed, a Turkish or Greek place name — always show.
  const spoken = String(languageName || '').trim().toLowerCase();
  const foldedText = foldWord(text);

  const candidates = entries
    .map((e) => ({
      id: e?.id || '',
      word: String(e?.original_word || '').trim(),
      ipa: String(e?.ipa_notation || '').trim(),
      language: String(e?.language_origin || '').trim(),
    }))
    .filter((e) => e.word && (foldWord(e.word).length >= 3 || e.word.length >= 2))
    .filter((e) => !(spoken && e.language && e.language.toLowerCase() === spoken))
    .sort((a, b) => b.word.length - a.word.length);

  const found = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = foldWord(c.word);
    if (seen.has(key)) continue;
    // Exact spelling first, then the accent/case-folded form.
    const hit = [c.word, key].some((form) => {
      if (!form) return false;
      try {
        return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(form)}(?![\\p{L}\\p{N}])`, 'iu')
          .test(form === c.word ? text : foldedText);
      } catch {
        return false; // an entry this browser's regex engine can't express — skip it
      }
    });
    if (!hit) continue;
    seen.add(key);
    found.push(c);
  }
  return found;
}

// Words in the script the dictionary does NOT have yet — the ones that would otherwise be
// translated away and mispronounced in the recording. Two kinds can be spotted mechanically:
//  - written in another script entirely (Greek, Cyrillic, Hebrew, Arabic): an obvious name;
//  - Latin letters outside plain a–z (ş, ğ, ı, é, ø…): a Turkish, French, German name.
// A plain-English-looking foreign name (Fortezza, Anacamptis) can't be told apart from an
// ordinary English word, so those are added by hand from the panel's own add form.
const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'’.-]*/gu;
const FOREIGN_SCRIPT_RE = /[\u0370-\u03FF\u1F00-\u1FFF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF]/;

export function findUnlistedScriptWords(text, entries) {
  if (!text) return [];
  const known = new Set(
    (Array.isArray(entries) ? entries : [])
      .map((e) => foldWord(e?.original_word))
      .filter(Boolean)
  );
  const missing = [];
  for (const m of String(text).matchAll(WORD_RE)) {
    const word = m[0].replace(/[.'’-]+$/, '');
    if (word.length < 2) continue;
    if (known.has(foldWord(word))) continue;
    const looksForeign = FOREIGN_SCRIPT_RE.test(word)
      || (ASCII_LETTER_RE.test(word) && /[^\x00-\x7F]/.test(word));
    if (!looksForeign) continue;
    if (!missing.includes(word)) missing.push(word);
  }
  return missing;
}