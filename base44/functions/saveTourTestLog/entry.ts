import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyEmailFromToken, isTokenGenuine } from '../../shared/wpToken.ts';
import { isSessionRevoked } from '../../shared/deviceAuth.ts';

// Saves the "Audit Log" of an ADMIN's test drive of a draft tour, so it can be read afterwards
// without the admin touching the phone while driving (per Enda, 2026-09-20 - BOR3 road test).
//
// Only ever accepts a caller WordPress itself confirms (genuine token) whose AppUser role is
// 'admin' or 'super_admin' - same rule getWalkCatalog uses for draft previews. Anyone else
// gets a plain "Not authorized" and nothing is stored. Customers' phones never call this at all
// (the app only does so for a draft tour an admin is previewing).
//
// One record per test drive (session_id), updated in place every few seconds.
const MAX_LOG_CHARS = 150000;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { token, sessionId, walkId, walkName, logText, entryCount } = body || {};

    const siteUrl = Deno.env.get('WC_SITE_URL');
    if (!token || !sessionId || typeof logText !== 'string') {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }
    if (!(await isTokenGenuine(token, siteUrl))) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Who is this? By the email in the (now verified) token, else by the WordPress user id in it.
    const svc = base44.asServiceRole;
    let row = null;
    const email = await verifyEmailFromToken(token, siteUrl);
    if (email) {
      const rows = await svc.entities.AppUser.filter({ email });
      row = Array.isArray(rows) ? rows.find((r) => r.role === 'admin' || r.role === 'super_admin') || rows[0] || null : null;
    }
    if (!row || !(row.role === 'admin' || row.role === 'super_admin')) {
      try {
        const parts = String(token).split('.');
        const payload = parts.length === 3 ? JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) : null;
        const wpId = payload?.data?.user?.id || payload?.user_id || payload?.sub || null;
        if (wpId) {
          const byId = await svc.entities.AppUser.filter({ user_id: String(wpId) });
          row = Array.isArray(byId) ? byId[0] || null : null;
        }
      } catch { /* fall through */ }
    }
    if (!row || !(row.role === 'admin' || row.role === 'super_admin')) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Session-revocation gate (2026-09-24 review, "revoked sessions"): a WordPress token
    // stays cryptographically valid after this account's app session was ended (an admin
    // force-logout, or an explicit logout) — the write must stop with it, the same way
    // the read paths (syncLibrary, getMembershipStatus, getWalkCatalog) already fail
    // closed. Staff logins create the same ActiveSession rows customers do (see
    // loginWithDeviceCheck's staff bypass), so the check is safe for admins too.
    if (await isSessionRevoked(svc, String(row.email).toLowerCase(), token)) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    const text = logText.length > MAX_LOG_CHARS ? '...(older lines dropped)\n' + logText.slice(-MAX_LOG_CHARS) : logText;
    const data = {
      session_id: String(sessionId).slice(0, 80),
      walk_id: String(walkId || '').slice(0, 80),
      walk_name: String(walkName || '').slice(0, 200),
      admin_email: String(row.email || ''),
      entry_count: Number(entryCount) || 0,
      log_text: text,
    };

    const existing = await svc.entities.TourTestLog.filter({ session_id: data.session_id });
    if (Array.isArray(existing) && existing.length > 0) {
      await svc.entities.TourTestLog.update(existing[0].id, data);
    } else {
      await svc.entities.TourTestLog.create(data);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}