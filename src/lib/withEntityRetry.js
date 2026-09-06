// Per Enda, quoting Base44 support directly: "With all narrators sharing one app and one
// database, the rate limits are shared across everyone working at the same time... If your
// backend functions do not already have retry logic with a short backoff on 429 responses,
// add it. That is the main protection against bursts causing lost work." The same pooled
// entity/database limits apply to calls made straight from the browser, not just from
// inside a backend function — so this app's own frontend client (base44Client.js) needs the
// same protection.
//
// This is the frontend twin of base44/shared/withEntityRetry.ts (same logic, kept as a
// separate file because the frontend, built by Vite, and the backend functions, run by
// Deno, build completely separately and never import from one another today). See that
// file's header comment for the full reasoning; this file mirrors it exactly.
//
// wrapClientWithRetry(base44) returns a client that behaves identically to the one passed
// in, except every entities.<Entity>.list/filter/get/create/update/delete/deleteMany/
// bulkCreate/updateMany/bulkUpdate call, and every functions.invoke(...) call, is retried a
// few times with a short increasing pause — but ONLY when the failure is actually a 429
// (rate limit). Any other error (not found, validation, a real bug) comes back immediately,
// unretried, exactly as before.

const ENTITY_METHODS = [
  'list', 'filter', 'get', 'create', 'update', 'delete',
  'deleteMany', 'bulkCreate', 'updateMany', 'bulkUpdate', 'importEntities',
];

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Base44Error (from entities.* calls) exposes the HTTP status directly as `.status`.
// functions.invoke(...) runs through a client with interceptResponses:false (see the SDK's
// client.js), so a non-2xx response there rejects as a plain axios error instead, with the
// status nested under `.response.status`. Checking both shapes means this one function
// works for either caller without needing to know which kind of error it was handed.
function getStatus(err) {
  return err?.status ?? err?.response?.status;
}

// Prefer the server's own Retry-After header when it sends one, over guessing with a fixed
// backoff. Axios normalizes response headers into an object that's usually plain but
// sometimes exposes a `.get()` method instead — handle both rather than assuming one.
function getRetryAfterMs(err) {
  const headers = err?.response?.headers ?? err?.originalError?.response?.headers;
  if (!headers) return undefined;
  const raw = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

async function callWithRetry(fn) {
  let attempt = 0;
  let lastErr;
  while (attempt <= MAX_RETRIES) {
    try {
      return await fn();
    } catch (err) {
      if (getStatus(err) !== 429 || attempt === MAX_RETRIES) throw err;
      lastErr = err;
      const retryAfterMs = getRetryAfterMs(err);
      // Exponential backoff (400ms, 800ms, 1.6s, 3.2s, capped at 4s) when the server
      // doesn't say how long to wait; a touch of random jitter so several narrators who
      // all hit the limit on the very same tick don't all retry on the very same tick too.
      const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
      const delay = (retryAfterMs ?? backoff) + Math.random() * backoff * 0.3;
      attempt++;
      await sleep(delay);
    }
  }
  throw lastErr; // unreachable — the loop above always returns or throws
}

function wrapEntityHandler(handler) {
  return new Proxy(handler, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (!ENTITY_METHODS.includes(prop)) return value; // e.g. subscribe — pass through
      return (...args) => callWithRetry(() => value.apply(target, args));
    },
  });
}

function wrapEntitiesModule(entitiesModule) {
  // entitiesModule is itself already a Proxy (dynamic per-entity-name access) — wrapping
  // it in a second Proxy layer that intercepts the SAME `get` trap lets every entity name
  // (Walk, AppUser, whatever) come back pre-wrapped, without needing to know their names
  // in advance.
  return new Proxy(entitiesModule, {
    get(target, entityName, receiver) {
      const handler = Reflect.get(target, entityName, receiver);
      if (!handler || typeof handler !== 'object') return handler;
      return wrapEntityHandler(handler);
    },
  });
}

function wrapFunctionsModule(functionsModule) {
  return new Proxy(functionsModule, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'invoke' || typeof value !== 'function') return value;
      return (...args) => callWithRetry(() => value.apply(target, args));
    },
  });
}

// Wraps the client created in base44Client.js. Everything not explicitly handled below
// (auth, users, setToken, getConfig, ...) is passed straight through via Reflect,
// untouched. This frontend client never has a service token, so asServiceRole is not
// handled here at all (accessing it on this client already throws by design — see the
// SDK's client.js — and that's correctly left alone).
export function wrapClientWithRetry(client) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'entities') return wrapEntitiesModule(Reflect.get(target, prop, receiver));
      if (prop === 'functions') return wrapFunctionsModule(Reflect.get(target, prop, receiver));
      return Reflect.get(target, prop, receiver);
    },
  });
}
