import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

// Each admin/narrator's own Google TTS and Groq API keys — stored server-side, tied to
// their own account, via the manageApiKeys backend function. Previously lived only in
// that one browser's localStorage, which meant clearing site data (or just opening the
// app on a different browser or device) silently wiped it with no way to recover it.
// Works for either caller: an admin identified by their real Base44 session, or a
// narrator identified the same way every other narrator action in this app is — via
// getNarratorAuthPayload() below (email + narrToken, checked server-side against
// AppUser.narr_session_token by resolveActor). manageApiKeys used to be sent a
// differently-shaped `token` instead and tried to validate it as a WordPress login
// token, which it never was — that mismatch meant every real narrator's get/save
// failed with "Not authorized" (fixed 2026-09-02; see manageApiKeys/entry.ts).
//
// Per the 2026-10-05 report ("No Google TTS API key found" shown twice in one hour to
// narrators whose key was definitely saved): every hook instance used to fire its own
// GET on mount, and ANY single failed GET (a network hiccup, the known transient 409
// during a function redeploy, the Narr session not quite established yet on an eager
// automatic-on-mount fetch) left the keys empty for that panel — which then misread
// "the load failed" as "no key exists". Two changes close that:
//   1. A load is retried up to 3 times with a short backoff before an error is
//      surfaced at all.
//   2. Keys that load successfully are cached at module level for the rest of the
//      browser session, so every OTHER panel using this hook starts from the
//      known-good copy instead of re-fetching and racing the same transient failure
//      again. saveKeys keeps the cache in sync, so an updated key is seen everywhere
//      immediately; a page refresh starts from a fresh GET as always.

const EMPTY_KEYS = { google_tts_api_key: '', groq_api_key: '', groq_api_key_2: '', elevenlabs_api_key: '', elevenlabs_voice_id: '' };
let cachedKeys = null;

export function useNarratorApiKeys() {
  const [keys, setKeys] = useState(() => (cachedKeys ? { ...cachedKeys } : { ...EMPTY_KEYS }));
  const [loading, setLoading] = useState(!cachedKeys);
  const [error, setError] = useState('');
  // True only once a GET (this session's, or the cached one from earlier in this same
  // browser session) has actually confirmed what's on the server. Deliberately reset
  // to false at the start of every load (including a retry), not just on the very
  // first one — a save is only ever safe when what's on screen is known-fresh, not a
  // stale or blank guess. This is what saveKeys below checks before writing anything,
  // so a failed/slow load (a refresh landing before the session is fully
  // re-established, a network hiccup, etc.) can never result in blank fields silently
  // overwriting a real saved key.
  const [loadedOk, setLoadedOk] = useState(!!cachedKeys);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLoadedOk(false);
    let fresh = null;
    let failed = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await base44.functions.invoke('manageApiKeys', { action: 'get', ...getNarratorAuthPayload() });
        if (res?.data?.error) {
          throw new Error(res.data.error);
        }
        fresh = {
          google_tts_api_key: res?.data?.google_tts_api_key || '',
          groq_api_key: res?.data?.groq_api_key || '',
          // Optional backup Groq key from a separate account — see groqKeyRotation.ts.
          groq_api_key_2: res?.data?.groq_api_key_2 || '',
          // Optional — this narrator's own ElevenLabs account, used to generate the tour's
          // system voice messages (off-route/GPS/speed alerts) in their own PCV voice.
          elevenlabs_api_key: res?.data?.elevenlabs_api_key || '',
          elevenlabs_voice_id: res?.data?.elevenlabs_voice_id || '',
        };
        break;
      } catch (err) {
        failed = err;
        // A real "Not authorized"/"no record" answer comes back identically on every
        // retry, so the retries only cost a couple of seconds in the genuinely-broken
        // cases — but they ride out the transient ones (409s, session settling) that
        // used to be reported to narrators as a missing key.
        if (attempt < 2) await new Promise((r) => setTimeout(r, attempt === 0 ? 600 : 1800));
      }
    }
    setLoading(false);
    if (fresh) {
      cachedKeys = fresh;
      setKeys(fresh);
      setLoadedOk(true);
      return fresh;
    }
    setError(failed?.message || 'Could not load your saved API keys.');
    return null;
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveKeys = useCallback(async (updates) => {
    // Refuse to save unless we've actually confirmed the current values from the server
    // this session — otherwise a save right after a failed load would write blank/stale
    // fields over a real, already-saved key. This is enforced here (not just by disabling
    // the button in the UI) so it can't be bypassed.
    if (!loadedOk) {
      throw new Error('Your saved keys haven’t loaded yet — please retry loading before saving, so a real key isn’t overwritten by a blank one.');
    }
    let res;
    try {
      res = await base44.functions.invoke('manageApiKeys', { action: 'save', ...getNarratorAuthPayload(), ...updates });
    } catch (err) {
      // functions.invoke rejects as a plain axios error on a non-2xx response, with the
      // function's own JSON body (the human-readable reason, plus invalid_fields naming
      // exactly which keys the provider rejected) nested under err.response.data —
      // surface that, not the useless "Request failed with status code 400".
      const e = new Error(err?.response?.data?.error || err?.message || 'Could not save your keys. Please try again.');
      e.invalidFields = err?.response?.data?.invalid_fields || [];
      throw e;
    }
    if (res?.data?.error) {
      const e = new Error(res.data.error);
      e.invalidFields = res.data.invalid_fields || [];
      throw e;
    }
    cachedKeys = { ...(cachedKeys || EMPTY_KEYS), ...updates };
    setKeys((prev) => ({ ...prev, ...updates }));
  }, [loadedOk]);

  return { keys, loading, error, loadedOk, saveKeys, reload: load };
}

// Small helper reused by every admin/narrator tool that calls a backend function
// requiring resolveActor()'s dual-path check (admin session, or narrator email+token).
// An admin needs nothing extra here — their real Base44 session is what resolveActor
// checks automatically. A narrator has no such session, so their identity has to be
// included explicitly in the request body — read directly from the same sessionStorage
// key Narr.jsx itself uses, the same approach already used for the API keys hook, so
// nothing needs threading through as a prop just for this.
export function getNarratorAuthPayload() {
  try {
    const sess = JSON.parse(sessionStorage.getItem('narr_session') || 'null');
    if (sess?.email && sess?.token) {
      return { email: sess.email, narrToken: sess.token };
    }
  } catch { /* not a narrator session — admin path needs nothing extra */ }
  return {};
}