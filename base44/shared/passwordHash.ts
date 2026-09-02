// Password hashing for AppUser.password (the Narr Studio backend password — see
// narrLogin.ts). Uses PBKDF2 via the native Web Crypto API (crypto.subtle), which
// every Deno function already has for free — no npm package to install or resolve,
// no new dependency to keep working across redeploys.
//
// MIGRATION: passwords already in the database were stored as plain text before this
// file existed. Rather than forcing Enda to manually reset every narrator/admin
// password (and lock everyone out until he does), verifyPassword() below recognises
// the old plain-text format, verifies against it once, and tells the caller to
// silently rehash it — narrLogin.ts does that rehash the moment someone next logs in
// successfully, so every real account upgrades itself the next time its owner signs
// in, with zero visible change for them.
const ITERATIONS = 100_000;
const HASH_PREFIX = 'pbkdf2';

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function deriveHashHex(password: string, saltHex: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return bufToHex(bits);
}

// Stored format: "pbkdf2$<iterations>$<saltHex>$<hashHex>" — the iteration count
// travels with the hash so it can be safely increased later without invalidating
// every existing password.
export async function hashPassword(password: string): Promise<string> {
  const saltHex = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hashHex = await deriveHashHex(password, saltHex, ITERATIONS);
  return `${HASH_PREFIX}$${ITERATIONS}$${saltHex}$${hashHex}`;
}

// Walks every character of both strings regardless of where (or whether) they first
// differ, so a failed comparison doesn't leak timing information about how much of
// the guess was correct — flagged as a low-priority gap in the 2026-09-02 audit for
// every plain `===` secret comparison in this codebase; fixed here for the one that
// actually gates a real login.
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// valid: whether `password` matches what's stored.
// needsRehash: true only when `stored` was still in the old plain-text format AND the
// password matched it — the caller should overwrite it with hashPassword(password)
// right away so this account never falls back to a plain-text comparison again.
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!password || !stored) return { valid: false, needsRehash: false };

  if (stored.startsWith(`${HASH_PREFIX}$`)) {
    const parts = stored.split('$');
    if (parts.length !== 4) return { valid: false, needsRehash: false };
    const [, iterStr, saltHex, hashHex] = parts;
    const iterations = parseInt(iterStr, 10);
    if (!iterations || !saltHex || !hashHex) return { valid: false, needsRehash: false };
    const computed = await deriveHashHex(password, saltHex, iterations);
    return { valid: timingSafeEqual(computed, hashHex), needsRehash: false };
  }

  // Legacy plain-text row from before this file existed.
  const valid = timingSafeEqual(String(stored), String(password));
  return { valid, needsRehash: valid };
}
