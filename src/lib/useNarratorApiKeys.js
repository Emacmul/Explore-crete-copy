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
  const [keys, setKeys] = useState({ google_tts_api_key: '', groq_api_key: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('manageApiKeys', { action: 'get', token: getNarratorToken() });
      if (res?.data?.error) throw new Error(res.data.error);
      setKeys({
        google_tts_api_key: res?.data?.google_tts_api_key || '',
        groq_api_key: res?.data?.groq_api_key || '',
      });
    } catch (err) {
      setError(err.message || 'Could not load your saved API keys.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveKeys = useCallback(async (updates) => {
    const res = await base44.functions.invoke('manageApiKeys', { action: 'save', token: getNarratorToken(), ...updates });
    if (res?.data?.error) throw new Error(res.data.error);
    setKeys((prev) => ({ ...prev, ...updates }));
  }, []);

  return { keys, loading, error, saveKeys, reload: load };
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
