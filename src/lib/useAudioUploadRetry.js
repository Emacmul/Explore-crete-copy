import { useEffect, useRef, useState, useCallback } from 'react';

// Retry only temporary upload failures, never permission/validation failures.
// One request at a time: a timeout must not start a second, overlapping upload.
export default function useAudioUploadRetry() {
  const controllerRef = useRef(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    controllerRef.current = new AbortController();
    return () => controllerRef.current?.abort();
  }, []);
  const uploadWithRetry = useCallback(async (upload) => {
    const signal = controllerRef.current.signal;
    let attempt = 0;
    try {
      while (!signal.aborted) {
        try {
          const result = await upload();
          signal.throwIfAborted();
          return result;
        } catch (err) {
          signal.throwIfAborted();
          const status = Number(err?.status ?? err?.response?.status);
          const temporary = [408, 429, 502, 503, 504, 520, 521, 522, 523, 524].includes(status)
            || (!status && ['ERR_NETWORK', 'ECONNRESET'].includes(err?.code));
          if (!temporary) throw err;
          setRetrying(true);
          const headers = err?.response?.headers;
          const retryAfter = Number(headers?.get?.('retry-after') ?? headers?.['retry-after']);
          const delay = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
            Math.min(30000, 2000 * 2 ** Math.min(attempt++, 4)));
          await new Promise((resolve, reject) => {
            const cancel = () => { clearTimeout(timer); reject(new DOMException('Editor closed', 'AbortError')); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
            signal.addEventListener('abort', cancel, { once: true });
          });
        }
      }
      signal.throwIfAborted();
    } finally {
      if (!signal.aborted) setRetrying(false);
    }
  }, []);
  return { uploadWithRetry, retrying };
}