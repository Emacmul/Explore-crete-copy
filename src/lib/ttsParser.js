/**
 * Parses a narration script containing <break> tags into ordered segments.
 * Supports: <break time="2s"/>, <break 2s>, <break time="500ms"/>, <break strength="medium"/>
 */
export const parseScript = (text) => {
  if (!text || !text.trim()) return [];

  const breakRegex = /<break\s+(?:time="(\d+(?:\.\d+)?)s"|time="(\d+(?:\.\d+)?)ms"|(\d+(?:\.\d+)?)s|strength="(\w+)")\s*\/?>/gi;
  const segments = [];
  let lastIndex = 0;
  let match;
  let id = 0;

  while ((match = breakRegex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index).trim();
    if (textBefore) {
      segments.push({ id: id++, type: 'text', content: textBefore });
    }

    let duration = 1;
    if (match[1]) duration = parseFloat(match[1]);
    else if (match[2]) duration = parseFloat(match[2]) / 1000;
    else if (match[3]) duration = parseFloat(match[3]);
    else if (match[4]) {
      const s = match[4].toLowerCase();
      duration = s === 'strong' ? 2 : s === 'weak' ? 0.5 : 1;
    }
    duration = Math.max(0.5, duration);

    segments.push({ id: id++, type: 'pause', duration });
    lastIndex = breakRegex.lastIndex;
  }

  const textAfter = text.slice(lastIndex).trim();
  if (textAfter) {
    segments.push({ id: id++, type: 'text', content: textAfter });
  }

  return segments;
};

export const rebuildScript = (segments) => {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.content;
      return `<break time="${seg.duration}s"/>`;
    })
    .join('\n\n');
};

export const countCharacters = (segments) =>
  segments.filter((s) => s.type === 'text').reduce((sum, s) => sum + s.content.length, 0);

export const countBreaks = (segments) =>
  segments.filter((s) => s.type === 'pause').length;