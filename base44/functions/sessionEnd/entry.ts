import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

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
    for (const s of sessions) {
      await svc.entities.ActiveSession.update(s.id, { active: false });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}