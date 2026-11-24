import React from 'react';
import OriginalEnglishText from './OriginalEnglishText';
import { useEnglishReferenceHidden } from '@/lib/englishReference';
import { isRtlLanguage } from '@/lib/textDirection';

// Per Enda (2026-11-24): inside a Hebrew/Arabic clone, a stop's own Location Title and
// Description must work exactly like the tour's Description / Before You Set Off in the
// General tab — the read-only English original from the MASTER tour sits directly above
// the box the translation is written into, so the narrator keeps both on screen and never
// has to overwrite the English text in place to write the translation. Same two rules as
// everywhere else that shows an English reference:
//
//  • RTL clones only (isRtlLanguage) — for a left-to-right target language the box holds
//    its own text and there is nothing to read the other way round.
//  • One switch for the whole clone — the shared EnglishReferenceBar flag, so hiding the
//    English here hides it on every tab and every stop at once, and it can be brought back
//    at any time. It is a device-side reading preference, never saved onto the tour.
//
// The English text is read straight from the master tour and only ever rendered here in
// the editor: it is never stored on the clone and never reaches the customer front end,
// which only ever serves the clone's own (translated) text.
export default function WaypointEnglishReference({ walkId, targetLanguage, masterWp, field, unavailable = false }) {
  const [hidden] = useEnglishReferenceHidden(walkId);
  if (!targetLanguage || !isRtlLanguage(targetLanguage) || hidden) return null;
  return (
    <div className="mb-1.5">
      <OriginalEnglishText
        text={masterWp ? masterWp[field] || '' : ''}
        unavailable={unavailable}
        empty={field === 'segment_title'
          ? 'No English location title is stored for this waypoint.'
          : 'No English description is stored for this waypoint.'}
      />
    </div>
  );
}