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
export function getFnErrorMessage(err, fallback = 'Something went wrong.') {
  return err?.response?.data?.error || err?.message || fallback;
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
