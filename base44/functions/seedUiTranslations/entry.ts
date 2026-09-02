import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';
import { callGroqWithKeyRotation } from '../../shared/groqKeyRotation.ts';
import { translateWithGoogle } from '../../shared/googleTranslate.ts';

// Seeds a machine-translation BASELINE for UI strings in a language that doesn't have one
// hand-written in src/lib/i18n/index.js yet — see TranslationsManager.jsx's "Auto-translate
// missing" button. Only English, Dutch, and Czech ever got a hand-written baseline there;
// every other language in UI_LANGUAGES (and even nl/cs for a batch of newer keys added
// after their blocks were last touched) silently fell back to raw English. That meant the
// "Correct UI translations" tool — meant for a narrator to fix an unnatural AI translation —
// showed English pre-filled for those languages, so "correcting" one actually meant typing
// a first-draft translation of the whole UI from scratch.
//
// This writes the machine output as ordinary Translation overrides via saveTranslationsBulk
// (same entity, same shape a narrator's own manual correction produces) — so seeding one of
// these strings and a narrator later fixing it are exactly the same operation, just typically
// done by different people. Modelled directly on translateScript/entry.ts: same actor auth
// (admin, or narrator via email+narrToken), same per-caller Groq key, same model choice. The
// one addition here is preserving `{placeholder}` tokens (e.g. "{n} of {total} {label}")
// exactly, since the app substitutes those with real values at render time — a translated or
// reworded placeholder name would silently break that string everywhere it's used.
const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g;

function findUnpreservedPlaceholders(original: string, translated: string): string[] {
  const originalTokens = new Set(original.match(PLACEHOLDER_RE) || []);
  if (originalTokens.size === 0) return [];
  const missing: string[] = [];
  for (const token of originalTokens) {
    if (!translated.includes(token)) missing.push(token);
  }
  return missing;
}

// Two real runs against Enda's own Groq key exposed two DIFFERENT problems here, not one:
//
// Run 1 (95 Dutch keys, flat 40-key chunks): came back "seeded 15 of 95" with no reason given.
// Chunking purely by key count let a 40-key batch catch several paragraph-length strings
// together (about.paragraph1-3, detail.defaultSafetyNotes, contact.intro, etc.), which can
// make a single request's prompt+max_tokens reservation big enough for Groq to reject outright.
// Fixed by capping chunks on BOTH key count and total source character count (MAX_CHUNK_KEYS/
// MAX_CHUNK_CHARS below), and by splitting a chunk in half and retrying if it fails for a
// reason OTHER than rate limiting — see splitAndRetry below.
//
// Run 2 (65 Dutch keys, with the above fix already in place): the surfaced error revealed the
// REAL, separate constraint — this Groq account's rate limit for openai/gpt-oss-120b is a flat
// 8000 tokens PER MINUTE, and Groq reserves a request's full max_tokens against that budget the
// instant it's sent. A handful of our small chunks in a row (each reserving ~4000+ tokens) burns
// through the entire per-minute budget in one or two calls, so every following chunk gets a 429
// almost immediately — not because anything is wrong with the request, purely because the
// account hasn't had a minute to "refill" yet. Splitting a rate-limited chunk into smaller ones
// would make this WORSE (more requests, each still reserving close to the same max_tokens, drains
// the budget even faster) — the only correct response to a 429 is to wait. Groq's own error tells
// us exactly how long ("Please try again in 6.465s"), so a 429 is now reported back to the
// frontend as `rate_limited_keys` + `retry_after_ms` instead of being retried (or slept through)
// in here — a long in-function sleep risks this call itself timing out, and TranslationsManager.jsx
// already tells Enda to keep the tab open, so pacing repeated attempts from there — where a many-
// minute wait is just normal UI state, not a request that might get killed mid-sleep — is safer.
const MAX_CHUNK_KEYS = 15;
const MAX_CHUNK_CHARS = 1800; // total source characters per chunk
const MAX_TOKENS_PER_CALL = 2500; // lower reservation per call = more calls fit in the account's 8000 TPM budget before a 429

