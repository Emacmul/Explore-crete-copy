import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { SESSION_TIMEOUT_MIN } from "../../shared/deviceAuth.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
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