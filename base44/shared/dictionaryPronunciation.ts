// Per Enda (2026-11-05): "there is no way to force the voice to use the pronunciation
// dictionary for the master tours." Until now the dictionary only protected words from
// TRANSLATION — and a master (English) tour is never translated, so nothing in the audio
// path ever consulted it. The dictionary does carry the thing that would fix that: an IPA
// notation per word (381 entries, every one of them with IPA). This module turns those
// into real SSML <phoneme> tags, so the Google TTS audio generated here actually says the
// dictionary's pronunciation instead of Google's guess at a Cretan or Turkish place name.
//
// Applied to the script AFTER the text has been XML-escaped (see escapeSsmlText in
// generateTts) and BEFORE it is wrapped in <speak>, so the tags we insert are real markup
// while every ordinary character in the narration stays safely escaped.
//
// Matching is the same conservative rule the translation protection uses: whole word only,
// case-insensitive, longest entry first so a multi-word entry wins over its own words.
// Words containing characters that get escaped (& < > " ') are skipped rather than guessed
// at — a half-escaped pattern would either miss or mangle that word.
const LATIN_ONLY_RE = /^[A-Za-z\u00C0-\u024F' .-]+$/;

// Marker wrappers: replacements are written as markers first and swapped in at the very
// end, so a short dictionary entry can never match inside markup that a previous entry
// already inserted (an entry like "ipa" or "phoneme" would otherwise corrupt its tags).
const MARKER_START = '\u0001ipapron';
const MARKER_END = '\u0001';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// The dictionary stores IPA wrapped in slashes and with syllable dots ("/ˈah.med/"), which
// is dictionary notation, not part of the phoneme string Google expects. Strip both, plus
// the square brackets some editors use instead of slashes.
function cleanIpa(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^[\s/[\]]+/, '')
    .replace(/[\s/[\]]+$/, '')
    .replace(/\./g, '')
    .trim();
}

export type DictionaryEntry = { word: string; ipa: string; language?: string };

// The dictionary holds the tour's OWN language too (English "the", "battle"…), where it
// adds nothing: Google already pronounces ordinary words of the narration language
// correctly, and forcing such an entry would only overwrite a good default. Those entries
// are skipped whenever they are for the language being spoken; every foreign name —
// Anacamptis (Italian), Ahmed (Turkish), a Greek place name — is still applied.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', nl: 'Dutch', cs: 'Czech', fr: 'French', de: 'German', es: 'Spanish',
  pt: 'Portuguese', it: 'Italian', el: 'Greek', pl: 'Polish', ro: 'Romanian',
  hu: 'Hungarian', ru: 'Russian', tr: 'Turkish', sh: 'Serbo-Croatian', he: 'Hebrew',
  ar: 'Arabic', no: 'Norwegian', da: 'Danish', sv: 'Swedish', fi: 'Finnish',
  bg: 'Bulgarian', sl: 'Slovenian',
};

// 'en-US' → 'English'. Unknown codes simply return '' (nothing is filtered).
export function languageNameForCode(languageCode: string | undefined): string {
  const base = String(languageCode || '').trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_NAMES[base] || '';
}

export function applyDictionaryPhonemes(
  escapedText: string,
  entries: DictionaryEntry[],
  languageName?: string
): { ssmlText: string; words: string[] } {
  if (!escapedText || !Array.isArray(entries) || entries.length === 0) {
    return { ssmlText: escapedText, words: [] };
  }

  const spoken = String(languageName || '').trim().toLowerCase();

  const candidates = entries
    .map((e) => ({
      word: String(e?.word || '').trim(),
      ipa: cleanIpa(String(e?.ipa || '')),
      language: String(e?.language || '').trim(),
    }))
    .filter((e) => e.word && e.ipa)
    .filter((e) => !/[&<>"'\n\r\t]/.test(e.word))
    .filter((e) => !(spoken && e.language && e.language.toLowerCase() === spoken))
    .filter((e) => (LATIN_ONLY_RE.test(e.word) ? e.word.length >= 3 : e.word.length >= 2))
    .sort((a, b) => b.word.length - a.word.length);

  if (candidates.length === 0) return { ssmlText: escapedText, words: [] };

  const tags: string[] = [];
  const words: string[] = [];
  let out = escapedText;

  for (const c of candidates) {
    let regex: RegExp;
    try {
      regex = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(c.word)}(?![\\p{L}\\p{N}])`, 'giu');
    } catch {
      continue; // an entry the regex engine can't express — skip it rather than throw
    }
    if (!regex.test(out)) continue;

    out = out.replace(regex, (match) => {
      const index = tags.length;
      tags.push(`<phoneme alphabet="ipa" ph="${escapeXmlAttr(c.ipa)}">${match}</phoneme>`);
      if (!words.includes(match)) words.push(match);
      return `${MARKER_START}${index}${MARKER_END}`;
    });
  }

  if (tags.length === 0) return { ssmlText: escapedText, words: [] };

  const ssmlText = out.replace(
    new RegExp(`${MARKER_START}(\\d+)${MARKER_END}`, 'g'),
    (_m, i) => tags[Number(i)] || ''
  );

  return { ssmlText, words };
}