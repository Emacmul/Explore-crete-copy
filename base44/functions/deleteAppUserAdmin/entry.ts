import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isSuperAdmin } from '../../shared/appUserAuth.ts';

// Deletes a single AppUser row — run with the service role.
//
// Per Enda (2026-09-06): deleting a user account is one of the highest-risk actions
// here, so it now requires a Super Admin (see appUserAuth.ts's isSuperAdmin()), not
// just any regular Admin.
//
// Per Enda (follow-up 160): deleting an account used to ONLY delete the AppUser row.
// It never touched that person's live device session, so someone deleted for bad
// behaviour could carry on using the app on a device they were already logged into,
// until that session happened to expire on its own. Deletion now also deactivates
// every ActiveSession row for that email — the same thing forceLogoutAdmin already
// does on its own (see that function's own comment) — folded into this one action
// instead of relying on a second, separate step (that, until now, had no working
// button anywhere in the app to even trigger it).
//
// WHAT THIS STILL CANNOT DO (kept here, not just in the changelog, so it's never lost
// track of — investigated in full before this was built, nothing here is a guess):
//   1. Revoke the deleted person's WordPress login. This app has no mechanism to
//      revoke a WordPress-issued JWT or deactivate a WordPress account before its
//      natural expiry — that lives entirely on the separate WordPress/WooCommerce
//      site, outside this codebase's reach. The frontend (UsersManager.jsx) now shows
//      a reminder about this at the moment of deletion, since the code genuinely can't
//      do it for you.
//   2. Touch a genuine Base44-platform login (as opposed to an AppUser row promoted to
//      'admin'). Platform role assignment happens only inside Base44's own builder UI —
//      nothing in this app's backend API surface can reach it. Promoted admins are
//      deliberately invited at platform role 'user', not 'admin', specifically so this
//      is a non-issue for the normal case.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isSuperAdmin(base44))) {
      return Response.json({ error: 'Super Admin only' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const { id } = body;
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

    const svc = base44.asServiceRole;

    // Read the row first — its email is needed to find any device sessions below, and
    // this also lets a caller who already deleted this id get a clear 404 instead of a
    // silent no-op.
    const existing = await svc.entities.AppUser.get(String(id));
    if (!existing) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    await svc.entities.AppUser.delete(String(id));

    // Same deactivation forceLogoutAdmin performs — every active device session for
    // this email stops working immediately, rather than staying valid until it
    // expires on its own. Best-effort: a problem here must never leave the account
    // undeleted, since the deletion itself (the higher-priority action) already
    // succeeded above.
    let sessionsDeactivated = 0;
    if (existing.email) {
      try {
        const sessions = await svc.entities.ActiveSession.filter({ user_email: existing.email, active: true });
        for (const s of sessions) {
          await svc.entities.ActiveSession.update(s.id, { active: false });
        }
        sessionsDeactivated = sessions.length;
      } catch (sessionError) {
        console.error('Deleted AppUser but failed to deactivate their device session(s):', sessionError);
      }
    }

    return Response.json({ ok: true, sessionsDeactivated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
