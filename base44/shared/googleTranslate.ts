// Last-resort fallback translator — used ONLY after every configured Groq key (see
// groqKeyRotation.ts) has been tried and every one came back rate-limited. Per Enda:
// "whenever possible use the Groq key, but if that jams, then switch to the Google key" —
// deliberately kept as the LAST tier, not a primary or parallel option, specifically to
// minimise exposure to Google Cloud Translation's per-character billing (500,000
// characters/month free, then $20 per million) to the rare case where Groq is genuinely
// exhausted, rather than routing everyday usage through a paid API.
//
// Uses the SAME Google API key already saved for Text-to-Speech (see
// useNarratorApiKeys.js/manageApiKeys) — Cloud Translation and Cloud Text-to-Speech are
// separate Google Cloud products with independent free-tier quotas; that key just needs
// the Cloud Translation API also enabled on the same Google Cloud project (a couple of
// clicks in the console, no new credential).

export interface GoogleTranslateResult {
  ok: boolean;
  translations?: string[]; // same order/length as the input texts
  error?: string;
}

// Google Cloud Translation v2's documented per-request limit is 128 "q" values — this
// keeps every call safely under that regardless of how many strings a language is missing.
const MAX_BATCH = 100;

function decodeHtmlEntities(s: string): string {
  // format=html (used for narration scripts, to protect <break> tags — the tags themselves
  // pass through as literal markup, untouched) makes Google return ordinary prose
  // HTML-escaped, e.g. "don&#39;t" or "Tom &amp; Jerry" — this app stores plain
  // text-with-inline-tags, not real HTML, so those entities need undoing before the result
  // is saved. Only the small, common set plain narration prose can actually contain.
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '’')
    .replace(/&apos;/g, '’');
}

async function translateBatch(texts: string[], targetLangCode: string, apiKey: string, format: 'text' | 'html'): Promise<GoogleTranslateResult> {
  try {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, target: targetLangCode, source: 'en', format }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Google Translate API returned ${res.status}` };
    }
    const list = data?.data?.translations;
    if (!Array.isArray(list) || list.length !== texts.length) {
      return { ok: false, error: 'Google Translate returned an unexpected response shape.' };
    }
    const translations = list.map((t: any) => (format === 'html' ? decodeHtmlEntities(t.translatedText) : t.translatedText));
    return { ok: true, translations };
  } catch (err) {
    return { ok: false, error: err?.message || 'Google Translate request failed.' };
  }
}

// format 'html' tells Google to parse the text as HTML and leave any markup-like tags
// (e.g. narration's `<break time="1s"/>`) untranslated, translating only the surrounding
// text nodes — the same well-documented mechanism real HTML pages rely on. Plain UI
// strings (no real tags, just {placeholder} tokens) should use 'text' instead — format=html
// offers no extra protection for those (a bare `{n}` isn't HTML markup either way) and
// risks unnecessary entity-escaping on ordinary punctuation.
export async function translateWithGoogle(texts: string[], targetLangCode: string, apiKey: string, format: 'text' | 'html' = 'text'): Promise<GoogleTranslateResult> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'No Google API key found for your account — add one under "API Keys" in the Admin Panel header before the Google fallback can be used.' };
  }
  if (!targetLangCode) {
    return { ok: false, error: 'No target language code available for the Google Translate fallback.' };
  }
  if (texts.length === 0) return { ok: true, translations: [] };

  const allTranslations: string[] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const result = await translateBatch(batch, targetLangCode, apiKey, format);
    if (!result.ok || !result.translations) {
      // Fail the whole call rather than return a partial result silently — the caller
      // falls back to the existing Groq-rate-limited reporting path for everything if this
      // happens, so a partial success here would just get thrown away anyway.
      return result;
    }
    allTranslations.push(...result.translations);
  }
  return { ok: true, translations: allTranslations };
}
