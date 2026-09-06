import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { isSuperAdmin } from "../../shared/appUserAuth.ts";

// Per Enda (2026-09-06): managing devices is one of the highest-risk admin actions,
// so it now requires a Super Admin — see listDevicesAdmin's own comment for the
// full reasoning.
export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { user_email, device_id } = body;
    if (!user_email || !device_id) {
      return Response.json({ error: "user_email and device_id are required" }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    if (!(await isSuperAdmin(base44))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const svc = base44.asServiceRole;

    const devices = await svc.entities.Device.filter({ user_email, device_id });
    for (const d of devices) {
      await svc.entities.Device.delete(d.id);
    }
    const sessions = await svc.entities.ActiveSession.filter({ user_email, device_id });
    for (const s of sessions) {
      await svc.entities.ActiveSession.update(s.id, { active: false });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}