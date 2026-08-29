import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { resolveActor } from '../../shared/backendActor.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { text, target_language, apiKey } = body;

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

    const prompt = `Translate the following narration script into ${target_language}.

CRITICAL RULES:
1. Preserve ALL <break> tags EXACTLY as they are — same tag, same duration. Do not modify, move, translate, or remove them.
2. Only translate the spoken narration text between the break tags.
3. Keep the translation natural and conversational, suitable for spoken audio narration.
4. If the script starts with a title line, translate the title too.
5. Return ONLY the translated text with break tags preserved. No explanations, no markdown, no commentary — just the translated script.

Script:
${text}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
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
            content: 'You are a professional translator for audio narration scripts. You always preserve SSML <break> tags exactly as written.',
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
      }),
    });

    if (!groqResponse.ok) {
      const errData = await groqResponse.json().catch(() => ({}));
      return Response.json({
        error: errData.error?.message || `Groq API returned ${groqResponse.status}`,
      }, { status: 500 });
    }

    const groqData = await groqResponse.json();
    const translatedText = groqData.choices?.[0]?.message?.content;

    if (!translatedText) {
      return Response.json({ error: 'No translation returned' }, { status: 500 });
    }

    return Response.json({ translated_text: translatedText.trim() });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});