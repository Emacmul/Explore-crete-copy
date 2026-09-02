import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

// Each admin/narrator's own Google TTS and Groq API keys — stored server-side, tied to
// their own account, via the manageApiKeys backend function. Previously lived only in
// that one browser's localStorage, which meant clearing site data (or just opening the
// app on a different browser or device) silently wiped it with no way to recover it.
// Works for either caller: an admin identified by their real Base44 session, or a
// narrator identified the same way every other narrator action in this app is — their
// own email+token, read directly from the same sessionStorage key Narr.jsx itself uses,
// so nothing needs threading through as a prop just for this.
const NARR_SESSION_KEY = 'narr_session';

function getNarratorToken() {
  try {
    const sess = JSON.parse(sessionStorage.getItem(NARR_SESSION_KEY) || 'null');
    return sess?.token || null;
  } catch {
    return null;
  }
}

export function useNarratorApiKeys() {
  const [keys, setKeys] = useState({ google_tts_api_key: '', groq_api_key: '', groq_api_key_2: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // True only in the instant right after a GET has actually confirmed what's on the
  // server. Deliberately reset to false at the start of every load (including a retry),
  // not just on the very first one — a save is only ever safe when what's on screen is
  // known-fresh, not a stale or blank guess. This is what saveKeys below checks before
  // writing anything, so a failed/slow load (a refresh landing before the session is
  // fully re-established, a network hiccup, etc.) can never result in blank fields
  // silently overwriting a real saved key.
  const [loadedOk, setLoadedOk] = useState(false);
  // TEMPORARY DIAGNOSTIC (see CLAUDE_CHANGELOG.md, follow-up 61): manageApiKeys now
  // echoes back, on every 'get', exactly how it identified the caller and what it found
  // (see that function's own comment for why) — captured here, additively, so any
  // consumer of this hook can surface it. Not used to decide anything; purely evidence
  // for the still-open "No Google TTS API key found despite a real key existing" report.
  const [diag, setDiag] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLoadedOk(false);
    setDiag(null);
    try {
      const res = await base44.functions.invoke('manageApiKeys', { action: 'get', token: getNarratorToken() });
      if (res?.data?.error) {
        setDiag(res?.data?._diag || null);
        throw new Error(res.data.error);
      }
      setKeys({
        google_tts_api_key: res?.data?.google_tts_api_key || '',
        groq_api_key: res?.data?.groq_api_key || '',
        // Optional backup Groq key from a separate account — see groqKeyRotation.ts.
        groq_api_key_2: res?.data?.groq_api_key_2 || '',
      });
      setDiag(res?.data?._diag || null);
      setLoadedOk(true);
    } catch (err) {
      setError(err.message || 'Could not load your saved API keys.');
    }
    setLoading(false);
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
    const res = await base44.functions.invoke('manageApiKeys', { action: 'save', token: getNarratorToken(), ...updates });
    if (res?.data?.error) throw new Error(res.data.error);
    setKeys((prev) => ({ ...prev, ...updates }));
  }, [loadedOk]);

  return { keys, loading, error, loadedOk, saveKeys, reload: load, diag };
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