function buildChunks(keys: string[], entries: Record<string, string>): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const k of keys) {
    const len = (entries[k] || '').length;
    if (current.length > 0 && (current.length >= MAX_CHUNK_KEYS || currentChars + len > MAX_CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(k);
    currentChars += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildPrompt(sourceObj: Record<string, string>, target_language: string): string {
  return `Translate the string VALUES in this JSON object from English into ${target_language}. Keep the JSON keys exactly as given, unchanged.

CRITICAL RULES:
1. Translate only the values, never the keys.
2. Some values contain tokens like {n}, {label}, {total}, {page} — these are placeholders the app substitutes with real data at runtime. Copy every such {token} through EXACTLY as written — same braces, same name inside, same position in the sentence. Never translate, rename, reorder, or drop them.
3. Preserve any \\n line breaks within a value, in the same positions.
4. Keep translations natural and concise, suitable for compact UI text (buttons, labels, short messages) — not narration prose.
5. Return ONLY a single valid JSON object with the same keys and their translated values. No explanations, no markdown, no commentary — just the JSON object.

JSON:
${JSON.stringify(sourceObj)}`;
}

type GroqResult =
  | { ok: true; parsed: Record<string, unknown> }
  | { ok: false; error: string; rateLimited: boolean; retryAfterMs?: number };

// apiKeys: the caller's own Groq key, plus an optional second key from a separate Groq
// account (see groqKeyRotation.ts) — a rate limit on the first is tried against the second
// immediately, no wait, before this whole call is reported back as rate-limited.
async function callGroq(sourceObj: Record<string, string>, target_language: string, apiKeys: string[]): Promise<GroqResult> {
  const result = await callGroqWithKeyRotation(apiKeys, {
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: 'You are a professional UI/software localization translator. You always return strict JSON with exactly the same keys you were given, and you always leave {placeholder} tokens completely untouched — they are filled in with real data by the app, not translated.',
      },
      { role: 'user', content: buildPrompt(sourceObj, target_language) },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
    max_tokens: MAX_TOKENS_PER_CALL,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || 'Groq call failed', rateLimited: !!result.rateLimited, retryAfterMs: result.retryAfterMs };
  }

  const raw = result.data?.choices?.[0]?.message?.content;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Model did not return a valid JSON object.', rateLimited: false };
    return { ok: true, parsed };
  } catch {
    return { ok: false, error: 'Model response was not valid JSON (likely cut off mid-response).', rateLimited: false };
  }
}

interface ChunkOutcome {
  translated: Record<string, string>;
  failed: { key: string; error: string }[];
  rateLimitedKeys: string[];
  retryAfterMs?: number;
}

// Translates one chunk of keys. A rate-limited chunk is reported back as-is (see the big
// comment above for why splitting or sleeping through a 429 in here is the wrong move). Any
// OTHER failure (oversized/malformed response) still splits the chunk in half and retries each
// half in turn — never in parallel — down to single keys if it has to.
async function translateChunk(chunkKeys: string[], entries: Record<string, string>, target_language: string, apiKeys: string[]): Promise<ChunkOutcome> {
  const sourceObj: Record<string, string> = {};
  for (const k of chunkKeys) sourceObj[k] = entries[k];

  const result = await callGroq(sourceObj, target_language, apiKeys);

  if (result.ok) {
    const translated: Record<string, string> = {};
    const failed: { key: string; error: string }[] = [];
    for (const k of chunkKeys) {
      const value = result.parsed[k];
      if (typeof value === 'string' && value.trim()) {
        translated[k] = value.trim();
      } else {
        failed.push({ key: k, error: 'Key missing from model response' });
      }
    }
    return { translated, failed, rateLimitedKeys: [] };
  }

  if (result.rateLimited) {
    return { translated: {}, failed: [], rateLimitedKeys: chunkKeys, retryAfterMs: result.retryAfterMs };
  }

  if (chunkKeys.length > 1) {
    const mid = Math.ceil(chunkKeys.length / 2);
    const first = await translateChunk(chunkKeys.slice(0, mid), entries, target_language, apiKeys);
    const second = await translateChunk(chunkKeys.slice(mid), entries, target_language, apiKeys);
    const retryAfterMs = first.retryAfterMs ?? second.retryAfterMs;
    return {
      translated: { ...first.translated, ...second.translated },
      failed: [...first.failed, ...second.failed],
      rateLimitedKeys: [...first.rateLimitedKeys, ...second.rateLimitedKeys],
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }

  return { translated: {}, failed: chunkKeys.map(k => ({ key: k, error: result.error })), rateLimitedKeys: [] };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { entries, target_language, apiKey, apiKey2, googleApiKey, target_lang_code } = body;

    // Admin, or narrator via email+narrToken — same gate as translateScript, for the same
    // reason: without it this triggers a Groq call (billed to the caller's own key, but
    // still) for anyone who could reach the endpoint at all.
    const actor = await resolveActor(base44, body);
    if (!actor) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length === 0) {
      return Response.json({ error: 'Missing entries to translate' }, { status: 400 });
    }
    if (!target_language) {
      return Response.json({ error: 'Missing target language' }, { status: 400 });
    }
    if (!apiKey || !apiKey.trim()) {
      return Response.json({ error: 'No Groq API key found for your account. Add your own key under "API Keys" in the Admin Panel header.' }, { status: 400 });
    }
    // apiKey2 is an optional second key from a SEPARATE Groq account — see
    // groqKeyRotation.ts. When set, a rate limit on the primary key is tried against this
    // one immediately (no wait) before the whole call is reported back as rate-limited.
    const apiKeys = [apiKey, apiKey2].map(k => (k || '').trim()).filter(Boolean);

    const keys = Object.keys(entries);
    const chunks = buildChunks(keys, entries);
    const translated: Record<string, string> = {};
    const failedKeys: string[] = [];
    const rateLimitedKeys: string[] = [];
    let retryAfterMs: number | undefined;
    const failureReasons = new Set<string>();
    const unpreservedWarnings: string[] = [];

    // Sequential on purpose — running chunks concurrently would only burn through the same
    // shared per-minute token budget faster and cause MORE 429s, not fewer.
    for (const chunkKeys of chunks) {
      const outcome = await translateChunk(chunkKeys, entries, target_language, apiKeys);
      for (const [k, v] of Object.entries(outcome.translated)) {
        translated[k] = v;
        const missing = findUnpreservedPlaceholders(entries[k], v);
        if (missing.length > 0) unpreservedWarnings.push(`${k} (${missing.join(', ')})`);
      }
      for (const f of outcome.failed) {
        failedKeys.push(f.key);
        failureReasons.add(f.error);
      }
      if (outcome.rateLimitedKeys.length > 0) {
        rateLimitedKeys.push(...outcome.rateLimitedKeys);
        failedKeys.push(...outcome.rateLimitedKeys);
        if (outcome.retryAfterMs !== undefined) {
          retryAfterMs = retryAfterMs === undefined ? outcome.retryAfterMs : Math.max(retryAfterMs, outcome.retryAfterMs);
        }
        // Once one chunk in this call is rate-limited, every later chunk will hit the exact
        // same wall (the budget doesn't recover mid-call) — stop here instead of burning
        // through the rest of the chunks on guaranteed 429s. The caller gets back whatever
        // translated so far, plus which keys still need a retry once the window resets.
        break;
      }
    }

    // Per Enda: "use the Groq key whenever possible, but if that jams, switch to the Google
    // key" — Google Cloud Translation as a LAST-tier fallback, only for whatever Groq
    // genuinely could not translate above (using every configured Groq key, not just the
    // first). Deliberately not a parallel/first option: keeps Google's paid, per-character
    // usage limited to the rare case where Groq is actually exhausted, not everyday traffic.
    // `entries[k] !== undefined` filters to keys still genuinely missing a translation —
    // this also naturally covers a chunk that never got attempted at all because an EARLIER
    // chunk already tripped the rate-limit break above, not just the specific chunk that
    // was rate-limited, so nothing from this call is left behind unnecessarily.
    const stillMissingKeys = keys.filter(k => translated[k] === undefined);
    let googleTranslatedCount = 0;
    if (stillMissingKeys.length > 0 && googleApiKey && googleApiKey.trim() && target_lang_code) {
      const texts = stillMissingKeys.map(k => entries[k]);
      const googleResult = await translateWithGoogle(texts, target_lang_code, googleApiKey, 'text');
      if (googleResult.ok && googleResult.translations) {
        stillMissingKeys.forEach((k, i) => {
          const v = googleResult.translations![i];
          if (typeof v === 'string' && v.trim()) {
            translated[k] = v.trim();
            googleTranslatedCount++;
            const missing = findUnpreservedPlaceholders(entries[k], v);
            if (missing.length > 0) unpreservedWarnings.push(`${k} (${missing.join(', ')}, via Google fallback)`);
          }
        });
      } else if (googleResult.error) {
        failureReasons.add(`Google fallback: ${googleResult.error}`);
      }
    }

    // Recompute what's STILL missing after the Google attempt (if any was made) — only
    // genuinely unresolved keys get reported back as failed/rate-limited from here on, so
    // TranslationsManager.jsx's retry/wait loop (or a manual fill-in) never sees a key that
    // Google already rescued.
    const finalMissing = keys.filter(k => translated[k] === undefined);
    const finalRateLimited = rateLimitedKeys.filter(k => finalMissing.includes(k));

    if (Object.keys(translated).length === 0 && finalRateLimited.length === 0) {
      return Response.json({ error: `No translations were returned — try again, or fill these in by hand. Last error: ${[...failureReasons][0] || 'unknown'}` }, { status: 500 });
    }

    return Response.json({
      translations: translated,
      failed_keys: finalMissing,
      // Keys that specifically hit the account's per-minute rate limit, plus how long Groq says
      // to wait — TranslationsManager.jsx uses this to automatically wait and retry just these
      // keys, rather than reporting a rate limit as a plain, permanent-looking failure.
      // `keys_tried` tells the caller how many Groq API keys were actually attempted before
      // giving up: callGroqWithKeyRotation only reports a rate limit AFTER every configured
      // key has been tried and every one came back rate-limited (it returns early on any
      // success or non-rate-limit error) — so this is a reliable, direct answer to "did it
      // actually try my second key?", not a guess.
      ...(finalRateLimited.length > 0 ? { rate_limited_keys: finalRateLimited, retry_after_ms: retryAfterMs ?? 15000, keys_tried: apiKeys.length } : {}),
      // A handful of DISTINCT non-rate-limit error messages (not one per failed key — that
      // could be dozens of copies of the same cause) so a real failure is diagnosable.
      ...(failureReasons.size > 0 ? { failure_reasons: [...failureReasons].slice(0, 5) } : {}),
      // How many of the translations above came from the Google fallback rather than Groq —
      // purely informational (TranslationsManager.jsx can mention it), never changes behavior.
      ...(googleTranslatedCount > 0 ? { google_translated_count: googleTranslatedCount } : {}),
      // Best-effort check only, never fails the pass over it — same reasoning as
      // translateScript's own preservation_warning: the translation is very likely still
      // fine, this only flags keys worth a manual glance before relying on the placeholder.
      ...(unpreservedWarnings.length > 0 ? {
        placeholder_warning: `Double-check these keys — a {placeholder} token may not have survived translation exactly: ${unpreservedWarnings.join('; ')}.`,
      } : {}),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
