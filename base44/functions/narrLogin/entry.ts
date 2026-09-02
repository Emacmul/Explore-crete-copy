import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { verifyPassword, hashPassword } from '../../shared/passwordHash.ts';

/**
 * Narr Studio login.
 *
 * A Narr (narrator role) reaches the back end through the "Narr" button on the
 * front end, NOT through Base44's separate native sign-in that admins use.
 * This function validates the Narr's backend password, which an admin set for
 * them in the EditAppUser section — it is deliberately separate from the
 * WordPress password that gets them into the front end.
 *
 * Runs with the service role because the requesting browser has only a
 * WordPress session (no Base44 user), so it cannot read the AppUser table
 * directly. Returns only { ok, email, role, name } — never the password.
 *
 * SECURITY (2026-09-02 audit): previously there was no limit on wrong-password
 * attempts (any number could be tried, as fast as a connection allowed), and
 * three different error messages let a caller work out which email addresses
 * even have backend accounts before guessing a single password. Both are fixed
 * below: a lockout after MAX_ATTEMPTS wrong tries (same pattern already used
 * for device-login codes, see shared/deviceAuth.ts), and one identical generic
 * error for "no such account" / "not a Narrator" / "wrong password" alike.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MIN = 15;
const GENERIC_ERROR = 'Invalid email or password.';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return Response.json({ ok: false, error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const matches = await base44.asServiceRole.entities.AppUser.filter({ email: normalizedEmail });
    const match = Array.isArray(matches) ? matches[0] : null;

    // Same message whether the account doesn't exist at all or just isn't a
    // Narrator/Admin — nothing to lock either way, since there's no real account
    // password to be guessed against here.
    if (!match || (match.role !== 'narrator' && match.role !== 'admin')) {
      return Response.json({ ok: false, error: GENERIC_ERROR });
    }

    if (match.login_locked_until && new Date(match.login_locked_until).getTime() > Date.now()) {
      return Response.json({ ok: false, error: 'Too many incorrect attempts. Please wait 15 minutes and try again.' });
    }

    const { valid, needsRehash } = await verifyPassword(String(password), String(match.password || ''));

    if (!valid) {
      const nextAttempts = (match.login_failed_attempts || 0) + 1;
      const patch: Record<string, unknown> = { login_failed_attempts: nextAttempts };
      if (nextAttempts >= MAX_ATTEMPTS) {
        patch.login_locked_until = new Date(Date.now() + LOCKOUT_MIN * 60000).toISOString();
      }
      await base44.asServiceRole.entities.AppUser.update(match.id, patch);
      return Response.json({ ok: false, error: GENERIC_ERROR });
    }

    // An admin may also enter through the "Narr" button to wear the Narr hat; they
    // get the narrator workflow but without the narrator-only limits (see Narr.jsx +
    // BackendShell `unrestricted`). Their existing backend password is reused.

    // Issue a fresh session token — verified against a real password check right here,
    // not a bypass of it. Lets the rest of this Narr Studio visit (saving translations,
    // etc.) skip re-asking for the password, without trusting an unverifiable client
    // claim of identity the way skipping this check entirely would.
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // 12 hours

    const patch: Record<string, unknown> = {
      login_failed_attempts: 0,
      login_locked_until: null,
      narr_session_token: token,
      narr_session_expires_at: expiresAt,
    };
    // Transparent migration off plain-text storage: a password that only matched
    // because it was still stored in plain text gets rehashed right here, the
    // moment it's proven correct — the person logging in sees nothing different.
    if (needsRehash) {
      patch.password = await hashPassword(String(password));
    }
    await base44.asServiceRole.entities.AppUser.update(match.id, patch);

    const name = `${match.first_name || ''} ${match.last_name || ''}`.trim();
    const isAdmin = match.role === 'admin';
    return Response.json({ ok: true, email: match.email, role: 'narrator', name, isAdmin, token });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 200 });
  }
});
