// Lets a caller configure a SECOND Groq API key — from a completely separate Groq account
// — as an automatic fallback. Per Enda: rather than pay Groq for a higher limit on one
// account, or just wait out a rate limit, a second free account is a second, entirely
// independent per-account budget, and trying it costs nothing (no wait needed to attempt
// it, unlike retrying the SAME account's own limit).
//
// This only kicks in on an actual RATE LIMIT (a 429, or a message containing "rate limit")
// from an earlier key. Any other kind of failure (bad request, invalid key, malformed
// response) is returned immediately, unchanged — a different account's key wouldn't fix a
// real error, and silently falling through to another key on a genuine mistake (e.g. a
// typo'd first key) would just hide the real problem instead of surfacing it.
//
// Used by both seedUiTranslations (UI string seeding) and translateScript (narration
// script translation) — the two features that call Groq directly on a caller's own key.

export interface GroqCallResult {
  ok: boolean;
  status?: number;
  data?: any;
  error?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
  keyIndexUsed?: number; // which apiKeys[] entry actually succeeded, or was last tried
}

function parseRetryAfterMs(headerValue: string | null, message: string): number | undefined {
  if (headerValue) {
    const secs = parseFloat(headerValue);
    if (!Number.isNaN(secs)) return Math.ceil(secs * 1000);
  }
  const m = message.match(/try again in ([0-9.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  return undefined;
}

// apiKeys should already be trimmed/filtered to non-empty strings, in the order they
// should be tried (the caller's primary key first, then any backup(s)).
export async function callGroqWithKeyRotation(apiKeys: string[], requestBody: Record<string, unknown>): Promise<GroqCallResult> {
  let lastRateLimited: GroqCallResult | null = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeys[i]}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (groqResponse.ok) {
      const data = await groqResponse.json();
      return { ok: true, data, keyIndexUsed: i };
    }

    const errData = await groqResponse.json().catch(() => ({}));
    const message = errData.error?.message || `Groq API returned ${groqResponse.status}`;
    const rateLimited = groqResponse.status === 429 || /rate.?limit/i.test(message);

    if (!rateLimited) {
      return { ok: false, status: groqResponse.status, error: message, rateLimited: false, keyIndexUsed: i };
    }

    const retryAfterMs = parseRetryAfterMs(groqResponse.headers.get('retry-after'), message);
    // Rate-limited on this key — move straight to the next one, no wait: it's a separate
    // account with its own separate budget, so pausing first would only waste time.
    if (!lastRateLimited || (retryAfterMs ?? Infinity) < (lastRateLimited.retryAfterMs ?? Infinity)) {
      lastRateLimited = { ok: false, status: groqResponse.status, error: message, rateLimited: true, retryAfterMs, keyIndexUsed: i };
    }
  }

  // Every configured key came back rate-limited. Report the SHORTEST wait seen across them —
  // whichever key clears first is enough to make progress again, so there's no reason to
  // make the caller wait for the slower of the two.
  return lastRateLimited ?? { ok: false, error: 'No Groq API key configured.', rateLimited: false };
}
