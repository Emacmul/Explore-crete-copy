import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage, withTimeout } from '@/lib/utils';

// One read of the LinguaGloss pronunciation dictionary for the script editor's own
// "which of these names are in the dictionary" check. Fetched once per editor mount (the
// dictionary is a few hundred names, and it only changes when someone edits it in
// LinguaGloss), then on demand: `reload` is what the panel's Refresh button calls and what
// runs after the panel itself adds/edits an entry. Without that, a name added in LinguaGloss
// while this editor stayed open was simply never seen — which is exactly how a word that
// WAS in the dictionary kept being reported as missing (Enda, 2026-11-05).
//
// `loading` is the FIRST load only (the panel shows a spinner); `refreshing` is a reload on
// top of a list that's already on screen, so the matches never disappear mid-check.
export default function usePronunciationEntries() {
  const [entries, setEntries] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const res = await withTimeout(
        base44.functions.invoke('pronunciationDictionary', { action: 'list', ...getNarratorAuthPayload() }),
        20000,
        'Loading the pronunciation dictionary is taking too long.'
      );
      if (res?.data?.error) throw new Error(res.data.error);
      setEntries(res?.data?.entries || []);
      setLanguages(res?.data?.languages || []);
    } catch (err) {
      setError(getFnErrorMessage(err, 'Could not load the pronunciation dictionary.'));
    }
    setRefreshing(false);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return { entries, languages, loading, refreshing, error, reload: load };
}