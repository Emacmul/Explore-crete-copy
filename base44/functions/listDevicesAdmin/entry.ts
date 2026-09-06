import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { SESSION_TIMEOUT_MIN } from "../../shared/deviceAuth.ts";
import { isSuperAdmin } from "../../shared/appUserAuth.ts";

// Per Enda (2026-09-06): managing devices is one of the highest-risk admin actions,
// so it now requires a Super Admin (see appUserAuth.ts's isSuperAdmin()) rather than
// just a real Base44 login — this used to be the same thing in practice (Enda was the
// only one with a real Base44 login), but Super Admin can now be handed to someone
// else without also handing over the whole Base44 account.
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    if (!(await isSuperAdmin(base44))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const svc = base44.asServiceRole;
    const devices = await svc.entities.Device.list();
    const sessions = await svc.entities.ActiveSession.filter({ active: true });
    const cutoff = Date.now() - SESSION_TIMEOUT_MIN * 60000;

    const byEmail: Record<string, any> = {};
    for (const d of devices) {
      if (!byEmail[d.user_email]) byEmail[d.user_email] = { email: d.user_email, devices: [] };
      byEmail[d.user_email].devices.push({
        id: d.id,
        device_id: d.device_id,
        label: d.device_label,
        first_seen: d.first_seen,
        last_used: d.last_used,
      });
    }

    for (const s of sessions) {
      if (!byEmail[s.user_email]) byEmail[s.user_email] = { email: s.user_email, devices: [] };
      byEmail[s.user_email].active_session = {
        device_id: s.device_id,
        heartbeat_at: s.heartbeat_at,
        live: new Date(s.heartbeat_at).getTime() > cutoff,
      };
    }

    return Response.json({ users: Object.values(byEmail) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}