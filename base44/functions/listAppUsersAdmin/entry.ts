import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isAppAdmin } from '../../shared/appUserAuth.ts';
// Per Enda / Base44 support: retries a real 429 (pooled rate limit) with a short backoff —
// see withEntityRetry.ts's own header comment for the full reasoning.
import { wrapClientWithRetry } from '../../shared/withEntityRetry.ts';

// Returns the AppUser list — but only to app-admins (the Base44 builder, or an AppUser
// whose role is 'admin'). AppUser has no Base44-role read rule that can express "app
// admin" (promoted admins log into Base44 as plain 'user'), so the full-list read is
// gated here on the app's own admin concept and served with the service role. Direct
// client-SDK reads are restricted by RLS to a user's own row(s); the list only ever comes
// back through this function.
//
// Per Enda's front-end audit (2026-09-05) and his follow-up: this used to send back
// EVERY field of every AppUser row, unfiltered — the Manage Users screen only ever
// displays name/email/role and lets an admin edit role/date of birth/password, but the
// raw response also carried every listed person's stored password (hashed since
// 2026-09, but plain text for anyone who set theirs before that and hasn't logged in
// since), their own personal Google TTS/Groq API keys, and their live Narr Studio login
// code — all sitting in any admin's browser Network tab regardless of whether the screen
// ever showed it. None of that is needed to manage a user's role or reset their
// password, so it's dropped here before it ever leaves the server, down to exactly the
// fields Manage Users (UsersManager.jsx) actually uses. `has_password` replaces the raw
// `password` field — the Edit User dialog only ever needed a yes/no to decide whether
// leaving its password box blank should be allowed to mean "keep the current one" (see
// follow-up 134); it never needed the real value.
const PUBLIC_FIELDS = ['id', 'email', 'first_name', 'last_name', 'role', 'date_of_birth'];

function toSafeUser(u: any) {
  const safe: any = {};
  for (const f of PUBLIC_FIELDS) safe[f] = u[f];
  safe.has_password = !!u.password;
  return safe;
}


export default async function (req) {
  try {
    const base44 = wrapClientWithRetry(createClientFromRequest(req));
    if (!(await isAppAdmin(base44))) {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }
    const list = await base44.asServiceRole.entities.AppUser.filter(
      {},
      '-created_date',
      5000
    );
    const users = (Array.isArray(list) ? list : []).map(toSafeUser);
    return Response.json({ users });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}