// App-admin gate, shared by the AppUser admin functions.
//
// The app's "admin" lives in AppUser.role, NOT in the Base44 User role: promoted
// admins are invited to Base44 as plain 'user' (so they can't reach Base44's own
// dashboard), so a Base44-role RLS rule can't recognise them. The full-list read
// and all mutations on AppUser are therefore served through backend functions
// that run with the service role and gate here on the app's own admin concept:
// the Base44 builder (role 'admin') OR an AppUser whose role is 'admin' or
// 'super_admin' (a Super Admin is always also a regular Admin).
//
// Kept client-safe (no base44:runtime / npm imports) — the base44 client is
// passed in by each calling function, matching the deviceAuth.ts pattern.
// Narr-session verification shared by both gates below: checks body.email +
// body.narrToken against that exact AppUser row — the same rule backendActor.ts
// applies to Walk functions (never a global token scan, so a token can't be
// replayed under a different claimed email). Returns the AppUser row when the
// session is valid, null otherwise.
export async function resolveNarrSession(base44: any, body?: any) {
  const email = body?.email;
  const narrToken = body?.narrToken;
  if (!email || !narrToken) return null;
  try {
    const rows = await base44.asServiceRole.entities.AppUser.filter({
      email: String(email).trim().toLowerCase(),
    });
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u) return null;
    const tokenValid = u.narr_session_token && String(u.narr_session_token) === String(narrToken)
      && u.narr_session_expires_at && new Date(u.narr_session_expires_at).getTime() > Date.now();
    return tokenValid ? u : null;
  } catch {
    return null;
  }
}

export async function isAppAdmin(base44: any, body?: any): Promise<boolean> {
  // Narr session (the Admin page and Narrator Studio both sign in with the
  // backend password since Base44's own platform sign-in was retired, 2026-09-23
  // — these callers have no Base44 session at all): a valid narr_session_token on
  // an AppUser whose role is admin/super_admin counts, same as backendActor.ts.
  const narrUser = await resolveNarrSession(base44, body);
  if (narrUser && (narrUser.role === 'admin' || narrUser.role === 'super_admin')) return true;

  try {
    const me = await base44.auth.me();
    if (!me) return false;
    if (me.role === 'admin') return true;
    if (!me.email) return false;
    const rows = await base44.asServiceRole.entities.AppUser.filter({
      email: String(me.email).toLowerCase(),
    });
    const role = rows[0]?.role;
    return role === 'admin' || role === 'super_admin';
  } catch {
    return false;
  }
}

// Super-Admin gate — a smaller, higher-trust circle than isAppAdmin() above, for the
// handful of highest-risk actions: managing devices, forcing a logout, restoring a
// disputed purchase, gifting a tour, deleting a user account, and granting Admin or
// Super Admin to someone else. A regular promoted Admin does NOT qualify here — that
// is the entire point of this tier.
//
// True for: a real Base44 login (role 'admin' in Base44's own system — this app's
// actual owner/builder), OR an AppUser explicitly marked role 'super_admin'.
//
// Per Enda (2026-09-06): these actions used to check only for a real Base44 login.
// That happened to work because he is (almost certainly) the only person with one,
// but a real Base44 login is much bigger than these few actions — it can rebuild the
// whole app, change billing, anything. Super Admin is kept as its own, app-only label
// (set the same way Narrator/Admin already are, via saveAppUserAdmin) precisely so it
// can be handed to someone else later without also handing over the whole Base44
// account. Because a real Base44 login always counts as Super Admin, Enda already
// qualifies automatically — no separate bootstrap step was needed to make him one.
export async function isSuperAdmin(base44: any, body?: any): Promise<boolean> {
  // Narr session: only an AppUser explicitly marked 'super_admin' qualifies —
  // a valid narr token on a plain admin row must NOT unlock the highest-risk
  // actions.
  const narrUser = await resolveNarrSession(base44, body);
  if (narrUser && narrUser.role === 'super_admin') return true;

  try {
    const me = await base44.auth.me();
    if (!me) return false;
    if (me.role === 'admin') return true;
    if (!me.email) return false;
    const rows = await base44.asServiceRole.entities.AppUser.filter({
      email: String(me.email).toLowerCase(),
    });
    return rows[0]?.role === 'super_admin';
  } catch {
    return false;
  }
}