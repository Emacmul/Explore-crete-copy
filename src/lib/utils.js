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
