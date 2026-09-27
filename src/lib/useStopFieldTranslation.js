import { useEffect, useRef, useState } from 'react';
import { useNarratorApiKeys, getNarratorAuthPayload } from '@/lib/useNarratorApiKeys';
import { translateWalkField, stillMatchesMaster } from '@/lib/fieldTranslation';

// Per Enda (follow-up 245): each stop's own name and short description are shown to
// customers (the "Tour Stops" list, and while driving) just like the tour's overall
// Description and Safety Notes — so they need the same "already translated, edit and
// correct" treatment a narrator already gets for narration scripts. Unlike Description/
// Safety Notes (translated once, the moment the whole clone is created — see
// handleCloneTour in BackendShell.jsx), a tour can have dozens of stops, so translating
// all of them the instant the clone exists would fire that many Groq calls back to back
// and walk straight into Groq's own per-minute rate limit. Instead, each stop's two
// fields are auto-translated the moment a narrator actually opens THAT stop —
// spread out naturally over however long they spend working through the tour, the same
// "quietly fetch it the moment this waypoint is open" idea TranslationPanel.jsx already
// uses for the shared script depository.
//
// Extracted from TourSimulator.jsx (2026-09-27) purely so that file stays under the
// platform's editable size limit — behaviour is unchanged; form/allWalks/selectedWp/
// rawIndexForSelected/onWaypointUpdate are now passed in explicitly instead of being
// component closures.
export function useStopFieldTranslation({ form, allWalks, selectedWp, rawIndexForSelected, onWaypointUpdate }) {
  const { keys: stopFieldApiKeys } = useNarratorApiKeys();
  const masterWalkForStops = form.clone_of ? allWalks.find(w => w.id === form.clone_of) : null;
  const masterWp = masterWalkForStops?.waypoints?.[rawIndexForSelected] || null;
  const [translatingStopField, setTranslatingStopField] = useState(null); // 'segment_title' | 'description' | null
  const [stopFieldError, setStopFieldError] = useState({});
  // Tracks which waypoint+field combinations this browser tab has already tried to
  // auto-translate, so the effect below never fires twice for the same stop — whether it
  // succeeded (the box no longer matches the master, so the check below would already
  // skip it) or failed (a rate limit, no API key yet) and would otherwise retry on every
  // re-render. Cleared only by leaving and reopening this clone.
  const autoTranslateAttempted = useRef(new Set());

  const translateStopField = async (field) => {
    if (!form.id || !form.clone_of || !form.target_language) return;
    setStopFieldError(prev => ({ ...prev, [field]: '' }));
    if (!stopFieldApiKeys.groq_api_key) {
      setStopFieldError(prev => ({ ...prev, [field]: 'No Groq API key found for your account yet. Add your own key via "API Keys" in the header.' }));
      return;
    }
    setTranslatingStopField(field);
    try {
      const translated = await translateWalkField({
        field, waypointIndex: rawIndexForSelected, walkId: form.id,
        targetLanguage: form.target_language, apiKeys: stopFieldApiKeys, authPayload: getNarratorAuthPayload(),
      });
      onWaypointUpdate(rawIndexForSelected, field, translated);
    } catch (err) {
      setStopFieldError(prev => ({ ...prev, [field]: err?.message || 'Could not translate this text.' }));
    }
    setTranslatingStopField(null);
  };

  useEffect(() => {
    if (!form.clone_of || !form.target_language || form.target_language === 'English') return;
    if (!selectedWp || !masterWp) return;
    if (!stopFieldApiKeys.groq_api_key) return; // nothing to auto-fire with yet — manual Translate button still works once one's added
    for (const field of ['segment_title', 'description']) {
      const attemptKey = `${rawIndexForSelected}:${field}`;
      if (autoTranslateAttempted.current.has(attemptKey)) continue;
      if (!stillMatchesMaster(selectedWp[field], masterWp[field])) continue; // already translated or hand-edited
      autoTranslateAttempted.current.add(attemptKey);
      translateWalkField({
        field, waypointIndex: rawIndexForSelected, walkId: form.id,
        targetLanguage: form.target_language, apiKeys: stopFieldApiKeys, authPayload: getNarratorAuthPayload(),
      })
        .then(translated => onWaypointUpdate(rawIndexForSelected, field, translated))
        .catch(err => console.error(`Auto-translating a stop's ${field} failed (English text left in place, the Translate button still works):`, err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawIndexForSelected, form.clone_of, form.target_language, stopFieldApiKeys.groq_api_key]);

  // A stale error from the PREVIOUS stop (e.g. "no API key yet") must not linger and
  // wrongly appear to be about whichever stop is open now.
  useEffect(() => { setStopFieldError({}); }, [rawIndexForSelected]);

  return { masterWp, translatingStopField, stopFieldError, translateStopField };
}