// Per Enda (2026-09-04): "Magical Crete" is the brand name — always capitalised, always
// meant to survive translation completely untouched, in every language. Before this file
// existed there was NO mechanism anywhere in the app that protected it: the Pronunciation
// Dictionary (see pronunciationDictionary/entry.ts) only guides PCV audio, and neither
// translateScript nor seedUiTranslations had any concept of a protected word or phrase at
// all — Enda had been adding "Magical" and "Crete" as SEPARATE entries there, believing
// that protected the brand name, but that dictionary is never even read by either
// translation function. The real, separate problem that caused: with no protection at all,
// a standalone "Crete" (the island) was at the mercy of whatever the AI model felt like
// doing with it that day — sometimes left alone, sometimes translated, nothing guaranteed
// either way, and "Magical Crete" itself had no real guarantee either.
//
// Fixed here the same way seedUiTranslations already protects {placeholder} tokens for its
// Google fallback path: swap the exact phrase for a plain marker BEFORE the text ever
// reaches Groq or Google, then swap the real phrase back in afterward — so neither
// translation engine ever actually sees "Magical Crete" to (mis)translate in the first
// place. Unlike the {placeholder} precedent, this is applied to the GROQ path too, not just
// Google's — a brand name is too high-stakes to leave to an LLM's instruction-following
// alone the way an internal placeholder token safely can be.
//
// Matching is case-sensitive and exact-phrase-only: "Magical Crete", never "magical crete"
// or "Magical" and "Crete" matched separately. A standalone "Crete" is deliberately left
// completely alone by this list, so it keeps translating normally.
//
// Add more literal phrases here if another brand term ever needs the same guarantee — each
// one must be the FULL phrase to protect, not its individual words.
export const PROTECTED_PHRASES = ['Magical Crete'];

export function protectPhrases(text: string): { protectedText: string; restore: (s: string) => string } {
  const present = PROTECTED_PHRASES.filter((phrase) => text.includes(phrase));
  if (present.length === 0) return { protectedText: text, restore: (s: string) => s };
  let protectedText = text;
  const markers = present.map((phrase, i) => {
    const marker = `xxbrandphrase${i}xx`;
    protectedText = protectedText.split(phrase).join(marker);
    return { marker, phrase };
  });
  const restore = (s: string) => markers.reduce((acc, { marker, phrase }) => acc.split(marker).join(phrase), s);
  return { protectedText, restore };
}

// Per Enda (follow-up 124): a tour's own title — e.g. "The Battle of the Rivers" — often
// gets mentioned again inside the narration itself, more than once. Left to Groq/Google's
// own per-call judgement, a title-shaped phrase like that is exactly the kind of thing an AI
// translator tends to leave alone (the same instinct that was leaving a bare "Crete"
// untouched) — and even where it DOES translate it, nothing guarantees the SAME wording comes
// out twice, so the same tour's title could read differently waypoint to waypoint.
//
// This is the mirror image of protectPhrases above: instead of protecting a phrase so it
// comes back UNCHANGED, this swaps the tour's known ENGLISH title for a marker before
// translation, then swaps in its ALREADY-DECIDED translated title afterward — the one sitting
// in the Tour Name box (see WalkEditor.jsx's "Translate" button next to that field). That
// guarantees the title reads identically everywhere it's mentioned, and guarantees it actually
// gets translated at all, without leaving either outcome up to the model's mood that call.
//
// Only ever protects the ONE title a given narration script belongs to — see
// translateScript/entry.ts for how fromTitle/toTitle are worked out per call.
export function substituteTitleMentions(text: string, fromTitle: string, toTitle: string): { protectedText: string; restore: (s: string) => string } {
  const from = (fromTitle || '').trim();
  const to = (toTitle || '').trim();
  if (!from || !to || !text.includes(from)) return { protectedText: text, restore: (s: string) => s };
  const marker = 'xxtitlephrase0xx';
  const protectedText = text.split(from).join(marker);
  const restore = (s: string) => s.split(marker).join(to);
  return { protectedText, restore };
}
