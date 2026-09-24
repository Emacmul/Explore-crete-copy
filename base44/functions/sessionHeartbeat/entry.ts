import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { isoNow, getTokenFingerprint, sessionMatchesToken } from "../../shared/deviceAuth.ts";
import { verifyEmailFromToken } from "../../shared/wpToken.ts";

// SECURITY: only ever acts on the email a genuine WordPress token actually belongs to —
// never an arbitrary email + device_id passed in the request. Without this, anyone at all
// could keep any other customer's session alive on any device, with no login of their own
// — potentially bypassing the device-limit enforcement entirely.
//
// A heartbeat can REFRESH a session, never resurrect one (audit U1, 2026-09-23): it only
// touches a row that is still active, and only if that row belongs to the same login
// generation as the token being sent (the row's token_issued_at matches the token's
// `iat`). A still-open or background tab left behind by a force-logout used to flip the
// row back to active:true here, silently undoing the logout every five minutes — now it
// can't, and a tab holding an older token after a newer login on the same device no
// longer keeps that newer session alive either (audit U2).
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

    const fp = await getTokenFingerprint(token);
    const sessions = await svc.entities.ActiveSession.filter({ user_email: email, device_id });
    const session = sessions[0];
    if (!session) {
      // Nothing to refresh (e.g. admin force-logged them out). Ignore silently for the
      // fire-and-forget heartbeat interval — but report valid:false so the client's
      // reload-restore check can detect a revoked session (audit 2026-09-24).
      return Response.json({ ok: true, valid: false });
    }
    // Never reactivate an inactive session (U1) — and never refresh on behalf of an
    // older token generation (U2), now bound to the exact token hash rather than the
    // iat claim (2026-09-24: same-second logins share an iat; see deviceAuth.ts).
    if (session.active !== true) {
      return Response.json({ ok: true, valid: false });
    }
    if (!sessionMatchesToken(session, fp)) {
      return Response.json({ ok: true, valid: false });
    }
    await svc.entities.ActiveSession.update(session.id, { heartbeat_at: isoNow() });
    return Response.json({ ok: true, valid: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}