import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { verifyEmailFromToken } from "../../shared/wpToken.ts";

// SECURITY: only ever acts on the email a genuine WordPress token actually belongs to —
// never an arbitrary email + device_id passed in the request. Without this, anyone at all
// could end any other customer's session on any device, with no login of their own.
export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { token, device_id } = body;
    if (!device_id) {
      return Response.json({ error: "device_id is required" }, { status: 400 });
    }

    const email = await verifyEmailFromToken(token, Deno.env.get('WC_SITE_URL'));
    if (!email) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
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