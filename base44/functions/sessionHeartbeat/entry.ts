import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { isoNow } from "../../shared/deviceAuth.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { email, device_id } = body;
    if (!email || !device_id) {
      return Response.json({ error: "email and device_id are required" }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    const sessions = await svc.entities.ActiveSession.filter({ user_email: email, device_id });
    if (!sessions[0]) {
      // Nothing to refresh (e.g. admin force-logged them out). Ignore silently.
      return Response.json({ ok: true });
    }
    await svc.entities.ActiveSession.update(sessions[0].id, { heartbeat_at: isoNow(), active: true });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}