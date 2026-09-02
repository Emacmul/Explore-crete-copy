import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveActor } from '../../shared/backendActor.ts';

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

// First real run of this (Enda, seeding Dutch): a 95-key pass chunked at a flat 40 keys/call
// came back "seeded 15 of 95" — both 40-key chunks failed outright, only the trailing 15-key
// chunk went through. That's not random flakiness, it's the exact failure mode translateScript's
// own max_tokens comment already documents for this Groq account: the FULL max_tokens figure is
// reserved against the per-minute token budget the instant a request is sent, before a single
// prompt token is even counted, so a chunk whose prompt is big enough (a batch of 40 keys can
// easily include several paragraph-length strings — about.paragraph1-3, detail.defaultSafetyNotes,
// contact.intro, etc.) tips the combined reservation over the ceiling and Groq rejects the whole
// request. A flat key-count chunk size can't see that coming — a chunk of 40 short button labels
// is trivial, a chunk of 40 that happens to catch three long paragraphs is not. So chunking here
// caps on BOTH key count and total source character count, and any chunk that still fails is
// retried after being split in half (sequentially, never in parallel — splitting into concurrent
// calls would only make the per-minute budget problem worse) down to single keys if it has to,
// so one oversized batch degrades to "slower" rather than "silently drops 40 keys with no
// explanation." The real Groq error message is now kept and surfaced too, instead of collapsing
// every failure into a bare count — see failed_keys/failure_reasons below.
const MAX_CHUNK_KEYS = 15;
const MAX_CHUNK_CHARS = 1800; // total source characters per chunk — see comment above
const MAX_TOKENS_PER_CALL = 4000; // same figure translateScript uses, same reasoning: leaves headroom under a conservative ~8000 TPM ceiling once the (now much smaller) prompt is added on top

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

async function callGroq(sourceObj: Record<string, string>, target_language: string, apiKey: string): Promise<{ ok: true; parsed: Record<string, unknown> } | { ok: false; error: string }> {
  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
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
    }),
  });

  if (!groqResponse.ok) {
    const errData = await groqResponse.json().catch(() => ({}));
    return { ok: false, error: errData.error?.message || `Groq API returned ${groqResponse.status}` };
  }

  const groqData = await groqResponse.json();
  const raw = groqData.choices?.[0]?.message?.content;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Model did not return a valid JSON object.' };
    return { ok: true, parsed };
  } catch {
    return { ok: false, error: 'Model response was not valid JSON (likely cut off mid-response).' };
  }
}

// Translates one chunk of keys; on failure, splits it in half and retries each half in turn
// (never in parallel) until it either succeeds or is down to a single key it still can't
// translate — see the big comment above for why a size-related failure needs this rather than
// a flat retry of the same oversized request.
async function translateChunk(
  chunkKeys: string[],
  entries: Record<string, string>,
  target_language: string,
  apiKey: string
): Promise<{ translated: Record<string, string>; failed: { key: string; error: string }[] }> {
  const sourceObj: Record<string, string> = {};
  for (const k of chunkKeys) sourceObj[k] = entries[k];

  const result = await callGroq(sourceObj, target_language, apiKey);

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
    return { translated, failed };
  }

  if (chunkKeys.length > 1) {
    const mid = Math.ceil(chunkKeys.length / 2);
    const first = await translateChunk(chunkKeys.slice(0, mid), entries, target_language, apiKey);
    const second = await translateChunk(chunkKeys.slice(mid), entries, target_language, apiKey);
    return {
      translated: { ...first.translated, ...second.translated },
      failed: [...first.failed, ...second.failed],
    };
  }

  return { translated: {}, failed: chunkKeys.map(k => ({ key: k, error: result.error })) };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { entries, target_language, apiKey } = body;

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

    const keys = Object.keys(entries);
    const chunks = buildChunks(keys, entries);
    const translated: Record<string, string> = {};
    const failedKeys: string[] = [];
    const failureReasons = new Set<string>();
    const unpreservedWarnings: string[] = [];

    for (const chunkKeys of chunks) {
      const { translated: chunkTranslated, failed } = await translateChunk(chunkKeys, entries, target_language, apiKey);
      for (const [k, v] of Object.entries(chunkTranslated)) {
        translated[k] = v;
        const missing = findUnpreservedPlaceholders(entries[k], v);
        if (missing.length > 0) unpreservedWarnings.push(`${k} (${missing.join(', ')})`);
      }
      for (const f of failed) {
        failedKeys.push(f.key);
        failureReasons.add(f.error);
      }
    }

    if (Object.keys(translated).length === 0) {
      return Response.json({ error: `No translations were returned — try again, or fill these in by hand. Last error: ${[...failureReasons][0] || 'unknown'}` }, { status: 500 });
    }

    return Response.json({
      translations: translated,
      failed_keys: failedKeys,
      // A handful of DISTINCT error messages (not one per failed key — that could be dozens
      // of copies of the same underlying cause) so a failure is diagnosable instead of just
      // a bare count with no way to tell a size problem from a bad key from an expired key.
      ...(failureReasons.size > 0 ? { failure_reasons: [...failureReasons].slice(0, 5) } : {}),
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
