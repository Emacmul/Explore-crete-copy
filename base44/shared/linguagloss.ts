import { createClient } from 'npm:@base44/sdk@0.8.40';
import { wrapClientWithRetry } from './withEntityRetry.ts';

// Bridge to LinguaGloss (linguagloss.magicalcrete.com) — Enda's SEPARATE Base44 app that
// holds the pronunciation dictionary (PronunciationEntry: original_word, language_origin,
// ipa_notation). Extracted out of pronunciationDictionary/entry.ts (2026-11-04) because
// translateScript now needs the same access: the dictionary no longer only steers the PCV
// audio, it also tells translation which words must survive untranslated.
//
// Set these two as SECRETS on THIS app (Explore Crete) — Dashboard → Secrets → Add Secret:
//   LINGUAGLOSS_APP_ID  — LinguaGloss's own Base44 app id
//   LINGUAGLOSS_API_KEY — a PERSONAL ACCESS TOKEN from LinguaGloss's workspace
//                         (Workspace settings → Secrets → Personal access tokens)
// Never commit either value to the repo, and never send them to the browser.
//
// getSecret tries Base44's documented `secrets.get()` from `base44:runtime` first, then
// falls back to `Deno.env.get()` — the way every other secret in this app is read and which
// demonstrably works here. `base44:runtime` may not exist in every app/version, so that
// dynamic import is wrapped in try/catch rather than a static import, which would crash the
// whole function on load if the module isn't there.
export async function getSecret(name: string): Promise<string | null> {
  try {
    const { secrets } = await import('base44:runtime');
    const v = secrets?.get?.(name);
    if (v) return v;
  } catch {
    // base44:runtime not available here — fall through to the proven Deno.env.get path.
  }
  return Deno.env.get(name) || null;
}

export async function linguaglossClient() {
  const [appId, apiKey] = await Promise.all([getSecret('LINGUAGLOSS_APP_ID'), getSecret('LINGUAGLOSS_API_KEY')]);
  if (!appId || !apiKey) return null;
  return wrapClientWithRetry(createClient({ appId, headers: { api_key: apiKey } }));
}

// Short-lived in-memory cache. A translation is usually one of several in a row (a clone
// translates many waypoints back to back), and the dictionary only changes when an admin
// edits it in LinguaGloss — refetching up to 2000 rows for every single waypoint would be
// pure waste. A cold function instance simply refetches.
let cache: { words: string[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Every word in the pronunciation dictionary: the list when it could be read (possibly
// empty, if the dictionary genuinely has no entries), or NULL when LinguaGloss couldn't be
// reached at all. That distinction matters — an unreachable dictionary means words were
// NOT protected from translation, and the narrator needs to be told, rather than silently
// trusting a protection that didn't run.
export async function fetchPronunciationWords(): Promise<string[] | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.words;

  const linguagloss = await linguaglossClient().catch(() => null);
  if (!linguagloss) return null;

  try {
    const entries = await linguagloss.entities.PronunciationEntry.list('original_word', 2000);
    const words = (Array.isArray(entries) ? entries : [])
      .map((e: any) => String(e?.original_word || '').trim())
      .filter(Boolean);
    cache = { words, fetchedAt: Date.now() };
    return words;
  } catch {
    // Keep a previously cached list if there is one — a stale dictionary still protects
    // every word it knows about. Otherwise report the outage honestly.
    return cache?.words || null;
  }
}

// Turns the LinguaGloss client's raw failure into something an admin can act on. Base44
// retired workspace account API keys, so an old-style LINGUAGLOSS_API_KEY now fails with a
// machine error ('account_api_key_blocked') that means nothing to a human — and it fails in
// BOTH places the dictionary is used: the Pronunciation Dictionary window and translation
// protection.
export function linguaglossErrorMessage(err: any): string {
  const msg = String(err?.message || err || '');
  if (msg.includes('account_api_key_blocked') || msg.includes('deprecated') || msg.includes('personal access token')) {
    return 'The pronunciation dictionary can’t be read: the LinguaGloss access key saved in Explore Crete has been retired by the platform. An admin needs to replace LINGUAGLOSS_API_KEY in Dashboard → Secrets with a personal access token created in the LinguaGloss workspace.';
  }
  return msg || 'Could not reach the pronunciation dictionary.';
}