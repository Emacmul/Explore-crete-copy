import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { isSuperAdmin } from "../../shared/appUserAuth.ts";

// Per Enda (2026-09-06): forcing a logout is one of the highest-risk admin actions,
// so it now requires a Super Admin — see listDevicesAdmin's own comment for the
// full reasoning.
export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { user_email } = body;
    if (!user_email) {
      return Response.json({ error: "user_email is required" }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    if (!(await isSuperAdmin(base44))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const svc = base44.asServiceRole;

    const sessions = await svc.entities.ActiveSession.filter({ user_email, active: true });
    for (const s of sessions) {
      await svc.entities.ActiveSession.update(s.id, { active: false });
    }

    return Response.json({ ok: true, deactivated: sessions.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}