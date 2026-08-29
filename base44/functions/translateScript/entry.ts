import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { resolveActor } from '../../shared/backendActor.ts';

// Maps the UI's full language names (from src/lib/languages.js LANGUAGES) to the
// ISO-639-1 codes Google Cloud Translation API v2 expects as its `target` parameter.
// Google only accepts the codes in its supported-languages list — names like "German"
// are rejected outright, so every name the narrator can ever pick is mapped here.
const LANG_TO_ISO = {
  English: 'en', Dutch: 'nl', Czech: 'cs', French: 'fr', German: 'de',
  Spanish: 'es', Portuguese: 'pt', Italian: 'it', Greek: 'el', Polish: 'pl',
  Romanian: 'ro', Hungarian: 'hu', Russian: 'ru', Turkish: 'tr',
  // "Serbo-Croatian" has no single ISO-639-1 code Google accepts ("sh" isn't in Google's
  // supported list); Serbian is the closest single-code match for the same dialect family.
  'Serbo-Croatian': 'sr',
  Hebrew: 'he', Arabic: 'ar', Norwegian: 'no', Danish: 'da', Swedish: 'sv',
  Finnish: 'fi', Bulgarian: 'bg', Slovenian: 'sl',
};

// Google Translate v2 caps a single request at ~5,000 characters. Scripts are capped at
// MAX_CHARS (5000) once loaded into the editor, but a freshly-imported .txt file can be
// longer before it ever reaches that box, so chunk by line to stay safely under the limit.
const CHUNK_CHAR_LIMIT = 4500;

function chunkTextByLines(text, limit) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? current + '\n' + line : line;
    if (candidate.length > limit) {
      if (current) chunks.push(current);
      // A single line longer than the limit is sent on its own — if the API rejects it the
      // narrator gets a clear error rather than a silent truncation.
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Google Translate occasionally returns a few HTML entities even with format:"text"
// (apostrophes in particular surface as &#39;). Narration text is read aloud, so those
// would literally be spoken as "amp hash three nine semicolon" by a TTS engine — decode
// the handful that actually occur so the translated script stays clean.
function decodeCommonEntities(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { text, target_language, apiKey } = body;

    // Admin, or narrator via email+narrToken — without this, this function was reachable
    // by anyone at all, with no restriction on who could trigger a translation call.
    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!text || !text.trim()) {
      return Response.json({ error: 'Missing text to translate' }, { status: 400 });
    }
    if (!target_language) {
      return Response.json({ error: 'Missing target language' }, { status: 400 });
    }

    // Each admin/narrator uses their own Google API key (the same one already stored for
    // text-to-speech — a single Google Cloud API key can be enabled for both the Cloud
    // Translation and Cloud Text-to-Speech APIs in the same project).
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: 'No Google API key found for your account. Add your own key under "API Keys" in the Admin Panel header.' }, { status: 400 });
    }

    const target = LANG_TO_ISO[target_language] || target_language.toLowerCase().slice(0, 2);

    // ElevenLabs changed their SSML tag system, so <break> tags are now added by hand while
    // editing the translated script — the translated output is plain text. Strip any
    // <break .../> tags before translating so Google doesn't garble them into the
    // surrounding narration (e.g. translating "break"/"time" inside the tag).
    const cleanText = text.replace(/<break\s+[^>]*\/>/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();

    if (!cleanText) {
      return Response.json({ error: 'Nothing to translate after removing break tags.' }, { status: 400 });
    }

    const chunks = chunkTextByLines(cleanText, CHUNK_CHAR_LIMIT);
    const translatedParts = [];

    for (const chunk of chunks) {
      const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: chunk, target, format: 'text' }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return Response.json({
          error: errData?.error?.message || `Google Translation API returned ${response.status}`,
        }, { status: 500 });
      }

      const data = await response.json();
      const translated = data?.data?.translations?.[0]?.translatedText;
      if (!translated) {
        return Response.json({ error: 'No translation returned' }, { status: 500 });
      }
      translatedParts.push(decodeCommonEntities(translated));
    }

    return Response.json({ translated_text: translatedParts.join('\n') });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});