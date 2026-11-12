import { useCallback, useEffect, useState } from 'react';

// Whether the read-only English original is hidden for one translation clone.
//
// Per the Hebrew narrator's request (2026-11-12): the English master text and her own
// translation must stay side by side for as long as she is translating — on every tab
// and at every stop of a walk, walkabout or driveabout — and then be removed in ONE
// action once the whole tour is done. Before this, "Remove original" only cleared the
// single panel it was clicked on: NarrationTtsEditor kept that choice in component
// state, and it is remounted per stop, so the English came straight back at the next
// waypoint and there was never a point at which the clone was genuinely "removed".
//
// Keyed by the CLONE's own Walk id, so one click covers every tab and every stop, and
// survives navigating away and back. Stored on the device (localStorage) on purpose: it
// is a reading preference, never tour data, so it must not need a Save Route — that runs
// the publish-readiness checks a narrator shouldn't be triggering to hide a panel.
const KEY = 'ec.englishReference.hidden.v1';
const EVENT = 'ec-english-reference-changed';

function readAll() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function isEnglishReferenceHidden(walkId) {
  if (!walkId) return false;
  return !!readAll()[walkId];
}

export function setEnglishReferenceHidden(walkId, hidden) {
  if (!walkId) return;
  const all = readAll();
  if (hidden) all[walkId] = true;
  else delete all[walkId];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked — the English simply stays on screen, which is the safe side.
  }
  // Every reference panel on the page listens for this, so one click updates the whole
  // editor at once (the tab the narrator is on, and the tabs they switch to after).
  window.dispatchEvent(new Event(EVENT));
}

// [hidden, setHidden] for one clone. Panels use it only to decide whether to draw
// themselves; the single user-facing control is EnglishReferenceBar.
export function useEnglishReferenceHidden(walkId) {
  const [hidden, setHiddenState] = useState(() => isEnglishReferenceHidden(walkId));

  useEffect(() => {
    const sync = () => setHiddenState(isEnglishReferenceHidden(walkId));
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [walkId]);

  const setHidden = useCallback((next) => setEnglishReferenceHidden(walkId, next), [walkId]);
  return [hidden, setHidden];
}