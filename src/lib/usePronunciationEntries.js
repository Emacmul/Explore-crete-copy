import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { getFnErrorMessage, withTimeout } from '@/lib/utils';

// One read of the LinguaGloss pronunciation dictionary for the script editor's own
// "which of these names are in the dictionary" check. Fetched once per editor mount (the
// dictionary is a few hundred names, and it only changes when someone edits it in
// LinguaGloss), never per keystroke.
export default function usePronunciationEntries() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await withTimeout(
        base44.functions.invoke('pronunciationDictionary', { action: 'list', ...getNarratorAuthPayload() }),
        20000,
        'Loading the pronunciation dictionary is taking too long.'
      );
      if (res?.data?.error) throw new Error(res.data.error);
      setEntries(res?.data?.entries || []);
    } catch (err) {
      setError(getFnErrorMessage(err, 'Could not load the pronunciation dictionary.'));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return { entries, loading, error, reload: load };
}