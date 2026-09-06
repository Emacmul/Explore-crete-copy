// Per Enda, quoting Base44 support directly: "With all narrators sharing one app and one
// database, the rate limits are shared across everyone working at the same time... If your
// backend functions do not already have retry logic with a short backoff on 429 responses,
// add it. That is the main protection against bursts causing lost work." Checked first —
// this codebase already retries 429s from Groq (see groqKeyRotation.ts) and from the routing
// API (routeWaypoints/entry.ts), but nothing anywhere retried a 429 from Base44's OWN
// entities/database calls, which is specifically what Base44 support was describing. This
// file is that missing piece.
//
// wrapClientWithRetry(base44) takes the client a function gets from createClientFromRequest
// and hands back one that behaves identically, except: every entities.<Entity>.list/filter/
// get/create/update/delete/deleteMany/bulkCreate/updateMany/bulkUpdate call (both
// base44.entities.* and base44.asServiceRole.entities.*) is retried automatically, a few
// times, with a short increasing pause between attempts, but ONLY when the failure is
// actually a 429 (rate limit) — any other error (not found, validation, a real bug) comes
// back immediately, unretried, exactly as before. base44.functions.invoke(...) — a function
// calling another function — gets the same treatment, covering the separate "backend
// function concurrency" 429 Base44 support also described.
//
// Deliberately NOT wrapped: .subscribe() (a websocket subscription, not a rate-limited HTTP
// call) and .functions.fetch() (raw fetch — doesn't reject on a non-2xx status, so there's
// nothing here to retry). Everything else on the client (auth, users, setToken, ...) passes
// straight through, untouched.
//
// A frontend twin of this file lives at src/lib/withEntityRetry.js, wrapping the customer/
// narrator-facing base44 client the same way — kept as a separate file rather than shared
// code because the frontend (Vite/browser) and this backend (Deno) build separately and
// never import from one another today.

const ENTITY_METHODS = [
  'list', 'filter', 'get', 'create', 'update', 'delete',
  'deleteMany', 'bulkCreate', 'updateMany', 'bulkUpdate', 'importEntities',
] as const;

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 4000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Base44Error (from entities.* calls, which run through the SDK's normal response
// interceptor) exposes the HTTP status directly as `.status`. functions.invoke(...) runs
// through a client with `interceptResponses: false` (see the SDK's client.js), so a
// non-2xx response there rejects as a plain axios error instead, with the status nested
// under `.response.status`. Checking both shapes means this one function works for either
// caller without needing to know which kind of error it was handed.
function getStatus(err: any): number | undefined {
  return err?.status ?? err?.response?.status;
}

// Prefer the server's own Retry-After header when it sends one (Base44 may say exactly
// how long to wait) over guessing with a fixed backoff. Axios normalizes response headers
// into an object that's usually plain but sometimes exposes a `.get()` method instead —
// handle both rather than assuming one.
function getRetryAfterMs(err: any): number | undefined {
  const headers = err?.response?.headers ?? err?.originalError?.response?.headers;
  if (!headers) return undefined;
  const raw = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  // deno-lint-ignore no-explicit-any
  let lastErr: any;
  while (attempt <= MAX_RETRIES) {
    try {
      return await fn();
    } catch (err) {
      if (getStatus(err) !== 429 || attempt === MAX_RETRIES) throw err;
      lastErr = err;
      const retryAfterMs = getRetryAfterMs(err);
      // Exponential backoff (400ms, 800ms, 1.6s, 3.2s, capped at 4s) when Base44 doesn't
      // say how long to wait; a touch of random jitter so several narrators who all hit
      // the limit on the very same tick don't all retry on the very same tick too.
      const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
      const delay = (retryAfterMs ?? backoff) + Math.random() * backoff * 0.3;
      attempt++;
      await sleep(delay);
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TypeScript satisfied.
  throw lastErr;
}

function wrapEntityHandler(handler: any): any {
  return new Proxy(handler, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (!ENTITY_METHODS.includes(prop as any)) return value; // e.g. subscribe — pass through
      return (...args: any[]) => callWithRetry(() => value.apply(target, args));
    },
  });
}

function wrapEntitiesModule(entitiesModule: any): any {
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

function wrapFunctionsModule(functionsModule: any): any {
  return new Proxy(functionsModule, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'invoke' || typeof value !== 'function') return value;
      return (...args: any[]) => callWithRetry(() => value.apply(target, args));
    },
  });
}

// Wraps a client from createClientFromRequest(req) (or createClient(...)). Everything not
// explicitly handled below (auth, users, setToken, getConfig, ...) is passed straight
// through via Reflect, untouched and lazily — asServiceRole in particular is a getter that
// THROWS if the client has no service token, so it's only ever touched here at the moment
// a caller actually accesses base44.asServiceRole, never eagerly (an eager copy would break
// any caller that never uses asServiceRole at all).
export function wrapClientWithRetry(client: any): any {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'entities') return wrapEntitiesModule(Reflect.get(target, prop, receiver));
      if (prop === 'functions') return wrapFunctionsModule(Reflect.get(target, prop, receiver));
      if (prop === 'asServiceRole') {
        const svc = Reflect.get(target, prop, receiver); // may throw — same as unwrapped
        return new Proxy(svc, {
          get(svcTarget, svcProp, svcReceiver) {
            if (svcProp === 'entities') return wrapEntitiesModule(Reflect.get(svcTarget, svcProp, svcReceiver));
            if (svcProp === 'functions') return wrapFunctionsModule(Reflect.get(svcTarget, svcProp, svcReceiver));
            return Reflect.get(svcTarget, svcProp, svcReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
