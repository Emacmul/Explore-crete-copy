import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isAppAdmin, isSuperAdmin } from '../../shared/appUserAuth.ts';
import { hashPassword } from '../../shared/passwordHash.ts';
// Per Enda's follow-up 146: the moment someone becomes a narrator/admin/super
// admin, they get every already-published English tour for free — see
// narratorFreeTours.ts for the full reasoning.
import { grantAllPublishedToursToNarrator } from '../../shared/narratorFreeTours.ts';

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
    // Fetched once when the role is changing, and reused below for a second,
    // unrelated check: whether this save is a genuine promotion into
    // narrator/admin/super_admin, which triggers the free-tour grant further down.
    let currentBeforeSave = null;
    if ('role' in updates) {
      currentBeforeSave = await base44.asServiceRole.entities.AppUser.get(String(id));
      const elevatedRoles = ['admin', 'super_admin'];
      const wasElevated = elevatedRoles.includes(currentBeforeSave?.role);
      const willBeElevated = elevatedRoles.includes(updates.role);
      const roleActuallyChanging = currentBeforeSave?.role !== updates.role;
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

    // Per Enda (follow-up 146): a genuine promotion into narrator/admin/super_admin
    // (role actually changing to one of these, not just re-saving the same role)
    // gets every already-published English tour added to their library for free —
    // not just tours published from here on, since they'll be translating the
    // older ones too. Best-effort: a problem here must never block the role save.
    const NEW_NARRATOR_ROLES = ['narrator', 'admin', 'super_admin'];
    const isNewPromotion = 'role' in updates
      && NEW_NARRATOR_ROLES.includes(updates.role)
      && currentBeforeSave?.role !== updates.role;
    if (isNewPromotion) {
      try {
        await grantAllPublishedToursToNarrator(base44, updated.email);
      } catch (grantError) {
        console.error('Free-tour grant to newly promoted narrator/admin failed (role change still saved):', grantError);
      }
    }

    return Response.json({ ok: true, user: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}