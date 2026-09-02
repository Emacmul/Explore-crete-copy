import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

// Every base44.functions.invoke() call is a plain axios POST under the hood (see
// @base44/sdk's functions module — it does nothing but `return axios.post(...)`).
// On any non-2xx response, axios rejects with an error whose own `.message` is
// always the generic "Request failed with status code NNN" — never the actual
// reason the backend function returned. That real reason (e.g. "No Groq API key
// found for your account", or whatever a third-party API like Groq/Google TTS
// actually said) lives in `err.response.data.error` instead. Any catch block
// around a base44.functions.invoke() call should use this instead of reading
// err.message directly, or every failure — missing key, bad key, provider outage,
// a genuine bug — looks identical and equally unhelpful on screen.
//
// Per Enda (2026-09-02): a narrator hit a bare "Rate limit exceeded" message with no
// wait time, no explanation, and no hint of what to do — and pointed out that reads
// exactly like "Something went wrong": alarming, with nothing to act on. That
// particular message wasn't coming from Groq or Google at all (every real message
// from either of those already names them and gives a wait time — see the patterns
// below); it was Base44's OWN server briefly limiting how many actions can happen
// per minute, surfacing as a bare, unexplained string with none of this app's usual
// context. Every message this app deliberately writes already says what happened and
// what to do, so those are recognized below and passed through unchanged; anything
// else is assumed to be one of these unexplained platform messages and reworded into
// something calm and actionable instead.
const KNOWN_FN_ERROR_PATTERNS = [
  /groq/i,
  /google/i,
  /not authorized/i,
  /admin only/i,
  /no .*api key/i,
  /missing (entries|target language|audio data|text to translate|walkid)/i,
  /walkid is required/i,
  /no translations? were returned/i,
  /translation returned no text/i,
  /took longer than .* with no response/i,
  /could not (reach|download|check)/i,
  /does not look like a valid/i,
  /too large/i,
  /expected audio\/wav/i,
];

export function isRecognizedFnErrorMessage(raw) {
  const msg = String(raw || '').trim();
  return msg.length > 0 && KNOWN_FN_ERROR_PATTERNS.some((p) => p.test(msg));
}

// Turns a raw error into something a narrator can actually act on, instead of a bare
// technical string that reads like the app is broken. "Not authorized" specifically
// gets its own rewrite (the single most common real cause, for a narrator, is a
// session that quietly expired), everything else this app already writes clearly is
// passed straight through, and anything unrecognized gets the calm, generic
// explanation above rather than being shown as-is.
export function humanizeFnError(raw) {
  const msg = String(raw || '').trim();
  if (!msg) return 'The app hit an unexpected snag, with no reason given. Try again — if it keeps happening, tell Enda.';
  if (/^not authorized$/i.test(msg)) {
    return 'Your Narr Studio login session has expired or wasn\'t recognized. Log out and back in, then try again.';
  }
  if (isRecognizedFnErrorMessage(msg)) return msg;
  // Most often this is Base44's own server briefly limiting how many actions can happen
  // per minute (not Groq, not Google — every real message from either of those already
  // names them, and is caught above) — but since the exact cause can't always be told
  // apart from here, this is deliberately worded as "looks like" rather than a flat
  // claim: still calm and actionable, without asserting more than is actually known.
  return `This looks like a temporary hiccup talking to the app's own server, not Groq or Google — it usually clears on its own within a minute or two, and nothing is lost. Wait a bit, then try again. If it keeps happening, tell Enda. (Technical detail: "${msg}")`;
}

export function getFnErrorMessage(err, fallback) {
  const raw = err?.response?.data?.error || err?.message;
  // A raw message gets the full "is this one of ours, or is it an unexplained
  // platform message" treatment above. A caller-supplied fallback (only reached when
  // there's truly no error info at all to work with) is our own already-plain text,
  // not a backend message — used exactly as given, never reworded or second-guessed.
  if (raw) return humanizeFnError(raw);
  return fallback || humanizeFnError('');
}


export const isIframe = window.self !== window.top;

// Per Enda: an audio-preview flow (the "Continue"/"Build & Play" controls in
// NarrationTtsEditor.jsx) once hung completely — every control on that panel gates on
// a `playing` flag that a stuck promise left stuck `true` forever, with nothing to
// click and no error shown, and the only way out was a hard refresh that threw away
// every unsaved edit on the whole tour, not just that one part. The direct cause (an
// unbounded fetch()) is fixed at its source, but this is a general-purpose safety net
// for wrapping any promise-based action that must never be allowed to hang the UI
// silently — races it against a timeout and rejects with a clear, recoverable message
// instead of leaving things stuck.
export function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
