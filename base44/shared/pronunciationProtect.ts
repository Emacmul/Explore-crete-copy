// Per Enda (2026-11-04): the pronunciation dictionary (LinguaGloss) already existed to make
// ElevenLabs pronounce names correctly — but nothing stopped TRANSLATION from rewriting
// those words first. Greek, Cyrillic and Arabic names survived by accident of their script
// (the model can see they're foreign), and translateScript already told the model to leave
// those alone. An Italian name written in ordinary Latin letters inside English text had no
// such protection: nothing distinguishes "Tagliamento" from an English word, so it was
// translated like any other text, and the dictionary entry then matched nothing in the
// target script — wrong pronunciation, silently.
//
// This is the same mechanical trick protectedPhrases.ts already uses for "Magical Crete":
// swap the exact word for a plain marker BEFORE either translation engine (Groq or Google)
// ever sees it, then swap the real word back afterwards. Because the engine never sees the
// word, it cannot translate it — irrespective of the alphabet it happens to be written in,
// which is exactly the gap Enda described. Applied to every translation path (narration
// scripts, tour titles, descriptions, safety notes, stop names, system messages) since
// translateScript is the single choke point they all go through.
//
// Matching rules, deliberately conservative:
//  - Whole word only, never a substring ("Reth" must not match inside "Rethymno").
//  - Case-insensitive, so "Rethymno" in the dictionary also protects a lowercase mention
//    in running text; the ORIGINAL casing in the source text is what gets restored.
//  - Latin-only entries need 3+ characters. Two-letter Latin tokens in a dictionary are far
//    more likely to be noise than a name worth protecting, and a stray "is" or "an" entry
//    would otherwise protect ordinary English words in every script.
//  - Non-Latin entries need 2+ characters, where short names are genuinely common.
//  - The longest matching entry wins, so a multi-word entry ("Agia Roumeli") is protected as
//    one unit rather than word by word.
//
// RTL safeguards (Enda, 2026-11-04 — "I don't want narrators scratching their heads"):
// right-to-left is only a DISPLAY property, so protection itself is direction-blind: the
// characters keep their logical order and are swapped out and back exactly as typed. What
// genuinely bites Hebrew and Arabic text is spelling variation, and the three cases below
// are handled here rather than left for a narrator to discover after the audio is made:
//  1. ATTACHED PREFIXES. Hebrew and Arabic glue short prefixes to the following word with
//     no space (Hebrew ב/ה/ו/כ/ל/מ/ש; Arabic و/ب/ل/ك/ف plus the article ال and its
//     combinations, e.g. "בירושלים", "بالإسكندرية"). A plain whole-word match only fired on
//     the bare form, so every prefixed mention was translated. A leading prefix is now
//     consumed AS PART OF the match and restored verbatim, so the whole token survives.
//  2. DIACRITICS AND TATWEEL. Arabic harakat, Hebrew niqqud and the Arabic tatweel stretch
//     letter are optional decoration that the same name is spelled with or without. Each
//     gap between letters now tolerates any number of combining marks, so an entry typed
//     without harakat still matches text written with them (and the other way round).
//  3. PRESENTATION FORMS. Arabic copied out of a PDF or Word document arrives in the
//     presentation-form block (U+FB50–FDFF / U+FE70–FEFF), which never equals ordinary
//     Arabic letters. Both the dictionary entry and such text are normalised (NFKC) so they
//     match; this also means the audio gets standard Arabic letters rather than forms.
// Everything above only ever widens what matches; the restored text is still exactly what
// the source contained, so a wrong match can only leave a word untranslated, never altered.
const LATIN_ONLY_RE = /^[A-Za-z\u00C0-\u024F' .-]+$/;
const HEBREW_RE = /[\u0590-\u05FF]/;
const ARABIC_RE = /[\u0600-\u06FF]/;
// Hebrew prefixes that attach to the next word: bet, he, vav, kaf, lamed, mem, shin.
// Up to TWO of them, because they stack: "ולירושלים" is vav + lamed + the name.
const HEBREW_PREFIX = '[\u05D1\u05D4\u05D5\u05DB\u05DC\u05DE\u05E9]{0,2}';
// Arabic: the article ال on its own or after a single-letter prefix (وال، بال، كال…), the
// contracted "لل", or a bare one-letter prefix (و، ب، ل، ك، ف).
const ARABIC_PREFIX = '(?:[\u0648\u0628\u0644\u0643\u0641]?\u0627\u0644|\u0644\u0644|[\u0648\u0628\u0644\u0643\u0641])';
// Combining marks (\p{M} covers Arabic harakat and Hebrew niqqud) plus the Arabic tatweel,
// which is classified as a letter (Lm) and so has to be named explicitly.
const MARK_TOLERANCE = '[\\p{M}\\u0640]*';
const PRESENTATION_FORMS_RE = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Arabic copied out of Office/PDF arrives in presentation forms; NFKC folds those back to
// the ordinary letters the dictionary is typed in. Applied to both sides for that reason.
// NFKC also composes a decomposed accent (e + combining acute) into one character, so a
// precomposed entry and decomposed text meet in the middle instead of never matching.
function normalizeForMatching(text: string): string {
  // Only when there is something to normalize (presentation forms or a separated accent) —
  // ordinary text is left byte-identical rather than being restyled by NFKC.
  return PRESENTATION_FORMS_RE.test(text) || /\p{M}/u.test(text) ? text.normalize('NFKC') : text;
}

// Vowel marks and the tatweel are optional decoration: the same name gets typed with them
// in the dictionary and without them in a script, or the other way round. Stripping them
// from the ENTRY (never from the text) means one entry covers every spelling of itself,
// while the tolerance in the pattern lets the source text carry as many marks as it likes.
function stripOptionalMarks(word: string): string {
  return word.normalize('NFKC').replace(/[\p{M}\u0640]/gu, '');
}

// Letter/number boundaries rather than \b, which doesn't work across scripts (a Greek
// letter is not a \w character, so \b would fire mid-word). Each letter is joined by
// MARK_TOLERANCE so optional diacritics never break a match, and a script's own attached
// prefixes are allowed in front of the word (see rule 1 above).
function buildWordPattern(word: string): string {
  const body = Array.from(word).map(escapeRegex).join(MARK_TOLERANCE);
  let prefix = '';
  if (HEBREW_RE.test(word)) prefix = `${HEBREW_PREFIX}?`;
  else if (ARABIC_RE.test(word)) prefix = `${ARABIC_PREFIX}?`;
  return `(?<![\\p{L}\\p{N}])${prefix}${body}(?![\\p{L}\\p{N}])`;
}

export function protectDictionaryWords(text: string, dictionaryWords: string[]): {
  protectedText: string;
  restore: (s: string) => string;
  found: string[];
} {
  const candidates = Array.from(new Set((dictionaryWords || [])
    .map((w) => stripOptionalMarks(String(w || '').trim()))
    .filter(Boolean)))
    .filter((w) => (LATIN_ONLY_RE.test(w) ? w.length >= 3 : w.length >= 2))
    // Longest first: a multi-word entry consumes its words before any single-word entry
    // inside it gets a chance to split it up.
    .sort((a, b) => b.length - a.length);

  if (!text || candidates.length === 0) {
    return { protectedText: text, restore: (s: string) => s, found: [] };
  }

  const markers: { marker: string; value: string }[] = [];
  const found: string[] = [];
  let protectedText = normalizeForMatching(text);

  for (const word of candidates) {
    let regex: RegExp;
    try {
      regex = new RegExp(buildWordPattern(word), 'giu');
    } catch {
      continue; // an entry the regex engine can't express — skip it rather than throw
    }
    if (!regex.test(protectedText)) continue;

    protectedText = protectedText.replace(regex, (match) => {
      const marker = `xxpronword${markers.length}xx`;
      markers.push({ marker, value: match });
      if (!found.includes(match)) found.push(match);
      return marker;
    });
  }

  if (markers.length === 0) {
    // Nothing matched: hand back the original text untouched, so a translation with no
    // dictionary words in it behaves exactly as it did before this protection existed.
    return { protectedText: text, restore: (s: string) => s, found: [] };
  }

  // Deliberately tolerant: a translation engine occasionally splits an unfamiliar token
  // ("xxpronword0xx" → "xx pronword 0 xx") or changes its case, and an exact string match
  // would then leave that marker sitting in the finished script instead of the real word.
  const restore = (s: string) => markers.reduce((acc, { marker, value }) => {
    const loose = new RegExp(marker.split('').map(escapeRegex).join('\\s*'), 'gi');
    return acc.replace(loose, () => value);
  }, s);
  return { protectedText, restore, found };
}

// A marker that is STILL in the text after the swap-back above means the engine changed it
// in a way restore() can't recognise (translated it, dropped the x's, broke it across a
// line). Latin marker tokens sitting inside right-to-left text are the likeliest to get
// reshuffled that way, and the result would otherwise be read aloud as "xx pron word zero
// xx" in a finished narration. translateScript reports whatever this finds so the narrator
// sees a warning instead of silently trusting a broken script.
const LEFTOVER_MARKER_RE = /x{0,2}\s*(?:pronword|brandphrase|titlephrase)\s*\d*\s*x{0,2}/gi;

export function findLeftoverMarkers(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(LEFTOVER_MARKER_RE)) {
    const token = String(m[0] || '').trim();
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}