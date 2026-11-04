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
const LATIN_ONLY_RE = /^[A-Za-z\u00C0-\u024F' .-]+$/;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function protectDictionaryWords(text: string, dictionaryWords: string[]): {
  protectedText: string;
  restore: (s: string) => string;
  found: string[];
} {
  const candidates = Array.from(new Set((dictionaryWords || []).map((w) => String(w || '').trim()).filter(Boolean)))
    .filter((w) => (LATIN_ONLY_RE.test(w) ? w.length >= 3 : w.length >= 2))
    // Longest first: a multi-word entry consumes its words before any single-word entry
    // inside it gets a chance to split it up.
    .sort((a, b) => b.length - a.length);

  if (!text || candidates.length === 0) {
    return { protectedText: text, restore: (s: string) => s, found: [] };
  }

  const markers: { marker: string; value: string }[] = [];
  const found: string[] = [];
  let protectedText = text;

  for (const word of candidates) {
    let regex: RegExp;
    try {
      // Letter/number boundaries rather than \b, which doesn't work across scripts (a Greek
      // letter is not a \w character, so \b would fire mid-word).
      regex = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, 'giu');
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