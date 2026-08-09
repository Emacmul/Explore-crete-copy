// App-admin gate, shared by the AppUser admin functions.
//
// The app's "admin" lives in AppUser.role, NOT in the Base44 User role: promoted
// admins are invited to Base44 as plain 'user' (so they can't reach Base44's own
// dashboard), so a Base44-role RLS rule can't recognise them. The full-list read
// and all mutations on AppUser are therefore served through backend functions
// that run with the service role and gate here on the app's own admin concept:
// the Base44 builder (role 'admin') OR an AppUser whose role is 'admin'.
//
// Kept client-safe (no base44:runtime / npm imports) — the base44 client is
// passed in by each calling function, matching the deviceAuth.ts pattern.
export async function isAppAdmin(base44: any): Promise<boolean> {
  try {
    const me = await base44.auth.me();
    if (!me) return false;
    if (me.role === 'admin') return true;
    if (!me.email) return false;
    const rows = await base44.asServiceRole.entities.AppUser.filter({
      email: String(me.email).toLowerCase(),
    });
    return Array.isArray(rows) && rows[0]?.role === 'admin';
  } catch {
    return false;
  }
}