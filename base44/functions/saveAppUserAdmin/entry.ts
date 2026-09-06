import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isAppAdmin, isSuperAdmin } from '../../shared/appUserAuth.ts';
import { hashPassword } from '../../shared/passwordHash.ts';

// Updates a single AppUser row (role / password / date of birth / gender /
// newsletter opt-in) — gated on app-admin and run with the service role so the
// Base44-role RLS on AppUser (which can't recognise promoted admins) doesn't
// block the write. This is the only path that ever changes an AppUser's role, so
// promotion always requires an admin — never the sync, never a non-admin.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isAppAdmin(base44))) {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const { id, updates } = body;
    if (!id || !updates || typeof updates !== 'object') {
      return Response.json({ error: 'id and updates are required' }, { status: 400 });
    }

    // Per Enda (2026-09-06): moving anyone's role INTO or OUT OF Admin/Super Admin is
    // one of the highest-risk actions here — Admin is how someone gets backend access
    // at all, and Super Admin is the tier above that (see appUserAuth.ts's
    // isSuperAdmin()) — so only a Super Admin can do it, not just any Admin. Only
    // checked when the stored role would actually CHANGE to or from one of those two
    // (compared against the current row), so a regular Admin can still save an
    // unrelated edit (date of birth, etc.) on an existing Admin/Super Admin without
    // hitting this.
    if ('role' in updates) {
      const elevatedRoles = ['admin', 'super_admin'];
      const current = await base44.asServiceRole.entities.AppUser.get(String(id));
      const wasElevated = elevatedRoles.includes(current?.role);
      const willBeElevated = elevatedRoles.includes(updates.role);
      const roleActuallyChanging = current?.role !== updates.role;
      if ((wasElevated || willBeElevated) && roleActuallyChanging && !(await isSuperAdmin(base44))) {
        return Response.json({ error: 'Only a Super Admin can grant or remove Admin/Super Admin.' }, { status: 403 });
      }
    }

    // Only allow the fields the edit dialog actually changes — never let a caller
    // rewrite email or sneak arbitrary fields through the update payload.
    const allowed = {};
    for (const k of ['role', 'password', 'date_of_birth', 'gender', 'newsletter_opted_in']) {
      if (k in updates) allowed[k] = updates[k];
    }
    // Never write a new password in plain text — hash it here, the same as narrLogin
    // does when upgrading an old plain-text row. An admin setting a password also
    // clears any lockout, so it doubles as the recovery path for a locked-out account.
    if (allowed.password) {
      allowed.password = await hashPassword(String(allowed.password));
      allowed.login_failed_attempts = 0;
      allowed.login_locked_until = null;
    }
    const updated = await base44.asServiceRole.entities.AppUser.update(String(id), allowed);
    return Response.json({ ok: true, user: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}