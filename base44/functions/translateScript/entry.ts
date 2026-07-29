import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { text, target_language } = body;

    if (!text || !text.trim()) {
      return Response.json({ error: 'Missing text to translate' }, { status: 400 });
    }
    if (!target_language) {
      return Response.json({ error: 'Missing target language' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Groq API key not configured' }, { status: 500 });
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
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a professional translator for audio narration scripts. You always preserve SSML <break> tags exactly as written.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
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