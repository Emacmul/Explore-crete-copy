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
    // Groq's per-request token budget means one call can't safely carry the whole UI (close
    // to 200 strings) at once — see the max_tokens comment in translateScript for why that
    // matters. Chunking keeps each request comfortably inside budget and means a failure only
    // costs the keys in that one chunk rather than the entire seeding pass.
    const CHUNK_SIZE = 40;
    const translated: Record<string, string> = {};
    const failedKeys: string[] = [];
    const unpreservedWarnings: string[] = [];

    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunkKeys = keys.slice(i, i + CHUNK_SIZE);
      const sourceObj: Record<string, string> = {};
      for (const k of chunkKeys) sourceObj[k] = entries[k];

      const prompt = `Translate the string VALUES in this JSON object from English into ${target_language}. Keep the JSON keys exactly as given, unchanged.

CRITICAL RULES:
1. Translate only the values, never the keys.
2. Some values contain tokens like {n}, {label}, {total}, {page} — these are placeholders the app substitutes with real data at runtime. Copy every such {token} through EXACTLY as written — same braces, same name inside, same position in the sentence. Never translate, rename, reorder, or drop them.
3. Preserve any \\n line breaks within a value, in the same positions.
4. Keep translations natural and concise, suitable for compact UI text (buttons, labels, short messages) — not narration prose.
5. Return ONLY a single valid JSON object with the same keys and their translated values. No explanations, no markdown, no commentary — just the JSON object.

JSON:
${JSON.stringify(sourceObj)}`;

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
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
          max_tokens: 6000,
        }),
      });

      if (!groqResponse.ok) {
        const errData = await groqResponse.json().catch(() => ({}));
        // One bad chunk (rate limit, transient error) shouldn't sink the whole pass — record
        // it as failed and keep going, same "best-effort per unit" spirit as translateScript's
        // preservation check never failing the overall translation.
        failedKeys.push(...chunkKeys);
        continue;
      }

      const groqData = await groqResponse.json();
      const raw = groqData.choices?.[0]?.message?.content;
      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') {
        failedKeys.push(...chunkKeys);
        continue;
      }

      for (const k of chunkKeys) {
        const value = parsed[k];
        if (typeof value === 'string' && value.trim()) {
          const finalValue = value.trim();
          translated[k] = finalValue;
          const missing = findUnpreservedPlaceholders(entries[k], finalValue);
          if (missing.length > 0) unpreservedWarnings.push(`${k} (${missing.join(', ')})`);
        } else {
          failedKeys.push(k);
        }
      }
    }

    if (Object.keys(translated).length === 0) {
      return Response.json({ error: 'No translations were returned — try again, or fill these in by hand.' }, { status: 500 });
    }

    return Response.json({
      translations: translated,
      failed_keys: failedKeys,
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
