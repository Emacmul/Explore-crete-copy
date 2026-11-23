// Naming helpers for Walk/Hike (WHT) waypoints.
//
// A tour-style GPX names its points "<code><location><letter>[-PS]", e.g.
// "API1a-PS Agios Konstantinos car park", "API1b", "API1c", "API2a-PS". Those
// letters are narration sub-points inside ONE location — they mean nothing to a
// walking route, which needs one marker per place. Per Enda (2026-11-23): the
// Agios Konstantinos walk showed a list of rows titled "c", "d", "a-PS", "API1b",
// which made no sense at all. Everything below reads those names properly.

// A leftover sub-point token on its own ("b", "c", "a-PS") is never a title.
const SUB_POINT_ONLY = /^[A-Za-z]?(-PS)?$/i;

// Strips an imported name down to the descriptive words: a leading sub-point
// token ("a-PS - ", "b - ", "c: ") and/or a leading location code
// ("API1a-PS ", "MXR4 ") are removed. Returns '' when nothing descriptive is left.
export function cleanWaypointTitle(text) {
  let t = String(text ?? '').trim();
  if (!t) return '';
  t = t.replace(/^[A-Za-z](-PS)?\s*[-–—:.]\s+/i, '').trim();
  t = t.replace(/^[A-Za-z]{1,6}\d+[A-Za-z]?(-PS)?\s*[-–—:.]?\s+/i, '').trim();
  // Nothing but a bare code left ("API1b", "MXR4") — that is the marker's badge, not a
  // title. Returning '' keeps the row showing only its code instead of "API7 — API1b"
  // (Enda, 2026-11-23: every point is imported now, so this happens a lot).
  if (/^[A-Za-z]{1,6}\d+[A-Za-z]?(-PS)?$/i.test(t)) return '';
  return SUB_POINT_ONLY.test(t) ? '' : t;
}

// Splits an imported GPX name into its location number, sub-point letter and the
// descriptive title. "API1a-PS Agios Konstantinos car park" →
// { number: 1, letter: 'a', isPS: true, title: 'Agios Konstantinos car park' }.
export function parseWaypointName(raw) {
  const text = String(raw ?? '').trim();
  const match = text.match(/^[A-Za-z]{0,6}\s*(\d+)\s*([A-Za-z])?\s*(-PS)?\s*(?:[-–—:.]\s*)?(.*)$/i);
  if (!match) return { number: null, letter: '', isPS: false, title: cleanWaypointTitle(text) };
  const title = cleanWaypointTitle(match[4] || '');
  return {
    number: parseInt(match[1], 10),
    letter: (match[2] || '').toLowerCase(),
    isPS: !!match[3],
    title,
  };
}

// Folds a walk's imported waypoints down to ONE marker per location: every point
// sharing a location number (API1a-PS, API1b, API1c…) becomes a single waypoint at
// the location's start point, titled with the first descriptive text found among
// them. Points without a location number are left exactly as they are.
export function mergeWalkSubPoints(list, code) {
  const groups = new Map();
  list.forEach((wp, i) => {
    const parsed = parseWaypointName(wp.segment_id);
    const key = parsed.number != null ? `n${parsed.number}` : `i${i}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { anchor: wp, items: [wp], number: parsed.number });
    } else {
      group.items.push(wp);
      if (parsed.isPS) group.anchor = wp;
    }
  });

  return Array.from(groups.values()).map(({ anchor, items, number }) => {
    const title = items
      .map(it => it.name || parseWaypointName(it.segment_id).title)
      .find(t => !!t) || '';
    return {
      ...anchor,
      segment_id: (code && number != null) ? `${code}${number}` : anchor.segment_id,
      name: title,
      description: anchor.description || items.find(it => it.description)?.description || '',
    };
  });
}