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
