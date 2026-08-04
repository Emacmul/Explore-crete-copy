import { useState, useCallback } from 'react';

// Each narrator's own Google TTS and Groq API keys, stored ONLY in this browser's localStorage
// — same as Enda's existing VoiceScript and TTS Studio tools. Keys never touch the server or any
// database record; they only ever travel from this browser directly to Explore Crete's own
// backend function (which needs the key to make the actual Google/Groq request on the
// narrator's behalf), but are never saved there.
const GOOGLE_KEY_STORAGE = 'explore_crete_google_tts_api_key';
const GROQ_KEY_STORAGE = 'explore_crete_groq_api_key';

function readKeys() {
  let google = '';
  let groq = '';
  try {
    google = localStorage.getItem(GOOGLE_KEY_STORAGE) || '';
    groq = localStorage.getItem(GROQ_KEY_STORAGE) || '';
  } catch (err) {
    // localStorage unavailable (private browsing, storage disabled) — keys just stay empty for
    // this session rather than breaking the page.
  }
  return { google_tts_api_key: google, groq_api_key: groq };
}

export function useNarratorApiKeys() {
  const [keys, setKeys] = useState(readKeys);

  const saveKeys = useCallback((updates) => {
    try {
      if (updates.google_tts_api_key !== undefined) {
        localStorage.setItem(GOOGLE_KEY_STORAGE, updates.google_tts_api_key);
      }
      if (updates.groq_api_key !== undefined) {
        localStorage.setItem(GROQ_KEY_STORAGE, updates.groq_api_key);
      }
    } catch (err) {
      throw new Error('Could not save to this browser\'s storage. Check your browser allows local storage (not in private/incognito mode).');
    }
    setKeys((prev) => ({ ...prev, ...updates }));
  }, []);

  return { keys, loading: false, saveKeys };
}
