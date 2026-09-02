import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { resolveActor } from '../../shared/backendActor.ts';
import { callGroqWithKeyRotation } from '../../shared/groqKeyRotation.ts';

// Per Enda: some words/names in the English source script are deliberately written in
// their OWN original script (Greek, Cyrillic, Arabic) rather than English, specifically
// so the pronunciation dictionary (see pronunciationDictionary/entry.ts) can recognise
// them later — that only works if the exact spelling survives translation untouched.
// The prompt below tells the model this explicitly, but an LLM instruction is not a
// guarantee, and a silently "translated" or transliterated name would quietly break
// pronunciation for that word with no visible sign anything went wrong. This is a cheap,
// mechanical double-check on top of the prompt: pull out every run of Greek, Cyrillic, or
// Arabic letters from the ORIGINAL text, and after translation confirm each one still
// appears verbatim somewhere in the result. Turkish and Italian names use ordinary Latin
// letters, so there's no equivalent script-based way to detect those mechanically — the
// prompt instruction is the only defence for them, same as it always was for every other
// wording choice the model makes.
const GREEK_RANGE = '\\u0370-\\u03FF\\u1F00-\\u1FFF';
const CYRILLIC_RANGE = '\\u0400-\\u04FF';
const ARABIC_RANGE = '\\u0600-\\u06FF';
const FOREIGN_SCRIPT_WORD_RE = new RegExp(`[${GREEK_RANGE}${CYRILLIC_RANGE}${ARABIC_RANGE}]{2,}`, 'gu');

function findUnpreservedForeignWords(original: string, translated: string): string[] {
  const originalWords = new Set(original.match(FOREIGN_SCRIPT_WORD_RE) || []);
  if (originalWords.size === 0) return [];
  const missing: string[] = [];
  for (const word of originalWords) {
    if (!translated.includes(word)) missing.push(word);
  }
  return missing;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { text, target_language, apiKey, apiKey2 } = body;

    // Admin, or narrator via email+narrToken — without this, this function was reachable
    // by anyone at all, with no restriction on who could trigger a Groq call.
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

    // Each narrator uses their own Groq key (set on their own account) rather than one shared
    // across everyone.
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: 'No Groq API key found for your account. Add your own key under "API Keys" in the Admin Panel header.' }, { status: 400 });
    }
    // apiKey2 is an optional second key from a SEPARATE Groq account (see
    // groqKeyRotation.ts) — a rate limit on the primary key is tried against this one
    // immediately, no wait, before the whole translation is reported back as failed.
    const apiKeys = [apiKey, apiKey2].map(k => (k || '').trim()).filter(Boolean);

    const prompt = `Translate the following narration script into ${target_language}.

CRITICAL RULES:
1. Preserve ALL <break> tags EXACTLY as they are — same tag, same duration. Do not modify, move, translate, or remove them.
2. The script may contain a handful of individual words or names written in a script OTHER than English — Greek letters, Cyrillic, Turkish, Italian, or Arabic — sitting inline among the otherwise-English sentence, for example a place or person's name. These are deliberately written in their original language and script so a pronunciation dictionary can recognise them later; that only works if the EXACT original spelling survives. Copy every one of these words through completely unchanged — same characters, same script, same spelling, in the same place in the sentence. NEVER translate them, NEVER transliterate them into ${target_language}'s script or into English, and NEVER replace them with a translated or "corrected" version, even where you recognise what the word means or the target language could plausibly use its own name for it. This rule applies even when ${target_language} itself uses that same script — still copy the word exactly as given rather than retyping it.
3. Only translate the spoken narration text around those preserved words and between the break tags.
4. Keep the translation natural and conversational, suitable for spoken audio narration.
5. If the script starts with a title line, translate the title too (still preserving any inline foreign-script words per rule 2).
6. Return ONLY the translated text with break tags and any preserved foreign-script words intact. No explanations, no markdown, no commentary — just the translated script.

Script:
${text}`;

    const result = await callGroqWithKeyRotation(apiKeys, {
      // llama-3.3-70b-versatile was decommissioned by Groq on 2026-08-16 — every call
      // using that model id now fails, which is exactly what surfaced as this endpoint's
      // generic "Request failed with status code 500". Groq's own migration guidance for
      // this exact model points to either openai/gpt-oss-120b or qwen/qwen3.6-27b; picked
      // the larger of the two (120b vs 27b) since this call has to handle many different
      // target languages (see LANGUAGES) and translation quality matters more than speed.
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator for audio narration scripts. You always preserve SSML <break> tags exactly as written, and you always leave any inline word or name already written in a non-English script (Greek, Cyrillic, Turkish, Italian, Arabic) completely untouched, in its original script and spelling, rather than translating or transliterating it — those words drive a pronunciation dictionary that only matches an exact original spelling.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      // Groq's "tokens per minute" rate limit is charged against the FULL max_tokens
      // reservation the moment a request is sent, not just the tokens actually used —
      // so 8000 here alone was already almost the entire org's 8000 TPM allowance,
      // before a single token of the real prompt (script + instructions) was even
      // counted, guaranteeing "Request too large" on every single call regardless of
      // how short the script was. Scripts are capped at 5000 characters in the editor
      // (see MAX_CHARS in NarrationTtsEditor.jsx) — roughly 1,100-1,300 tokens once
      // translated even into a more verbose target language — so 4000 leaves several
      // times that much headroom while comfortably fitting under an 8000 TPM ceiling
      // alongside the prompt/instruction overhead.
      max_tokens: 4000,
    });

    if (!result.ok) {
      // A rate limit that survived every configured key (just the one key, if no backup is
      // set) gets a message that actually says how long Groq wants — this panel has no
      // automatic wait/retry loop like the UI-translations one does, so a narrator reading
      // this needs a real number to decide whether to wait or come back later.
      const waitHint = result.rateLimited && result.retryAfterMs
        ? ` Groq says to wait about ${Math.ceil(result.retryAfterMs / 1000)}s before trying again${apiKeys.length > 1 ? ' — both configured keys are currently rate-limited.' : '.'}`
        : '';
      return Response.json({
        error: (result.error || `Groq API returned ${result.status}`) + waitHint,
      }, { status: 500 });
    }

    const translatedText = result.data?.choices?.[0]?.message?.content;

    if (!translatedText) {
      return Response.json({ error: 'No translation returned' }, { status: 500 });
    }

    const finalText = translatedText.trim();

    // Best-effort check only (see findUnpreservedForeignWords above for what it can and
    // can't catch) — never fails the translation over it, since the translation itself
    // is very likely still fine and usable; this only flags that ONE named word may need
    // a manual look before it's relied on for pronunciation.
    const unpreserved = findUnpreservedForeignWords(text, finalText);

    return Response.json({
      translated_text: finalText,
      ...(unpreserved.length > 0 ? {
        preservation_warning: `Double-check the spelling of ${unpreserved.map((w) => `"${w}"`).join(', ')} in the translated text below — it should appear exactly as written in the original script, but couldn't be confirmed automatically. This matters for the pronunciation dictionary to work.`,
      } : {}),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});