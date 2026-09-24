import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { verifyEmailFromToken } from "../../shared/wpToken.ts";
import { isSessionRevoked } from "../../shared/deviceAuth.ts";

// Per Enda (follow-up 184): "Before You Set Off" (safety_notes) is exactly the kind of
// thing people scroll past without reading — until something goes wrong, and then the
// hassle starts. Every time a customer taps Confirm on that section, this writes a
// permanent, timestamped record that they saw it — snapshotting the EXACT text shown at
// that moment (safety_notes_snapshot), so a later edit to the tour's safety notes can
// never be mistaken for what this specific customer actually confirmed reading.
//
// Same identification pattern as sessionHeartbeat/getWalkCatalog: real customers log in
// through WordPress only and never have a Base44 session, so the caller is identified from
// their WordPress-issued token, not trusted from the request body directly.
//
// This is called every time someone taps Confirm — including a walk they've confirmed
// before (Enda: asked for again every time, not just once) — so multiple rows per
// person/walk are expected and normal, not a bug.
export default async function (req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { token, walk_id, walk_code, walk_name, safety_notes, device_id } = body;
    if (!walk_id) {
      return Response.json({ error: "walk_id is required" }, { status: 400 });
    }

    const email = await verifyEmailFromToken(token, Deno.env.get('WC_SITE_URL'));
    if (!email) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    // Session-revocation gate (2026-09-24 review, "revoked sessions"): a WordPress token
    // stays valid after this account's app session was ended (force-logout or an explicit
    // logout) — a revoked session must not keep writing confirmations. Fails closed, the
    // same way the read paths (syncLibrary, getMembershipStatus) already do.
    if (await isSessionRevoked(svc, email, token)) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    await svc.entities.SafetyConfirmation.create({
      buyer_email: email,
      walk_id: String(walk_id),
      walk_code: walk_code || '',
      walk_name: walk_name || '',
      safety_notes_snapshot: safety_notes || '',
      confirmed_at: new Date().toISOString(),
      device_id: device_id || '',
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}