import { isAppAdmin } from './appUserAuth.ts';

/**
 * Resolves who is actually calling a Walk-related backend function — the same
 * dual-path pattern saveTranslation.ts already uses, generalised into one
 * shared helper since every Walk function needs both checks together.
 *
 * Two real identities exist in this app:
 *   - A genuine Base44 session (native admin, OR a "promoted" admin whose
 *     native Base44 role is just 'user' but whose AppUser.role is 'admin' —
 *     see appUserAuth.ts for why that split exists).
 *   - A Narr Studio session: no real Base44 auth at all, just an email +
 *     narr_session_token issued by narrLogin.ts at the moment the backend
 *     password was verified, checked here against that specific AppUser row
 *     (never a global token scan, so a token can't be replayed under a
 *     different claimed email).
 *
 * Returns:
 *   { kind: 'admin' }               — unrestricted access (native admin,
 *                                      promoted admin, or admin-wearing-the-
 *                                      Narr-hat — all three get full rights).
 *   { kind: 'narrator', email }     — restricted to their own clone(s).
 *   null                            — not authorized at all.
 *
 * This is the ACTUAL security boundary for the Walk entity. Walk.jsonc's own
 * rls block only exists as a backstop against a raw, unauthenticated SDK
 * call — every real Walk read/write must go through a function that calls
 * this first and refuses to proceed on null.
 */
export async function resolveActor(base44: any, body: any) {
  if (await isAppAdmin(base44)) {
    return { kind: 'admin' as const };
  }

  const email = body?.email;
  const narrToken = body?.narrToken;
  if (!email || !narrToken) return null;

  const normalized = String(email).trim().toLowerCase();
  const matches = await base44.asServiceRole.entities.AppUser.filter({ email: normalized });
  const u = Array.isArray(matches) ? matches[0] : null;
  if (!u || (u.role !== 'narrator' && u.role !== 'admin')) return null;

  const tokenValid = u.narr_session_token && String(u.narr_session_token) === String(narrToken)
    && u.narr_session_expires_at && new Date(u.narr_session_expires_at).getTime() > Date.now();
  if (!tokenValid) return null;

  if (u.role === 'admin') return { kind: 'admin' as const };
  return { kind: 'narrator' as const, email: u.email };
}
