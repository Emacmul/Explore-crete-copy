/**
 * Central speaking rate (words per minute).
 * Adjust this default to change the rate used across all script timing calculations.
 */
export const DEFAULT_SPEAKING_RATE = 120;

/**
 * SSML <break> strength → milliseconds mapping (W3C SSML spec approximations).
 */
const BREAK_STRENGTH_MS = {
  'none': 0,
  'x-weak': 250,
  'weak': 500,
  'medium': 750,
  'strong': 1500,
  'x-strong': 3000,
};

/**
 * Parse all SSML <break> tags in a script and return total pause duration in seconds.
 *
 * Supports:
 *   <break time="500ms"/>
 *   <break time="2s"/>
 *   <break time="1.5s"/>
 *   <break strength="medium"/>
 *   <break/>  (defaults to weak — 250ms)
 */
export function parseSSMLBreaks(script) {
  if (!script) return 0;
  let totalMs = 0;
  const breakRegex = /<break\b[^>]*\/?>/gi;
  const matches = script.match(breakRegex) || [];
  for (const tag of matches) {
    const timeMatch = tag.match(/time=["']([^"']+)["']/i);
    if (timeMatch) {
      const val = timeMatch[1].trim().toLowerCase();
      if (val.endsWith('ms')) {
        totalMs += parseFloat(val) || 0;
      } else if (val.endsWith('s')) {
        totalMs += (parseFloat(val) || 0) * 1000;
      }
    } else {
      const strengthMatch = tag.match(/strength=["']([^"']+)["']/i);
      if (strengthMatch) {
        const strength = strengthMatch[1].trim().toLowerCase();
        totalMs += BREAK_STRENGTH_MS[strength] ?? 500;
      } else {
        totalMs += 250;
      }
    }
  }
  return totalMs / 1000;
}

/**
 * Count spoken words in a script, excluding all SSML/XML tags.
 */
export function countScriptWords(script) {
  if (!script) return 0;
  const textOnly = script.replace(/<[^>]+>/g, ' ');
  return textOnly.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Calculate estimated narration duration in seconds.
 *
 * Combines spoken-word time (based on WPM) with SSML break durations
 * to produce the expected duration of the finished recording.
 */
export function calculateNarrationDuration(script, wpm) {
  if (!script || !wpm || wpm <= 0) return 0;
  const wordCount = countScriptWords(script);
  const wordTime = (wordCount / wpm) * 60;
  const pauseTime = parseSSMLBreaks(script);
  return wordTime + pauseTime;
}

/**
 * Determine whether narration comfortably fits, is close, or overruns travel time.
 *
 * Returns: { status: 'comfortable'|'close'|'overrun', diff: seconds, label: string }
 */
export function compareTiming(travelSeconds, narrationSeconds) {
  const diff = travelSeconds - narrationSeconds;
  if (travelSeconds <= 0) {
    return { status: 'neutral', diff: 0, label: '—' };
  }
  const ratio = narrationSeconds / travelSeconds;
  if (ratio <= 0.9) {
    return { status: 'comfortable', diff, label: `Remaining: ${Math.round(diff)}s` };
  } else if (ratio <= 1.0) {
    return { status: 'close', diff, label: `Remaining: ${Math.round(diff)}s` };
  } else {
    return { status: 'overrun', diff, label: `Overrun: ${Math.round(Math.abs(diff))}s` };
  }
}